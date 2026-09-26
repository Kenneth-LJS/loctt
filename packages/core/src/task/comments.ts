import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import * as lockfile from "proper-lockfile";
import { ulid } from "ulid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { getCommentsFilePath } from "../paths/index.js";
import { readCurrentUserId } from "../users/current.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { appendHistory } from "./history.js";

export class CommentError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "CommentError";
  }
}

export interface Comment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly edited?: true;
  readonly mentions?: string[];
  /**
   * Users other than {@link author} who have edited this comment, in
   * first-edit order, deduplicated. Anyone may edit anyone's comment,
   * so this is the provenance trail: renderers show the original
   * author primarily and these as "Edited by X, Y".
   *
   * The author's own edits are excluded — a self-edit sets `edited`
   * with no `editors`, which renders as a bare "Edited".
   *
   * Denormalized from the activity log, which records one
   * `comment_edited` entry per edit with its own `actor`. History is
   * authoritative; this is the display copy, kept here so rendering a
   * comment list doesn't require joining against history.yaml.
   */
  readonly editors?: string[];
}

/**
 * Pattern for `@user:<id>` mentions inside comment text.
 *
 * The `user:` prefix is required, matching the documented syntax in
 * `docs/dev/reference/markdown-extensions.md`. The previous pattern was
 * `/@([\w\-.]+)/g` — no colon — so `@user:01J…` captured the literal
 * token `user`, which was then stored as if it were a user id. Every
 * mention in a tracker collapsed to the same meaningless value.
 *
 * `(?<![\w.@-])` refuses to match when the `@` is preceded by a word
 * character, so `bob@example.com` is not a mention. Without it an
 * email address yielded `example.com` as a mention token.
 */
const MENTION_RE = /(?<![\w.@-])@user:([\w-]+)/g;

/**
 * Spans of `body` that are code, and so must not be scanned.
 *
 * A mention inside a fence or a code span is documentation of the
 * syntax, not a mention — notifying someone because their id appeared
 * in a code sample is a false positive the author cannot avoid except
 * by not writing the example.
 */
function codeSpans(body: string): readonly [number, number][] {
  const spans: [number, number][] = [];
  // Fenced blocks first: a ``` fence may legitimately contain
  // backticks, so single-backtick scanning must not see inside it.
  const fenceRe = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;
  for (const m of body.matchAll(fenceRe)) {
    if (m.index !== undefined) spans.push([m.index, m.index + m[0].length]);
  }
  const inFence = (i: number): boolean => spans.some(([a, b]) => i >= a && i < b);
  for (const m of body.matchAll(/`[^`\n]*`/g)) {
    if (m.index !== undefined && !inFence(m.index)) {
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans;
}

/**
 * Extracts mention tokens from comment body text.
 *
 * Recognises `@user:<id>` only — the documented syntax. Tokens are
 * de-duplicated in document order.
 *
 * The resolver, when provided, maps each captured id to a canonical
 * user id; tokens that don't resolve are dropped, because mentions are
 * best-effort and a typo shouldn't fail the post. Without a resolver
 * the captured id is returned as-is.
 *
 * Mentions inside code spans and fenced blocks are ignored: an id in a
 * code sample is documentation, and notifying someone for it is a
 * false positive the author cannot avoid except by not writing the
 * example.
 */
export function extractMentions(
  body: string,
  resolver?: (token: string) => string | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skip = codeSpans(body);
  for (const m of body.matchAll(MENTION_RE)) {
    const token = m[1];
    if (!token) continue;
    const at = m.index;
    if (at !== undefined && skip.some(([a, b]) => at >= a && at < b)) continue;
    const resolved = resolver ? resolver(token) : token;
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

interface CommentsFile {
  comments?: unknown;
}

/**
 * A stored entry that does not have the shape of a comment.
 *
 * P-11: a malformed entry is *kept*, not dropped. It stays at its
 * original index so the surrounding thread keeps its order, and it is
 * written back untouched — LocTT preserves what it cannot interpret
 * rather than deciding the user meant to delete it.
 *
 * `raw` is the entry exactly as read. Renderers show what they can of
 * it; `doctor` and sync pre-flight report it so the user can repair the
 * file by hand.
 */
export interface MalformedComment {
  readonly malformed: true;
  readonly index: number;
  readonly raw: unknown;
}

/** A comment thread as stored: valid comments interleaved with unusable entries. */
export type CommentEntry = Comment | MalformedComment;

export function isMalformedComment(entry: CommentEntry): entry is MalformedComment {
  return (entry as MalformedComment).malformed === true;
}

/**
 * The fields a comment cannot be rendered or ordered without.
 *
 * `created_at` is deliberately *not* required: a comment with an
 * unparseable timestamp is still a comment, and P-11 positions it by
 * its neighbours rather than discarding it. Only a missing id, author
 * or body makes an entry genuinely unusable.
 */
function isComment(value: unknown): value is Comment {
  if (value === null || typeof value !== "object") return false;
  const c = value as Partial<Comment>;
  return typeof c.id === "string"
    && typeof c.author === "string"
    && typeof c.body === "string";
}

/**
 * Reads the thread, distinguishing "no comments" from "could not read".
 *
 * The bug this replaces: any read failure returned `[]`, and
 * `postComment` wrote `[...existing, comment]` straight back — so an
 * unreadable file turned a three-comment thread into one, reported as
 * success, with no recovery. Verified 2026-08-17.
 *
 * Absent is a real state (no one has commented) and stays an empty
 * list. Unreadable throws, because every caller's next step is a write
 * and P-11 forbids overwriting what we could not read.
 */
async function readCommentEntries(locttDir: string, taskId: string): Promise<CommentEntry[]> {
  const path = getCommentsFilePath(locttDir, taskId);
  const file = await readFileState(path);
  if (file.state === "absent") return [];
  if (file.state === "unreadable") throw new UnreadableFileError(file);

  let parsed: CommentsFile | null;
  try {
    parsed = parseYaml(file.content) as CommentsFile | null;
  } catch (err) {
    // The file is there and will not parse. Returning `[]` here would
    // be the same destruction by a different route.
    throw new CommentError(
      `${path} could not be parsed as YAML, so it will not be modified: ${(err as Error).message}`,
    );
  }

  const list = parsed?.comments;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    // A `comments:` key that is not a list is a hand-edit we cannot
    // interpret. Refusing is the only option that keeps the content.
    throw new CommentError(
      `${path} has a "comments" key that is not a list, so it will not be modified.`,
    );
  }

  // `Array.isArray` narrows to `any[]`; re-typing as `unknown[]` keeps
  // the entries opaque until `isComment` has vouched for them.
  return (list as unknown[]).map((entry, index) =>
    isComment(entry) ? entry : { malformed: true as const, index, raw: entry },
  );
}

/** The valid comments only, in file order. For callers that render a thread. */
export function validComments(entries: ReadonlyArray<CommentEntry>): Comment[] {
  return entries.filter((e): e is Comment => !isMalformedComment(e));
}

/**
 * Writes the thread back, restoring malformed entries verbatim.
 *
 * P-11: a malformed entry survives a write that touches its
 * neighbours. It goes back at the index it was read from, so the
 * thread's order is unchanged and nothing the user wrote is lost
 * because LocTT could not interpret it.
 */
async function writeCommentsAtomically(
  locttDir: string,
  taskId: string,
  entries: ReadonlyArray<CommentEntry>,
): Promise<void> {
  const path = getCommentsFilePath(locttDir, taskId);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const comments = entries.map(e => (isMalformedComment(e) ? e.raw : e));
  await writeFile(tmp, stringifyYaml({ comments }), "utf-8");
  await rename(tmp, path);
}

async function withCommentsLock<T>(
  locttDir: string,
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const path = getCommentsFilePath(locttDir, taskId);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, {
    retries: { retries: 50, factor: 1.5, minTimeout: 20, maxTimeout: 500 },
    stale: 10_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release().catch(() => {});
  }
}

/**
 * The task's comments, in file order.
 *
 * Malformed entries are omitted from the *result* — a renderer has
 * nothing to show for an entry with no body — but they remain in the
 * file and survive every write. Use {@link readCommentEntries} via
 * {@link listCommentEntries} to see them, which is what `doctor` and
 * sync pre-flight do.
 *
 * Throws on an unreadable or unparseable file rather than returning an
 * empty thread, so a caller cannot mistake a failure for "no comments".
 */
export async function listComments(locttDir: string, taskId: string): Promise<Comment[]> {
  return validComments(await readCommentEntries(locttDir, taskId));
}

/** A page of a comment thread, with the full count so a caller can say
 * how many remain (CMT-20). */
export interface CommentsPage {
  readonly comments: Comment[];
  readonly total: number;
}

/**
 * A page of the comment thread (CMT-20). Comments stay in stored
 * (chronological) order; `offset`/`limit` window into them and `total` is
 * the full readable count, so a paginated view can render "showing N of
 * M" and load the rest. Malformed entries are excluded from both the page
 * and the total, exactly as `listComments` excludes them — a renderer has
 * nothing to show for one, and counting it would make the remaining-count
 * wrong. `offset`/`limit` omitted returns the whole thread (a caller that
 * does not paginate is unaffected).
 */
export async function listCommentsPage(
  locttDir: string,
  taskId: string,
  options: { readonly offset?: number; readonly limit?: number } = {},
): Promise<CommentsPage> {
  const all = validComments(await readCommentEntries(locttDir, taskId));
  const offset = Math.max(0, options.offset ?? 0);
  const comments = options.limit === undefined
    ? all.slice(offset)
    : all.slice(offset, offset + options.limit);
  return { comments, total: all.length };
}

/** The thread as stored, malformed entries included. For diagnostics. */
export async function listCommentEntries(
  locttDir: string,
  taskId: string,
): Promise<CommentEntry[]> {
  return readCommentEntries(locttDir, taskId);
}

export interface PostCommentOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly body: string;
  /** Override the author. Defaults to the current user. */
  readonly author?: string;
  /** Token → user-id resolver for mentions. */
  readonly mentionResolver?: (token: string) => string | undefined;
}

export async function postComment(opts: PostCommentOptions): Promise<Comment> {
  if (typeof opts.body !== "string" || opts.body.trim().length === 0) {
    throw new CommentError("Comment body must be a non-empty string.");
  }
  let author = opts.author;
  if (!author) {
    const current = await readCurrentUserId(opts.locttDir);
    if (!current) {
      throw new CommentError("No current user is set. An author must be given.");
    }
    author = current;
  }
  const now = new Date().toISOString();
  const mentions = extractMentions(opts.body, opts.mentionResolver);
  const comment: Comment = {
    id: ulid(),
    author,
    body: opts.body,
    created_at: now,
    ...(mentions.length > 0 ? { mentions } : {}),
  };
  const created = await withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readCommentEntries(opts.locttDir, opts.taskId);
    await writeCommentsAtomically(opts.locttDir, opts.taskId, [...existing, comment]);
    return comment;
  });
  await recordCommentEvent(opts.locttDir, opts.taskId, "comment_added", created, author);
  return created;
}

/**
 * Appends a comment lifecycle entry to the task's activity log.
 *
 * `appendHistory` stamps `actor` from the current user on its own, so
 * the acting user is recorded without being threaded through here.
 * The explicit `author` argument is the comment's *original* author,
 * which differs from the actor whenever someone edits or deletes
 * another person's comment — the case this logging exists for. It goes
 * in `meta` so the log can read "X edited Y's comment".
 *
 * Best-effort, matching `appendHistory`'s own philosophy: history must
 * not take down the operation that triggered it. The comment write has
 * already been committed by the time this runs.
 */
async function recordCommentEvent(
  locttDir: string,
  taskId: string,
  kind: "comment_added" | "comment_edited" | "comment_deleted",
  comment: Pick<Comment, "id" | "author" | "body">,
  explicitActor?: string,
  /** The comment's text before this event; only an edit has one. */
  previousBody?: string,
): Promise<void> {
  try {
    await appendHistory(locttDir, taskId, [{
      timestamp: new Date().toISOString(),
      kind,
      meta: { comment_id: comment.id, author: comment.author },
      // Carry the text (M3). A deletion is the load-bearing case: it is
      // a hard delete, so without `before` the words are gone from the
      // tracker entirely, recoverable by no means at all.
      ...(previousBody !== undefined ? { before: previousBody } : {}),
      ...(kind !== "comment_deleted" ? { after: comment.body } : {}),
      // Only set when the caller named an author explicitly; otherwise
      // leave it for appendHistory to resolve from the current user.
      ...(explicitActor !== undefined ? { actor: explicitActor } : {}),
    }]);
  } catch {
    // Comment already written; a history failure shouldn't surface as
    // a failed post/edit/delete.
  }
}

export interface EditCommentOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly commentId: string;
  readonly body: string;
  readonly mentionResolver?: (token: string) => string | undefined;
  /**
   * Override the acting user recorded in history. Defaults to the
   * current user, resolved by `appendHistory`.
   *
   * Deliberately *not* an authorization check — anyone may edit
   * anyone's comment. This only names who did it. Unlike
   * `postComment`, a missing current user does not throw: the edit
   * proceeds and the history entry is written without an actor, so
   * headless callers (scripts, migrations) keep working.
   */
  readonly actor?: string;
}

/**
 * Renders a comment's edit provenance for display next to the author,
 * e.g. `Edited by Sam`, `Edited by Sam and Alex`, `Edited by Sam,
 * Alex, and Jo`.
 *
 * Returns undefined when the comment has never been edited, so callers
 * can omit the element entirely rather than render an empty string.
 * A comment edited only by its own author returns a bare `"Edited"` —
 * `editors` excludes self-edits, so there is no name to show.
 *
 * `resolveName` maps a user id to a display name, mirroring
 * `mentionResolver`. Ids that don't resolve (deleted users) fall back
 * to the raw id rather than being dropped: an unfamiliar id is more
 * honest than silently shortening the list.
 */
export function formatCommentEditors(
  comment: Pick<Comment, "edited" | "editors">,
  resolveName?: (userId: string) => string | undefined,
): string | undefined {
  if (!comment.edited) return undefined;
  const editors = comment.editors ?? [];
  if (editors.length === 0) return "Edited";
  const names = editors.map(id => resolveName?.(id) ?? id);
  return `Edited by ${formatNameList(names)}`;
}

/** Joins names with an Oxford comma: "A", "A and B", "A, B, and C". */
function formatNameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Computes the `editors` update for a comment being edited by
 * `editor`. Returns an empty patch (leaving any existing list intact)
 * when there is nothing to add:
 *
 * - no resolvable editor — headless path, edit stays unattributed
 * - the original author editing their own comment — renders as a bare
 *   "Edited" rather than "Edited by <themselves>"
 * - an editor already in the list — repeated edits appear once
 *
 * Order is first-edit-wins, which reads chronologically in the UI.
 */
function editorsPatch(prev: Comment, editor: string | undefined): { editors?: string[] } {
  if (editor === undefined || editor === prev.author) return {};
  const current = prev.editors ?? [];
  if (current.includes(editor)) return {};
  return { editors: [...current, editor] };
}

export async function editComment(opts: EditCommentOptions): Promise<Comment> {
  if (typeof opts.body !== "string" || opts.body.trim().length === 0) {
    throw new CommentError("Comment body must be a non-empty string.");
  }
  // Resolve the editor before taking the lock — `readCurrentUserId`
  // touches the filesystem and the lock should cover the read-modify-
  // write of comments.yaml only. Unlike `postComment`, an unresolvable
  // user is not fatal: the edit proceeds unattributed.
  // `readCurrentUserId` resolves to null when no user is set; normalize
  // to undefined so "unattributed" has one representation downstream.
  const editor = opts.actor
    ?? (await readCurrentUserId(opts.locttDir).catch(() => undefined)) ?? undefined;

  // `previousBody` is captured inside the lock and returned alongside the
  // result: the pre-edit text only exists there, and history needs it.
  const { updated, previousBody } = await withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readCommentEntries(opts.locttDir, opts.taskId);
    // Malformed entries have no id to match, so they can never be the
    // target — but they keep their slot in `existing` and are written
    // back by `writeCommentsAtomically`.
    const idx = existing.findIndex(c => !isMalformedComment(c) && c.id === opts.commentId);
    if (idx === -1) throw new CommentError(`Unknown comment id: ${opts.commentId}`);
    const prev = existing[idx];
    if (prev === undefined || isMalformedComment(prev)) {
      throw new CommentError(`Unknown comment id: ${opts.commentId}`);
    }
    const mentions = extractMentions(opts.body, opts.mentionResolver);
    const base = {
      ...prev,
      body: opts.body,
      updated_at: new Date().toISOString(),
      edited: true as const,
      ...editorsPatch(prev, editor),
    };
    const updated: Comment = mentions.length > 0
      ? { ...base, mentions }
      : (() => {
          const { mentions: _m, ...rest } = base;
          return rest;
        })();
    const next = [...existing];
    next[idx] = updated;
    await writeCommentsAtomically(opts.locttDir, opts.taskId, next);
    return { updated, previousBody: prev.body };
  });
  // `updated.author` is the *original* author, preserved by the spread
  // above — so editing someone else's comment records both parties.
  // Pass the already-resolved editor so the history actor and the
  // comment's `editors` list can't disagree about who did this.
  await recordCommentEvent(
    opts.locttDir,
    opts.taskId,
    "comment_edited",
    updated,
    editor,
    previousBody,
  );
  return updated;
}

export interface DeleteCommentOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly commentId: string;
  /** Override the acting user recorded in history. See {@link EditCommentOptions.actor}. */
  readonly actor?: string;
}

export async function deleteComment(opts: DeleteCommentOptions): Promise<void> {
  const removed = await withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readCommentEntries(opts.locttDir, opts.taskId);
    // A malformed entry is never the target and is never filtered out:
    // deleting one comment must not take an uninterpretable neighbour
    // with it (P-11).
    const target = existing.find(
      (c): c is Comment => !isMalformedComment(c) && c.id === opts.commentId,
    );
    const next = existing.filter(c => isMalformedComment(c) || c.id !== opts.commentId);
    if (next.length === existing.length || !target) {
      throw new CommentError(`Unknown comment id: ${opts.commentId}`);
    }
    await writeCommentsAtomically(opts.locttDir, opts.taskId, next);
    return target;
  });
  // The deleted text is `removed.body` — recorded as `before` so a hard
  // delete leaves a recoverable trace.
  await recordCommentEvent(
    opts.locttDir,
    opts.taskId,
    "comment_deleted",
    removed,
    opts.actor,
    removed.body,
  );
}

/**
 * Builds the mention resolver `postComment` / `editComment` expect,
 * from a user list loaded once by the caller.
 *
 * The hook is synchronous by design — it runs once per mention inside
 * the comments lock — so the user list has to be read up front. Doing
 * it here rather than in each surface means the CLI, MCP and HTTP all
 * resolve `@user:<id>` the same way instead of three near-identical
 * lookups drifting apart.
 *
 * Accepts an id or an exact name. Deliberately no prefix matching,
 * unlike `resolveUserRef`: a mention is written once and read by
 * everyone, so an ambiguous prefix silently resolving to whoever
 * happens to sort first is worse than not resolving at all. An
 * unresolved mention is dropped, which is the documented best-effort
 * behaviour — a typo must not fail the post.
 */
export function buildMentionResolver(
  // `name` is optional: Phase-7B (K26/O5) made a user's name a degradable
  // field, so a hand-corrupted profile can load with no name. A nameless
  // user still resolves by id; it simply cannot be @-mentioned by name.
  users: readonly { readonly id: string; readonly name?: string | undefined }[],
): (token: string) => string | undefined {
  const byId = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const u of users) {
    byId.set(u.id, u.id);
    if (u.name !== undefined) {
      byName.set(u.name, [...(byName.get(u.name) ?? []), u.id]);
    }
  }
  return (token: string) => {
    const byIdHit = byId.get(token);
    if (byIdHit !== undefined) return byIdHit;
    const named = byName.get(token);
    // Exactly one match, or nothing: an ambiguous name is not resolved.
    return named !== undefined && named.length === 1 ? named[0] : undefined;
  };
}

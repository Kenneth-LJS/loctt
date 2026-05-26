import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import * as lockfile from "proper-lockfile";
import { ulid } from "ulid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getCommentsFilePath } from "../paths/index.js";
import { readCurrentUserId } from "../users/current.js";

export class CommentError extends Error {
  constructor(message: string) {
    super(message);
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
}

/**
 * Pattern for `@<user-id-or-name-token>` mentions inside comment text.
 * The trailing boundary is non-greedy: stops at whitespace, punctuation,
 * or end-of-string. The token is opaque to the parser — resolution
 * against the user list happens above, via the optional resolver.
 */
const MENTION_RE = /@([\w\-.]+)/g;

/**
 * Extracts mention tokens from comment body text.
 *
 * Tokens are de-duplicated in document order. The resolver, when
 * provided, maps each token to a user id; tokens that don't resolve are
 * dropped (mentions are best-effort — a typo shouldn't fail the post).
 */
export function extractMentions(
  body: string,
  resolver?: (token: string) => string | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const token = m[1];
    if (!token) continue;
    const resolved = resolver ? resolver(token) : token;
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

interface CommentsFile {
  comments?: Comment[];
}

async function readFileOrEmpty(locttDir: string, taskId: string): Promise<Comment[]> {
  const path = getCommentsFilePath(locttDir, taskId);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const parsed = parseYaml(content) as CommentsFile | null;
  const list = parsed?.comments;
  return Array.isArray(list) ? list : [];
}

async function writeCommentsAtomically(
  locttDir: string,
  taskId: string,
  comments: Comment[],
): Promise<void> {
  const path = getCommentsFilePath(locttDir, taskId);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
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

export async function listComments(locttDir: string, taskId: string): Promise<Comment[]> {
  return readFileOrEmpty(locttDir, taskId);
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
    throw new CommentError("comment body must be a non-empty string");
  }
  let author = opts.author;
  if (!author) {
    const current = await readCurrentUserId(opts.locttDir);
    if (!current) {
      throw new CommentError("no current user set; pass an explicit author");
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
  return withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readFileOrEmpty(opts.locttDir, opts.taskId);
    await writeCommentsAtomically(opts.locttDir, opts.taskId, [...existing, comment]);
    return comment;
  });
}

export interface EditCommentOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly commentId: string;
  readonly body: string;
  readonly mentionResolver?: (token: string) => string | undefined;
}

export async function editComment(opts: EditCommentOptions): Promise<Comment> {
  if (typeof opts.body !== "string" || opts.body.trim().length === 0) {
    throw new CommentError("comment body must be a non-empty string");
  }
  return withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readFileOrEmpty(opts.locttDir, opts.taskId);
    const idx = existing.findIndex(c => c.id === opts.commentId);
    if (idx === -1) throw new CommentError(`unknown comment id: ${opts.commentId}`);
    const prev = existing[idx];
    if (!prev) throw new CommentError(`unknown comment id: ${opts.commentId}`);
    const mentions = extractMentions(opts.body, opts.mentionResolver);
    const base = {
      ...prev,
      body: opts.body,
      updated_at: new Date().toISOString(),
      edited: true as const,
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
    return updated;
  });
}

export interface DeleteCommentOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly commentId: string;
}

export async function deleteComment(opts: DeleteCommentOptions): Promise<void> {
  await withCommentsLock(opts.locttDir, opts.taskId, async () => {
    const existing = await readFileOrEmpty(opts.locttDir, opts.taskId);
    const next = existing.filter(c => c.id !== opts.commentId);
    if (next.length === existing.length) {
      throw new CommentError(`unknown comment id: ${opts.commentId}`);
    }
    await writeCommentsAtomically(opts.locttDir, opts.taskId, next);
  });
}

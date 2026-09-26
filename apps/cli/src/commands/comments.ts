import {
buildMentionResolver,
  CommentError,    deleteComment,
  editComment,
  formatCommentEditors,
  listComments,
  loadAllUsers,
  lookupTask,
  postComment,
  resolveLocttDir,
} from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, UsageError } from "../runtime/errors.js";

/**
 * `loctt comment` — post, list, edit and delete task comments.
 *
 * Core implemented all four operations with no caller on any surface,
 * so comments were documented as shipped and unreachable in practice.
 *
 * There is deliberately no ownership check on edit or delete: LocTT
 * has no roles or permissions and users switch identity freely, so a
 * guard here would be the product's only permission rule while
 * protecting nothing. `editors` records who touched someone else's
 * comment instead.
 */

async function resolver(locttDir: string) {
  return buildMentionResolver(await loadAllUsers(locttDir));
}

/** `loctt comment <task> <body>` */
/**
 * Accepted flags per command. `getArg`/`hasFlag` are pure extractors and
 * cannot notice a flag nobody asked about, so without this an unknown
 * option is silently dropped and the command runs without it.
 */
const ADD_FLAGS: readonly string[] = [];
const LIST_FLAGS: readonly string[] = [];
const EDIT_FLAGS: readonly string[] = [];
const REMOVE_FLAGS: readonly string[] = ["--yes"];

export async function add(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ADD_FLAGS);
  const ref = args[1];
  // Every remaining argument is body text. The previous
  // `.filter(a => !a.startsWith("--"))` silently dropped any word
  // beginning with `--` — "see the --force flag docs" lost a word on a
  // write path, with nothing reported. `rejectUnknownFlags` above now
  // refuses such an invocation outright, so the filter was unreachable;
  // leaving it in place would quietly corrupt bodies the day the flag
  // list grows. Quote the body to include leading dashes.
  const body = args.slice(2).join(" ");
  if (!ref || body.trim().length === 0) {
    throw new UsageError("missing args", "loctt comment <task> <body>");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  let comment;
  try {
    comment = await postComment({
      locttDir,
      taskId: task.frontmatter.id,
      body,
      mentionResolver: await resolver(locttDir),
    });
  } catch (err) {
    // Core's message says "pass an explicit author", which is not
    // something the CLI can do — it has no author flag. Name the command
    // that actually fixes it, and give the text back: the user typed a
    // paragraph and should not have to reconstruct it from memory
    // (CMT-C2).
    if (err instanceof CommentError && /no current user/i.test(err.message)) {
      throw new CommentError(
        `no current user set. Run 'loctt user switch <name>' (or `
        + `'loctt user create <name> --switch') and post again.\n`
        + `Your comment text was:\n${body}`,
      );
    }
    throw err;
  }
  console.log(`Added comment ${comment.id} on ${task.frontmatter.key}`);
  if (comment.mentions && comment.mentions.length > 0) {
    console.log(`Mentioned: ${comment.mentions.join(", ")}`);
  }
}

/** `loctt comments <task>` */
export async function list(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, LIST_FLAGS);
  const ref = args[1];
  if (!ref) throw new UsageError("missing args", "loctt comments <task>");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const comments = await listComments(locttDir, task.frontmatter.id);
  if (comments.length === 0) {
    console.log(`No comments on ${task.frontmatter.key}`);
    return;
  }
  for (const c of comments) {
    // The author stays primary even when someone else edited — the
    // edit trail is secondary, not a transfer of authorship.
    const editors = formatCommentEditors(c);
    const edited = editors ?? (c.edited ? "Edited" : undefined);
    console.log(`${c.id}  ${c.author}  ${c.created_at}${edited ? `  (${edited})` : ""}`);
    for (const line of c.body.split("\n")) console.log(`  ${line}`);
    console.log("");
  }
}

/** `loctt comment-edit <task> <comment-id> <body>` */
export async function edit(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, EDIT_FLAGS);
  const ref = args[1];
  const commentId = args[2];
  // Same as `add`: every remaining argument is body text, and the
  // filter here silently dropped `--`-prefixed words from an edit.
  const body = args.slice(3).join(" ");
  if (!ref || !commentId || body.trim().length === 0) {
    throw new UsageError("missing args", "loctt comment-edit <task> <comment-id> <body>");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const comment = await editComment({
    locttDir,
    taskId: task.frontmatter.id,
    commentId,
    body,
    mentionResolver: await resolver(locttDir),
  });
  console.log(`Edited comment ${comment.id} on ${task.frontmatter.key}`);
}

/** `loctt comment-delete <task> <comment-id> [--yes]` */
export async function remove(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, REMOVE_FLAGS);
  const ref = args[1];
  const commentId = args[2];
  if (!ref || !commentId) {
    throw new UsageError("missing args", "loctt comment-delete <task> <comment-id> [--yes]");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);

  // Deleting a comment is permanent, like `delete` and every entity
  // `delete`. It alone had no gate — CMT-C1 says the CLI deletes "behind
  // a confirmation". M3 keeps the text in history, so this is
  // recoverable, but a typo'd id should still not silently destroy
  // someone else's words.
  const outcome = await confirmHardDelete(
    args,
    `Permanently delete comment ${commentId} from ${task.frontmatter.key}?`,
  );
  if (outcome !== "yes") {
    process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
    return;
  }

  await deleteComment({ locttDir, taskId: task.frontmatter.id, commentId });
  console.log(`Deleted comment ${commentId} from ${task.frontmatter.key}`);
}

import {
  buildMentionResolver,
  deleteComment,
  editComment,
  formatCommentEditors,
  listComments,
  loadAllUsers,
  lookupTask,
  postComment,
  resolveLocttDir,
} from "@loctt/core";

import { UsageError } from "../runtime/errors.js";

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
export async function add(args: string[], root: string): Promise<void> {
  const ref = args[1];
  const body = args.slice(2).filter(a => !a.startsWith("--")).join(" ");
  if (!ref || body.trim().length === 0) {
    throw new UsageError("missing args", "loctt comment <task> <body>");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const comment = await postComment({
    locttDir,
    taskId: task.frontmatter.id,
    body,
    mentionResolver: await resolver(locttDir),
  });
  console.log(`Added comment ${comment.id} on ${task.frontmatter.key}`);
  if (comment.mentions && comment.mentions.length > 0) {
    console.log(`Mentioned: ${comment.mentions.join(", ")}`);
  }
}

/** `loctt comments <task>` */
export async function list(args: string[], root: string): Promise<void> {
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
  const ref = args[1];
  const commentId = args[2];
  const body = args.slice(3).filter(a => !a.startsWith("--")).join(" ");
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

/** `loctt comment-delete <task> <comment-id>` */
export async function remove(args: string[], root: string): Promise<void> {
  const ref = args[1];
  const commentId = args[2];
  if (!ref || !commentId) {
    throw new UsageError("missing args", "loctt comment-delete <task> <comment-id>");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  await deleteComment({ locttDir, taskId: task.frontmatter.id, commentId });
  console.log(`Deleted comment ${commentId} from ${task.frontmatter.key}`);
}

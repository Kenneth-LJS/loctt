/**
 * Comment tools.
 *
 * Core implemented post/list/edit/delete with no caller on any
 * surface, so comments were documented as shipped and unreachable.
 *
 * No ownership check on edit or delete: LocTT has no roles or
 * permissions and users switch identity freely, so a guard here would
 * be the product's only permission rule while protecting nothing.
 * `editors` records who touched someone else's comment instead.
 */
import {
  buildMentionResolver,
  deleteComment,
  editComment,
  listComments,
  loadAllUsers,
  lookupTask,
  postComment,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
/*
 * These handlers deliberately do not catch.
 *
 * Each used to wrap its core call in `try { … } catch (err) { return
 * errorResult((err as Error).message); }`, which turned *any* throw —
 * a TypeError, an unexpected I/O fault — into a routine domain error
 * an agent reads as "your request was rejected."
 *
 * The dispatcher in `index.ts` already does this correctly: it returns
 * an errorResult for a known domain error and rethrows everything else,
 * because masking a real bug hides the diagnosis. These local catches
 * sat inside it and pre-empted it, so that discipline never ran for
 * comments.
 */
import type { ToolDef } from "../types.js";

async function resolver(locttDir: string) {
  return buildMentionResolver(await loadAllUsers(locttDir));
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_comments",
    description:
      "List a task's comments in creation order. Each carries its author, " +
      "body, timestamps, resolved mentions, and — when someone other than " +
      "the author edited it — an `editors` provenance list.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const comments = await listComments(locttDir, task.frontmatter.id);
      return text(JSON.stringify(comments, null, 2));
    },
  },
  {
    name: "post_comment",
    description:
      "Add a comment to a task. Mentions written as `@user:<id>` are " +
      "resolved against the user list and recorded on the comment; an " +
      "unresolvable mention is dropped rather than failing the post. " +
      "The author is the current user.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      body: z.string().min(1),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const comment = await postComment({
        locttDir,
        taskId: task.frontmatter.id,
        body: args["body"] as string,
        mentionResolver: await resolver(locttDir),
      });
      return text(`Added comment ${comment.id} on ${task.frontmatter.key}`);
    },
  },
  {
    name: "edit_comment",
    description:
      "Replace a comment's body. Anyone may edit anyone's comment — this " +
      "is not an ownership check. The original author is preserved and the " +
      "editor is appended to the comment's `editors` list, so the change " +
      "is traceable.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      comment_id: z.string().describe("Comment ID from list_comments"),
      body: z.string().min(1),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const comment = await editComment({
        locttDir,
        taskId: task.frontmatter.id,
        commentId: args["comment_id"] as string,
        body: args["body"] as string,
        mentionResolver: await resolver(locttDir),
      });
      return text(`Edited comment ${comment.id} on ${task.frontmatter.key}`);
    },
  },
  {
    name: "delete_comment",
    description:
      "Permanently remove a comment. Anyone may delete anyone's comment. " +
      "The deletion is recorded in the task's activity log. " +
      "Always requires `confirm: true`.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      comment_id: z.string().describe("Comment ID from list_comments"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_comment");
      if (blocked) return blocked;
      const task = await lookupTask(locttDir, args["ref"] as string);
      await deleteComment({
        locttDir,
        taskId: task.frontmatter.id,
        commentId: args["comment_id"] as string,
      });
      return text(`Deleted comment from ${task.frontmatter.key}`);
    },
  },
];

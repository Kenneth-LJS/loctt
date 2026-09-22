import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLoctt } from "../init/init.js";
import { getCommentsFilePath, resolveLocttDir } from "../paths/index.js";
import * as comments from "../task/comments.js";
import { postComment } from "../task/comments.js";
import { writeCurrentUserId } from "../users/current.js";
import { listTasks } from "./list.js";
import { loadCommentMentions, queryReferencesCommentMentions, resolveCommentMentionsContext } from "./list.js";

/**
 * @verifies CMT-10
 *
 * The comment-mention loader and its query gate. The loader merges
 * mentions across *all* of a task's comments (deduped); the gate keeps a
 * list that does not filter on `comment_mentions` from reading any comment
 * files.
 */

let root: string;
let locttDir: string;

const mkTask = (id: string): Task =>
  ({ frontmatter: { id, key: "T-1", title: "t" }, body: "" }) as unknown as Task;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-mentions-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  await writeCurrentUserId(locttDir, "u_alice");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("loadCommentMentions (CMT-10)", () => {
  it("merges mentions across multiple comments on a task and dedupes", async () => {
    const taskId = "task_multi";
    // Two comments, each mentioning a different user; the second also
    // repeats the first user, so dedupe is exercised too.
    await postComment({ locttDir, taskId, body: "cc @user:u_bob", author: "u_alice" });
    await postComment({ locttDir, taskId, body: "cc @user:u_carol and @user:u_bob", author: "u_alice" });

    const byTask = await loadCommentMentions(locttDir, [mkTask(taskId)]);
    const merged = byTask.get(taskId);
    expect(merged).toBeDefined();
    // Both users present — the union spans BOTH comments, not just the first.
    expect(new Set(merged)).toEqual(new Set(["u_bob", "u_carol"]));
  });

  it("returns nothing for a task with no comments", async () => {
    const byTask = await loadCommentMentions(locttDir, [mkTask("task_empty")]);
    expect(byTask.get("task_empty")).toBeUndefined();
  });

  it("skips a task whose comments file is corrupt, keeping the good tasks loading", async () => {
    // Task A has a readable comment; task B's _comments.yaml is corrupt.
    // A read filter must not be taken down by one unreadable thread: A's
    // mention still loads, B degrades to no mentions rather than throwing.
    const goodId = "task_good";
    const badId = "task_bad";
    await postComment({ locttDir, taskId: goodId, body: "cc @user:u_alice", author: "u_alice" });
    // Also seed B with a real comment, then clobber the file so we know
    // the omission is the degrade, not "B never had a mention".
    await postComment({ locttDir, taskId: badId, body: "cc @user:u_bob", author: "u_alice" });
    const badPath = getCommentsFilePath(locttDir, badId);
    await mkdir(dirname(badPath), { recursive: true });
    // Unterminated flow sequence — YAML parse fails, so listComments throws.
    await writeFile(badPath, "comments: [ this is not: valid yaml", "utf8");

    // Bad task ordered FIRST, so a regression that lets one corrupt file
    // abort the loop (or throw out of the loader) loses the good task's
    // mention — the assertion catches it regardless of iteration order.
    const byTask = await loadCommentMentions(locttDir, [mkTask(badId), mkTask(goodId)]);
    expect(byTask.get(goodId)).toEqual(["u_alice"]);
    expect(byTask.get(badId)).toBeUndefined();
  });
});

describe("queryReferencesCommentMentions gate (CMT-10)", () => {
  it("is true only when the query references the field as a field token", () => {
    expect(queryReferencesCommentMentions("comment_mentions = u_bob")).toBe(true);
    expect(queryReferencesCommentMentions("status = done")).toBe(false);
    // A string literal that merely contains the word is not a false positive.
    expect(queryReferencesCommentMentions('title ~ "comment_mentions"')).toBe(false);
  });

  it("does not read any comment files when the query does not reference the field", async () => {
    const taskId = "task_gate";
    await postComment({ locttDir, taskId, body: "cc @user:u_bob", author: "u_alice" });
    const spy = vi.spyOn(comments, "listComments");

    const ctx = await resolveCommentMentionsContext(
      locttDir,
      [mkTask(taskId)],
      { resolveKey: () => undefined },
      ["status = done", undefined],
    );

    // Gate closed: no comment scan, and no mention lookup on the context.
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.getCommentMentions).toBeUndefined();
  });

  it("reads comments and exposes them when the query references the field", async () => {
    const taskId = "task_open";
    await postComment({ locttDir, taskId, body: "cc @user:u_bob", author: "u_alice" });

    const ctx = await resolveCommentMentionsContext(
      locttDir,
      [mkTask(taskId)],
      { resolveKey: () => undefined },
      ["comment_mentions = u_bob"],
    );

    expect(ctx.getCommentMentions?.(taskId)).toEqual(["u_bob"]);
  });

  it("list by comment_mentions still returns the good task when another's comments are corrupt", async () => {
    // End-to-end through listTasks: the gated load skips the corrupt
    // thread, so the query resolves against the readable one and the list
    // does not die because a different task's _comments.yaml is unreadable.
    const good = { frontmatter: { id: "e2e_good", key: "T-1", title: "good" }, body: "" } as unknown as Task;
    const bad = { frontmatter: { id: "e2e_bad", key: "T-2", title: "bad" }, body: "" } as unknown as Task;
    await postComment({ locttDir, taskId: good.frontmatter.id, body: "cc @user:u_alice", author: "u_alice" });
    const badPath = getCommentsFilePath(locttDir, bad.frontmatter.id);
    await mkdir(dirname(badPath), { recursive: true });
    await writeFile(badPath, "comments: [ broken", "utf8");

    // Bad task first, so a loader regression drops the good task's mention.
    const ctx = await resolveCommentMentionsContext(
      locttDir,
      [bad, good],
      { resolveKey: () => undefined },
      ['comment_mentions = "u_alice"'],
    );
    const result = listTasks({
      tasks: [bad, good],
      options: { query: 'comment_mentions = "u_alice"', archivedScope: "all" },
      ctx,
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["T-1"]);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { writeCurrentUserId } from "../users/current.js";
import {
  CommentError,
  deleteComment,
  editComment,
  extractMentions,
  listComments,
  postComment,
} from "./comments.js";

let root: string;
let locttDir: string;
const taskId = "task_id_1";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-comments-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  await writeCurrentUserId(locttDir, "u_alice");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("extractMentions", () => {
  it("returns tokens in document order, deduped", () => {
    expect(extractMentions("hi @alice and @bob and @alice again")).toEqual(["alice", "bob"]);
  });

  it("uses the resolver to map tokens to user ids", () => {
    const resolve = (t: string) => ({ alice: "u_alice", bob: "u_bob" }[t]);
    expect(extractMentions("ping @alice and @ghost", resolve)).toEqual(["u_alice"]);
  });

  it("returns empty list when no mentions", () => {
    expect(extractMentions("nothing here")).toEqual([]);
  });
});

describe("comments lifecycle", () => {
  it("postComment writes a comment with id, author, created_at", async () => {
    const c = await postComment({ locttDir, taskId, body: "first comment" });
    expect(c.id).toBeTruthy();
    expect(c.author).toBe("u_alice");
    expect(c.body).toBe("first comment");
    expect(c.created_at).toBeTruthy();
    expect((await listComments(locttDir, taskId))[0]?.id).toBe(c.id);
  });

  it("postComment captures mentions when a resolver is supplied", async () => {
    const c = await postComment({
      locttDir, taskId, body: "ping @bob",
      mentionResolver: t => ({ bob: "u_bob" }[t]),
    });
    expect(c.mentions).toEqual(["u_bob"]);
  });

  it("postComment rejects empty body", async () => {
    await expect(postComment({ locttDir, taskId, body: "" })).rejects.toThrow(CommentError);
    await expect(postComment({ locttDir, taskId, body: "   " })).rejects.toThrow(CommentError);
  });

  it("editComment marks edited and bumps updated_at", async () => {
    const c = await postComment({ locttDir, taskId, body: "v1" });
    const edited = await editComment({ locttDir, taskId, commentId: c.id, body: "v2" });
    expect(edited.body).toBe("v2");
    expect(edited.edited).toBe(true);
    expect(edited.updated_at).toBeTruthy();
  });

  it("editComment recomputes mentions on edit", async () => {
    const c = await postComment({
      locttDir, taskId, body: "@alice",
      mentionResolver: t => ({ alice: "u_alice" }[t]),
    });
    expect(c.mentions).toEqual(["u_alice"]);
    const edited = await editComment({
      locttDir, taskId, commentId: c.id, body: "no mention now",
      mentionResolver: t => ({ alice: "u_alice" }[t]),
    });
    expect(edited.mentions).toBeUndefined();
  });

  it("editComment rejects unknown id", async () => {
    await expect(
      editComment({ locttDir, taskId, commentId: "nope", body: "x" }),
    ).rejects.toThrow(CommentError);
  });

  it("deleteComment removes the entry", async () => {
    const c = await postComment({ locttDir, taskId, body: "x" });
    await deleteComment({ locttDir, taskId, commentId: c.id });
    expect(await listComments(locttDir, taskId)).toEqual([]);
  });

  it("deleteComment rejects unknown id", async () => {
    await expect(
      deleteComment({ locttDir, taskId, commentId: "nope" }),
    ).rejects.toThrow(CommentError);
  });

  it("listComments returns [] when file is missing", async () => {
    expect(await listComments(locttDir, "absent_task")).toEqual([]);
  });

  it("comments preserve append order", async () => {
    const a = await postComment({ locttDir, taskId, body: "a" });
    const b = await postComment({ locttDir, taskId, body: "b" });
    const c = await postComment({ locttDir, taskId, body: "c" });
    const list = await listComments(locttDir, taskId);
    expect(list.map(x => x.id)).toEqual([a.id, b.id, c.id]);
  });
});

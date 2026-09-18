import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommentResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Comment routes (item 9). Core implemented post/list/edit/delete with
 * zero production callers, while ui/features.md described comments as
 * shipped and 38 UI cases were written against them.
 */
describe("comment routes", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-comments-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
    await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "subject" }),
    });
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const post = async (body: string) => {
    const res = await fetch(`${base}/api/tasks/T-1/comments`, {
      method: "POST", headers: csrf, body: JSON.stringify({ body }),
    });
    return { status: res.status, comment: (await res.json()) as CommentResponse };
  };
  const list = async (): Promise<CommentResponse[]> =>
    (await (await fetch(`${base}/api/tasks/T-1/comments`)).json()) as CommentResponse[];

  it("posts a comment and returns 201", async () => {
    const { status, comment } = await post("first");
    expect(status).toBe(201);
    expect(comment.body).toBe("first");
    expect(comment.author).toBeTruthy();
    expect(comment.id).toBeTruthy();
  });

  it("lists comments in creation order", async () => {
    await post("one");
    await post("two");
    expect((await list()).map(c => c.body)).toEqual(["one", "two"]);
  });

  it("persists across a reload, not just in the response", async () => {
    const { comment } = await post("durable");
    // Fresh read through the list route rather than trusting the echo.
    expect((await list()).map(c => c.id)).toContain(comment.id);
  });

  it("edits a comment and marks it edited", async () => {
    const { comment } = await post("before");
    const res = await fetch(`${base}/api/tasks/T-1/comments/${comment.id}`, {
      method: "PUT", headers: csrf, body: JSON.stringify({ body: "after" }),
    });
    expect(res.status).toBe(200);
    const edited = (await res.json()) as CommentResponse;
    expect(edited.body).toBe("after");
    expect(edited.edited).toBe(true);
    // The author is preserved — editing is not a transfer of authorship.
    expect(edited.author).toBe(comment.author);
    expect((await list())[0]?.body).toBe("after");
  });

  it("deletes a comment", async () => {
    const { comment } = await post("doomed");
    const res = await fetch(`${base}/api/tasks/T-1/comments/${comment.id}`, {
      method: "DELETE", headers: csrf,
    });
    expect(res.status).toBe(200);
    expect(await list()).toEqual([]);
  });

  // @verifies CMT-24
  it("editing a comment deleted elsewhere reports it is gone, not a raw id", async () => {
    // CMT-24's first bullet: the save must *report that the comment no
    // longer exists*, in words a user can act on — not core's raw
    // "unknown comment id: <ulid>", which reads as malformed input and
    // names an id the user never typed. This mirrors the delete path,
    // which already translates the same core error (CMT-34).
    const { comment } = await post("about to vanish");
    // Delete it out from under the pending edit.
    await fetch(`${base}/api/tasks/T-1/comments/${comment.id}`, {
      method: "DELETE", headers: csrf,
    });
    const res = await fetch(`${base}/api/tasks/T-1/comments/${comment.id}`, {
      method: "PUT", headers: csrf, body: JSON.stringify({ body: "too late" }),
    });
    expect(res.status).toBe(400);
    const env = (await res.json()) as { error: string; recovery?: { kind: string } };
    // The message names the situation, and does NOT leak the ulid.
    expect(env.error).toMatch(/already gone|no longer exists|someone else deleted/i);
    expect(env.error).not.toContain(comment.id);
    // Refresh is the way out — the same recovery the delete path gives.
    expect(env.recovery?.kind).toBe("reload");
  });

  it("resolves @user:<id> mentions against the user list", async () => {
    // The seeded user's id, taken from a comment's own author — the
    // author IS the current user, so this needs no extra endpoint.
    const { comment: seed } = await post("seed");
    const me = seed.author;
    const { comment } = await post(`ping @user:${me}`);
    expect(comment.mentions).toEqual([me]);
  });

  it("drops an unresolvable mention rather than failing the post", async () => {
    // Best-effort by design: a typo must not lose the comment.
    const { status, comment } = await post("ping @user:nobody_here");
    expect(status).toBe(201);
    expect(comment.mentions ?? []).toEqual([]);
  });

  it("rejects an empty body", async () => {
    const res = await fetch(`${base}/api/tasks/T-1/comments`, {
      method: "POST", headers: csrf, body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown task", async () => {
    const res = await fetch(`${base}/api/tasks/T-404/comments`);
    expect(res.status).toBe(404);
  });

  it("errors for an unknown comment id", async () => {
    const res = await fetch(`${base}/api/tasks/T-1/comments/nope`, {
      method: "DELETE", headers: csrf,
    });
    expect(res.status).toBe(400);
  });

  it("returns an empty list for a task with no comments", async () => {
    expect(await list()).toEqual([]);
  });
});

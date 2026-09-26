import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskResponse } from "@loctt/contracts";
import { initLoctt, readHistory } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * K2's precondition on the body write path, and TSK-16's one entry per save (K128).
 *
 * Core had `bodyToken`, `BodyWriteOptions.expectedToken` and
 * `StaleBodyWriteError` with **no caller anywhere** — this is the
 * wire-up, so these tests are the first thing that would notice it
 * being unwired again.
 *
 * Everything asserts against the file on disk rather than against the
 * response, because P1 is that the files are the truth and a 200 that
 * wrote nothing is exactly the failure this guard exists to prevent.
 */
describe("POST /api/tasks/:ref/body — the K2 precondition", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let taskId: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-body-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
    await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "subject" }),
    });
    taskId = (await get()).frontmatter.id;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const get = async (): Promise<TaskResponse> =>
    (await (await fetch(`${base}/api/tasks/T-1`)).json()) as TaskResponse;

  const write = async (body: string, expectedToken?: string) => {
    const res = await fetch(`${base}/api/tasks/T-1/body`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify(expectedToken === undefined ? { body } : { body, expectedToken }),
    });
    return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
  };

  /** The body straight off `task.md`, past the API entirely. */
  const onDisk = async (): Promise<string> => {
    const raw = await readFile(join(root, ".loctt/tasks", taskId, "task.md"), "utf-8");
    const end = raw.indexOf("\n---", 4);
    return raw.slice(raw.indexOf("\n", end + 1) + 1);
  };

  // @verifies XS-11
  it("returns a body token on read that changes when the body changes", async () => {
    const first = await get();
    expect(first.bodyToken).toBeTruthy();

    // The same read twice gives the same token — otherwise every
    // write would conflict with its own predecessor.
    expect((await get()).bodyToken).toBe(first.bodyToken);

    await write("changed", first.bodyToken);
    expect((await get()).bodyToken).not.toBe(first.bodyToken);
  });

  // @verifies XS-13
  it("refuses a write carrying a stale token and leaves the file untouched", async () => {
    const stale = (await get()).bodyToken;

    // Another writer lands in between — this is XS-13's window,
    // between the client's read and its write.
    await write("the other writer's text", undefined);
    const afterOther = await onDisk();

    const { status, payload } = await write("my draft", stale);

    expect(status).toBe(409);
    expect(payload["code"]).toBe("conflict");
    // ERR-18: the user must be told their text did not land.
    expect(payload["data_state"]).toBe("not_saved");
    expect(String(payload["message"])).toContain("NOT been saved");

    // The far end: the file still holds the other writer's text, not
    // the draft that was refused.
    expect(await onDisk()).toBe(afterOther);
    expect(await onDisk()).not.toContain("my draft");
  });

  // @verifies XS-12
  it("carries the current on-disk body in the conflict so both sides can be shown", async () => {
    const stale = (await get()).bodyToken;
    await write("what the CLI wrote", undefined);

    const { payload } = await write("what I wrote", stale);
    const detail = JSON.parse(String(payload["detail"])) as {
      theirs: string; bodyToken: string;
    };

    // XS-12: both texts shown in full, not summarized. The server has
    // to supply "theirs" — a client fetching it separately could race
    // a third writer and show a version that is already gone.
    expect(detail.theirs).toContain("what the CLI wrote");
    // And a usable token, so resolving is still a conditional write.
    expect(detail.bodyToken).toBeTruthy();
    expect(detail.bodyToken).toBe((await get()).bodyToken);
  });

  // @verifies XS-13
  it("accepts a fresh token and writes, so the guard is not refusing everything", async () => {
    // The positive half. Without it, a server that rejected every
    // write with 409 would satisfy the refusal tests above.
    const { status } = await write("accepted text", (await get()).bodyToken);
    expect(status).toBe(200);
    expect(await onDisk()).toContain("accepted text");
  });

  it("still accepts a write with no token at all — last-write-wins stays the default", async () => {
    // CLI and MCP do not send one yet (see the report). If the server
    // required it, every existing writer would break; if it silently
    // ignored a *supplied* one, the guard above would be theatre. Both
    // halves are asserted, here and in the refusal test.
    const { status } = await write("unconditional");
    expect(status).toBe(200);
    expect(await onDisk()).toContain("unconditional");
  });

  it("rejects a non-string token rather than ignoring it", async () => {
    // The probe's own trap, generalised: an unrecognised or wrongly
    // typed precondition that is silently dropped reads exactly like
    // a precondition that does not work.
    const res = await fetch(`${base}/api/tasks/T-1/body`, {
      method: "POST", headers: csrf,
      body: JSON.stringify({ body: "x", expectedToken: 42 }),
    });
    expect(res.status).toBe(400);
    expect(await onDisk()).not.toContain("x");
  });
});

/**
 * TSK-16, amended by K128 (Ken, 2026-09-24): every body save records its
 * own history entry.
 *
 * SUPERSEDED: this test asserted "rapid body writes coalesce into one
 * history entry" — core's 15-minute same-actor merge, made for the old
 * autosave. It was green and asserted the rule Ken removed: under K124
 * each write is a deliberate Save, and merging folded Saves minutes
 * apart into one entry. The web path is covered here so a merge
 * reintroduced anywhere below the route is noticed.
 */
describe("TSK-16 — each body write records its own history entry", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let taskId: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-coalesce-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
    await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "subject" }),
    });
    const task = (await (await fetch(`${base}/api/tasks/T-1`)).json()) as TaskResponse;
    taskId = task.frontmatter.id;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies TSK-16
  it("records one body_edited entry per write, each with its own before and after", async () => {
    const drafts = ["one", "one two", "one two three", "one two three four"];
    for (const body of drafts) {
      const res = await fetch(`${base}/api/tasks/T-1/body`, {
        method: "POST", headers: csrf, body: JSON.stringify({ body }),
      });
      expect(res.status).toBe(200);
    }

    const history = await readHistory(join(root, ".loctt"), taskId);
    const bodyEdits = history.filter(h => h.kind === "body_edited");

    // One per write, in order, each hop reconstructible on its own.
    expect(bodyEdits).toHaveLength(drafts.length);
    bodyEdits.forEach((entry, i) => {
      expect(entry.after).toContain(drafts[i]);
      if (i > 0) expect(entry.before).toBe(bodyEdits[i - 1]?.after);
    });

    // TSK-16's second bullet — the far end, read off disk.
    const raw = await readFile(join(root, ".loctt/tasks", taskId, "task.md"), "utf-8");
    expect(raw).toContain("one two three four");
  });
});

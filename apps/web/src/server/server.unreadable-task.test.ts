import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/tasks/:ref` over a task.md that will not parse.
 *
 * Two wrong answers shipped, and the UI could render neither:
 *
 *  - key in the key index → 500 with
 *    `{"code":"unknown","message":"The server failed while handling
 *    GET /api/tasks/T-1"}`, the parse detail buried in `detail`. P4
 *    reserves `unknown` for causes that genuinely cannot be
 *    determined; this one was fully known.
 *  - key not in the index → 404 `Task not found: "T-1"`, asserting the
 *    task does not exist with the file on disk. ERR-1's prohibition.
 *
 * TSK-54 wants the detail view to state that the file could not be
 * parsed, give the path under `.loctt/tasks/<id>/`, and describe the
 * error in terms the user can act on — the line or the field. XS-51
 * adds that the wording may commit to a hand edit rather than hedge
 * about a torn write, because LocTT's writes are atomic.
 *
 * Nothing in the web server changed for this: core now attributes the
 * failure as a `LocttError`, and the dispatcher's existing
 * `LocttError` branch renders it. These assertions hold that
 * end-to-end wiring.
 *
 * @verifies TSK-54
 * @verifies XS-51
 * @verifies ERR-1
 */
describe("GET /api/tasks/:ref with an unparseable task.md", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let victimPath: string;

  const headers = {
    "Content-Type": "application/json",
    "X-Loctt-Client": "test",
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-unreadable-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Corrupt me" }),
    });

    // Fetch once before corrupting so the key index is warm — this is
    // the path that produced the 500.
    const ok = await fetch(`${base}/api/tasks/T-1`);
    expect(ok.status).toBe(200);

    const tasksDir = join(root, ".loctt", "tasks");
    const id = (await readdir(tasksDir))[0] as string;
    victimPath = join(tasksDir, id, "task.md");
    const before = await readFile(victimPath, "utf-8");
    // An unclosed quote — the hand edit TSK-54 describes. The yaml
    // package reports it with a line and a column.
    const after = before.replace(/^title: (.*)$/m, 'title: "$1');
    expect(after).not.toBe(before);
    await writeFile(victimPath, after, "utf-8");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("does not answer 404, and does not say the task was not found", async () => {
    const res = await fetch(`${base}/api/tasks/T-1`);
    // ERR-1: a failure and an absence must not look alike. 404 here
    // told the user their task did not exist.
    expect(res.status).not.toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body["message"])).not.toContain("not found");
  });

  it("attributes the cause instead of a bare server failure", async () => {
    const res = await fetch(`${base}/api/tasks/T-1`);
    const body = (await res.json()) as Record<string, unknown>;

    // P4's `unknown` is for causes that cannot be determined. A YAML
    // parse error at a known line is not one.
    expect(body["code"]).toBe("io_failed");
    expect(String(body["message"])).not.toContain("The server failed while");
  });

  it("names the path under .loctt/tasks/<id>/ and the parse line", async () => {
    const res = await fetch(`${base}/api/tasks/T-1`);
    const body = (await res.json()) as Record<string, unknown>;
    const message = String(body["message"]);

    // TSK-54: the path, in the headline — ERR-16 carves out paths
    // inside `.loctt/`, because that is the file the user must fix.
    expect(message).toContain(victimPath);
    expect(message).toContain(join(".loctt", "tasks"));
    // TSK-54: which line or field, not a raw stack trace.
    expect(message).toMatch(/line \d+/);
    expect(message).not.toContain("    at ");
    // XS-51: committed wording, no "may have been written incompletely".
    expect(message).toContain("by hand");
    expect(message).not.toContain("incompletely");
  });

  it("offers no retry control, because retrying cannot succeed", async () => {
    const res = await fetch(`${base}/api/tasks/T-1`);
    const body = (await res.json()) as Record<string, unknown>;
    // ERR-15 wants a control the user can actually press. Re-reading
    // the same bytes fails identically; only editing the file helps,
    // and the message names it.
    expect(body["recovery"]).toEqual({ kind: "none" });
    // A read put nothing at stake, so there is no data-state claim to
    // make (ERR-18 scopes that to writes).
    expect(body["data_state"]).toBeUndefined();
  });

  it("a genuinely missing key is still a 404 not-found", async () => {
    // The inverse conflation: a key that does not exist must not start
    // reporting as a read failure.
    //
    // Note what this does *not* cover. The key index is warm here
    // (T-1 was fetched successfully in setup), so the fold finds no
    // unindexed directories and never sees the corrupt file — the
    // miss is a clean absence. The harder case, where a miss coexists
    // with an unreadable directory the fold *did* see, is
    // core-level and lives in
    // `packages/core/src/task/lookup-unreadable.test.ts`
    // ("does not claim a missing key was found when an unrelated file
    // is corrupt"). Verified by mutation: forcing that branch
    // unreachable leaves this file green.
    const res = await fetch(`${base}/api/tasks/T-404`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body["code"]).toBe("not_found");
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `POST /api/tasks` — a value core's validator rejects must come back
 * as a *typed* 400 naming the field, not a 500.
 *
 * ## What this catches
 *
 * `createTask` threw a bare `Error` for anything
 * `validateTaskAgainstWorkflow` rejected. The route's catch has
 * branches for `ArchivedReferenceError`, `ZodError` and
 * `TaskUpdateError`; a bare `Error` matched none, fell through the
 * `throw err`, and surfaced from the generic handler as:
 *
 *     HTTP 500 {"code":"unknown","data_state":"unknown",
 *               "detail":"invalid task: fields.points: expected finite
 *                         number, got string"}
 *
 * The real reason was stranded in `detail` — a field the client's
 * error envelope does not render. Meanwhile the *identical* value sent
 * through `POST /api/tasks/:ref/set` had always returned a clean 400
 * with `field: "fields.points"`. Two write paths, two different
 * answers about the same rejected value.
 *
 * That breaks three things at once: P4 (a failure names its cause),
 * ERR-18 (`data_state` must be true — "unknown" was a lie, nothing was
 * written), and NEW-40, which requires the message to land *at the
 * field*, which the client can only do if `field` is in the envelope.
 */
describe("POST /api/tasks — rejected values are typed 400s, not 500s", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-create-val-"));
    await initLoctt(root);
    // A `number` custom field to feed a string into. `multi` and
    // `searchable` are required by the schema — omitting them makes
    // every request 400 with `config_invalid`, which would make this
    // suite pass for entirely the wrong reason.
    const wfPath = join(root, ".loctt", "config", "workflow.yaml");
    const wf = await readFile(wfPath, "utf8");
    await writeFile(
      wfPath,
      wf.replace(
        "custom_fields: []",
        "custom_fields:\n  - key: points\n    label: Points\n    type: number\n    multi: false\n    searchable: false",
      ),
    );
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function create(body: unknown): Promise<{ status: number; env: Record<string, unknown> }> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify(body),
    });
    return { status: res.status, env: (await res.json()) as Record<string, unknown> };
  }

  it("rejects a non-numeric number custom field with a 400 naming the field", async () => {
    const { status, env } = await create({
      title: "Bad points",
      fields: { points: "not-a-number" },
    });

    // The status class is the headline: a 500 says the server broke,
    // and this is the server working correctly.
    expect(status).toBe(400);
    expect(env["code"]).toBe("validation_failed");
    // ERR-18: nothing reached disk, and the envelope must say so
    // rather than shrugging with "unknown".
    expect(env["data_state"]).toBe("not_saved");
    // NEW-40: the field is what lets the form put the message at the
    // input instead of in a detached banner.
    expect(env["field"]).toBe("fields.points");
    // P4: the cause is in the message the user sees, not buried in
    // `detail`.
    expect(String(env["message"])).toContain("expected finite number");
    expect(String(env["message"])).toContain("points");
  });

  it("rejects a status that workflow.yaml does not define", async () => {
    const { status, env } = await create({ title: "Bad status", status: "no_such_status" });
    expect(status).toBe(400);
    expect(env["code"]).toBe("validation_failed");
    expect(env["data_state"]).toBe("not_saved");
    expect(String(env["message"])).toContain("no_such_status");
  });

  it("still creates a task when the custom field is the declared type", async () => {
    // The positive control. A fix that rejects everything would pass
    // both assertions above and be worse than the bug.
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ title: "Good points", fields: { points: 7 } }),
    });
    expect(res.status).toBe(201);
    const fm = (await res.json()) as { fields?: Record<string, unknown> };
    expect(fm.fields?.["points"]).toBe(7);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ErrorResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * The API error envelope (B16).
 *
 * P4 requires a failure to name the thing, the reason, and the next
 * action — and `flow-error-handling.md` turns that into three concrete
 * demands a bare `{error: string}` cannot meet: a field pointer so the UI
 * can render at the input (ERR-14), a data-state claim so the user knows
 * whether their edit landed (ERR-18), and a recovery so the app can offer
 * a control rather than prose (ERR-15).
 *
 * These assert the envelope on the wire, since that is the contract the
 * client branches on.
 */
describe("API error envelope", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let taskKey: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-errors-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ title: "A task" }),
    });
    const body = (await created.json()) as { key: string };
    taskKey = body.key;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies ERR-14, ERR-18
  it("a rejected field write names the field and says the change was not saved", async () => {
    const res = await fetch(`${base}/api/tasks/${taskKey}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "status", value: "not_a_configured_status" }),
    });

    expect(res.status).toBe(400);
    const envelope = (await res.json()) as ErrorResponse;

    // ERR-14: the failure belongs to a field, so the UI can place it at
    // the input rather than only in a corner toast.
    expect(envelope.field).toBe("status");
    // ERR-18: the data-state claim is present and correct — the write was
    // rejected before it reached disk.
    expect(envelope.data_state).toBe("not_saved");
    // ERR-15: recovery is a control the UI can render, not prose.
    expect(envelope.recovery?.kind).toBe("retry");
    expect(envelope.code).toBe("validation_failed");

    // The claim must match disk: nothing was written.
    const after = await fetch(`${base}/api/tasks/${taskKey}`);
    const task = (await after.json()) as { frontmatter: { status?: string } };
    expect(task.frontmatter.status).not.toBe("not_a_configured_status");
  });

  // @verifies ERR-16, ERR-31
  it("a bad date is a stated validation failure, not a serialized validator dump", async () => {
    // Frontmatter shape is validated on write, so this arrives as a raw
    // ZodError from core. It used to escape as a 500 whose body carried
    // the serialized issue array: a known cause reported as unknown
    // (ERR-31), with jargon in the headline (ERR-16).
    const res = await fetch(`${base}/api/tasks/${taskKey}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "due_date", value: "not-a-date" }),
    });

    expect(res.status).toBe(400);
    const envelope = (await res.json()) as ErrorResponse;

    expect(envelope.code).toBe("validation_failed");
    expect(envelope.field).toBe("due_date");
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.recovery?.kind).toBe("retry");

    // ERR-16: the expected shape is stated in prose; no validator
    // internals reach the headline.
    expect(envelope.message).toContain("YYYY-MM-DD");
    expect(envelope.message).not.toContain("ZodError");
    expect(envelope.message).not.toContain('"path":');
    expect(envelope.message).not.toContain('"code":');
  });

  // @verifies ERR-31
  it("a known cause is reported as itself, not as the generic unknown", async () => {
    const res = await fetch(`${base}/api/tasks/NOPE-999`, { method: "GET" });

    expect(res.status).toBe(404);
    const envelope = (await res.json()) as ErrorResponse;

    // ERR-31: the app knows this one, so it must not claim ignorance.
    expect(envelope.code).toBe("not_found");
    expect(envelope.code).not.toBe("unknown");
  });

  it("keeps the legacy `error` field so existing clients keep their message", async () => {
    const res = await fetch(`${base}/api/tasks/NOPE-999`, { method: "GET" });
    const body = (await res.json()) as ErrorResponse & { error?: string };

    expect(body.error).toBe(body.message);
  });
});

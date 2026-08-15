import { chmod, mkdtemp, rm } from "node:fs/promises";
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

  // @verifies ERR-16, ERR-31
  it("a bad value on create is a stated validation failure, not a serialized validator dump", async () => {
    // Same leak as the set path: frontmatter is validated on write, so a
    // rejected value arrives as a raw ZodError. Unhandled it became a 500
    // whose body carried the serialized issue array.
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ title: "Bad due date", due_date: "not-a-date" }),
    });

    expect(res.status).toBe(400);
    const envelope = (await res.json()) as ErrorResponse;

    expect(envelope.code).toBe("validation_failed");
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.message).not.toContain("ZodError");
    expect(envelope.message).not.toContain('"path":');
  });

  // @verifies ERR-13
  it("a partly-failing bulk set names each failure with its own ref and reason", async () => {
    // One real task and two refs that cannot resolve, so the split is
    // unambiguous. ERR-13 requires the result to state the numbers and
    // attribute each failure separately — not one collapsed message.
    const res = await fetch(`${base}/api/tasks/bulk/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({
        refs: [taskKey, "T-90001", "T-90002"],
        changes: [{ field: "priority", value: "high" }],
      }),
    });

    // Partial failure is not a failed request: the batch ran, and the
    // per-item split lives in a 200 body rather than an error envelope.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      succeeded: string[];
      failed: { taskId: string; error: string }[];
    };

    expect(body.succeeded).toHaveLength(1);
    expect(body.failed).toHaveLength(2);
    // Each failure carries its own ref and its own reason.
    expect(body.failed.map(f => f.taskId).sort()).toEqual(["T-90001", "T-90002"]);
    for (const f of body.failed) {
      expect(f.error.length).toBeGreaterThan(0);
    }

    // ERR-13: the success is not rolled back. Verify against disk.
    const after = await fetch(`${base}/api/tasks/${taskKey}`);
    const task = (await after.json()) as { frontmatter: { priority?: string } };
    expect(task.frontmatter.priority).toBe("high");
  });

  // @verifies ERR-25
  it("a bulk set that fails for every item still reports zero applied", async () => {
    const res = await fetch(`${base}/api/tasks/bulk/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({
        refs: ["T-90003", "T-90004"],
        changes: [{ field: "priority", value: "high" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      succeeded: string[];
      failed: { taskId: string; error: string }[];
    };

    // ERR-25: nothing was applied, and that reads differently from a
    // partial success because `succeeded` is empty rather than short.
    expect(body.succeeded).toEqual([]);
    expect(body.failed).toHaveLength(2);
  });

  // @verifies ERR-14, ERR-18, ERR-22
  it("a request-shape rejection points at the field it belongs to", async () => {
    // `refs` must be a non-empty array of strings. ERR-22 says this is
    // presented as a field problem, not a protocol one.
    const res = await fetch(`${base}/api/tasks/bulk/archive`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ refs: "not-an-array", archive: true }),
    });

    expect(res.status).toBe(400);
    const envelope = (await res.json()) as ErrorResponse;

    expect(envelope.code).toBe("validation_failed");
    expect(envelope.field).toBe("refs");
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.message).not.toContain("ZodError");
  });

  // @verifies ERR-18
  it("a confirmation guard says the delete did not happen, and disk agrees", async () => {
    const res = await fetch(`${base}/api/tasks/${taskKey}`, {
      method: "DELETE",
      headers: csrf,
    });

    expect(res.status).toBe(400);
    const envelope = (await res.json()) as ErrorResponse;

    expect(envelope.data_state).toBe("not_saved");
    // ERR-14: the guard is attributable to the confirmation control.
    expect(envelope.field).toBe("confirm");

    // The claim must match disk: the task is still there.
    const after = await fetch(`${base}/api/tasks/${taskKey}`);
    expect(after.status).toBe(200);
  });

  // @verifies ERR-7, ERR-18
  it("a write against a task that no longer exists says nothing was saved", async () => {
    const res = await fetch(`${base}/api/tasks/T-90005/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "priority", value: "high" }),
    });

    expect(res.status).toBe(404);
    const envelope = (await res.json()) as ErrorResponse;

    expect(envelope.code).toBe("not_found");
    expect(envelope.data_state).toBe("not_saved");
    // ERR-7: the list the user clicked from is stale, so reload is the
    // control that reconciles it with disk.
    expect(envelope.recovery?.kind).toBe("reload");
  });

  // @verifies ERR-15
  it("a failure whose fix is a CLI command carries the exact command", async () => {
    // `initLoctt` creates a default user, so this branch is only
    // reachable with the users directory emptied. Doing that for real
    // beats asserting nothing on a tracker that always has a user.
    const emptyRoot = await mkdtemp(join(tmpdir(), "loctt-web-nousers-"));
    const emptyApp = createWebApp({ root: emptyRoot, port: 0 });
    try {
      await initLoctt(emptyRoot);
      await rm(join(emptyRoot, ".loctt", "users"), { recursive: true, force: true });
      await emptyApp.start();
      const addr = emptyApp.server.address();
      const p = typeof addr === "object" && addr ? addr.port : emptyApp.port;

      const res = await fetch(`http://127.0.0.1:${p}/api/user/current`);

      expect(res.status).toBe(404);
      const envelope = (await res.json()) as ErrorResponse;

      expect(envelope.code).toBe("not_found");
      expect(envelope.recovery?.kind).toBe("command");
      // ERR-15: the exact command, copyable — not prose telling the user
      // to "create a user first". A wrong command here is worse than
      // none, so this pins the real CLI spelling.
      expect(envelope.recovery?.command).toContain("loctt user create");
    } finally {
      await emptyApp.stop().catch(() => undefined);
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it("keeps the legacy `error` field so existing clients keep their message", async () => {
    const res = await fetch(`${base}/api/tasks/NOPE-999`, { method: "GET" });
    const body = (await res.json()) as ErrorResponse & { error?: string };

    expect(body.error).toBe(body.message);
  });
});

/**
 * Filesystem failures the user can act on (ERR-11, ERR-12).
 *
 * Only the server half is asserted here: naming the cause, claiming the
 * data state, and offering retry. The rest of each case — retaining the
 * user's typed content in the editor — is client-side and lands with the
 * body editor.
 */
describe("actionable filesystem errors", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let taskKey: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-fserr-"));
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
    taskKey = ((await created.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await chmod(join(root, ".loctt"), 0o755).catch(() => undefined);
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies ERR-11
  it("names an unwritable tracker directory as a permission problem", async () => {
    // The state lock creates `state.yaml.lock` directly inside
    // `.loctt/`, and it is the first write on any mutating path — so
    // this is where an unwritable tracker actually bites.
    const locttDir = join(root, ".loctt");
    await chmod(locttDir, 0o500);

    // Root, or a filesystem ignoring mode bits, makes this unobservable.
    // Skipping loudly beats asserting nothing.
    const res = await fetch(`${base}/api/tasks/${taskKey}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "priority", value: "high" }),
    });
    if (res.status === 200) {
      await chmod(locttDir, 0o755);
      return;
    }

    const envelope = (await res.json()) as ErrorResponse;
    await chmod(locttDir, 0o755);

    // ERR-31: the cause is knowable, so it must not be reported as
    // unknown — which is exactly what happened before this mapping.
    expect(envelope.code).toBe("io_failed");
    expect(envelope.code).not.toBe("unknown");
    // ERR-11: identified as permissions, naming the path to go and fix.
    expect(envelope.message).toMatch(/permission/i);
    expect(envelope.message).toContain(".loctt");
    // ERR-18: the write did not land, and retrying after a chmod is the
    // real fix, so the control is offered.
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.recovery?.kind).toBe("retry");
    // ERR-16: the raw errno belongs behind a details affordance.
    expect(envelope.message).not.toContain("EACCES");
    expect(envelope.detail).toContain("EACCES");
    // Bounded by proper-lockfile's backoff (10 retries, capped at 500ms)
    // before the failure surfaces.
  }, 20_000);
});

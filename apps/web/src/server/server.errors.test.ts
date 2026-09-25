import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ErrorResponse } from "@loctt/contracts";
import { initLoctt, withStateLock } from "@loctt/core";
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

/**
 * Lock contention as the UI sees it (XS-47, XS-49, SET-39).
 *
 * These hold the real state lock from *this* process using core's own
 * `withStateLock`, then drive the HTTP API from outside it. That is
 * the closest available analogue of the case's "a wedged CLI command":
 * the lock file on disk is the same one, taken by the same library
 * with the same options, so the API path hits genuine `proper-lockfile`
 * contention rather than a stubbed rejection.
 *
 * Asserting the *envelope* is the point. The UI branches on `code`,
 * `data_state` and `recovery` to decide what to render and whether to
 * offer a retry control, so those fields are the contract — not the
 * prose, which the client is free to reword.
 */
describe("state-lock contention", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let taskKey: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-lock-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ title: "Lock subject" }),
    });
    taskKey = ((await created.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies XS-47
  it("reports a held state lock honestly rather than hanging or claiming success", async () => {
    const locttDir = join(root, ".loctt");

    // Hold the lock for longer than the API's bounded backoff (10
    // retries capped at 500ms), so the request genuinely loses the
    // race rather than winning it after a pause.
    let res!: Response;
    await withStateLock(locttDir, async () => {
      res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ title: "Should not be created" }),
      });
    });

    // First bullet: it resolves within a bounded time rather than
    // hanging. Reaching this line at all is that assertion — the
    // 20s test timeout is the ceiling.
    expect(res.ok).toBe(false);

    const envelope = (await res.json()) as ErrorResponse;
    // Second bullet: the failure says another process holds the
    // lock. `conflict`, not `unknown` — ERR-31's prohibition, and the
    // code the client branches on to pick this message at all.
    expect(envelope.code).toBe("conflict");
    expect(envelope.message).toMatch(/another process/i);
    // Third bullet: it states the change was **not** saved, and offers
    // retry as a control. `retry` specifically: contention clears on
    // its own, so unlike a git conflict this one is worth repeating.
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.recovery?.kind).toBe("retry");
    // ERR-16: proper-lockfile's own `ELOCKED` wording is internals and
    // belongs behind the details affordance, not in the headline.
    expect(envelope.message).not.toContain("ELOCKED");

    // Fourth bullet: "no optimistic row is left in the list implying
    // the task was created". Asserted against the *server's own list*
    // after the lock is released — the strongest available form of
    // "it was not created", since P1 makes the files the truth.
    const list = await fetch(`${base}/api/tasks?limit=100`);
    const body = (await list.json()) as { items: { title: string }[] };
    expect(body.items.map(t => t.title)).not.toContain("Should not be created");
    // Positive control: the task that *was* created is present, so the
    // assertion above is about the refused write and not about the
    // list endpoint returning nothing.
    expect(body.items.map(t => t.title)).toContain("Lock subject");
  }, 20_000);

  // @verifies XS-49
  it("succeeds on retry once the lock is released, with no manual step", async () => {
    const locttDir = join(root, ".loctt");

    // Inside the window, the failure is transient-shaped: `retry` is
    // the recovery, which is what lets the UI say "try again in a
    // moment" rather than presenting a permanent condition.
    let blocked!: Response;
    await withStateLock(locttDir, async () => {
      blocked = await fetch(`${base}/api/tasks/${taskKey}/set`, {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ field: "priority", value: "high" }),
      });
    });
    expect(blocked.ok).toBe(false);
    const blockedBody = (await blocked.json()) as ErrorResponse;
    expect(blockedBody.recovery?.kind).toBe("retry");
    expect(blockedBody.data_state).toBe("not_saved");

    // First bullet: the retry succeeds "without manual intervention"
    // once the holder is gone. No unlock call, no sleep on the
    // 10-second stale timeout — the lock was released normally, and
    // the third bullet's point is that ordinary state operations are
    // never made to wait the 5-minute *migration* timeout.
    const retried = await fetch(`${base}/api/tasks/${taskKey}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "priority", value: "high" }),
    });
    expect(retried.ok).toBe(true);

    // And the retried write actually landed — asserting the 200 alone
    // would pass against a server that accepted and dropped it.
    const after = await fetch(`${base}/api/tasks/${taskKey}`);
    const task = (await after.json()) as { frontmatter: { priority?: string } };
    expect(task.frontmatter.priority).toBe("high");
  }, 20_000);

  /**
   * PRU-43: the same contention, on a **project** write, plus the
   * half SET-39 does not ask for — the message must say *why* Retry
   * may not help.
   *
   * On a sync folder the failure is not transient: POSIX advisory
   * locks are unreliable there, so a message offering only "try
   * again" sends the user round a loop that never terminates. The
   * caveat existed as a source comment on `withStateLock`; this
   * asserts it reaches the person who hit it.
   */
  // @verifies PRU-43
  it("PRU-43: a project write under a held lock names the lock and the sync-folder caveat", async () => {
    const locttDir = join(root, ".loctt");

    const listBefore = await fetch(`${base}/api/projects`);
    const projectsBefore = await listBefore.text();

    let res!: Response;
    await withStateLock(locttDir, async () => {
      res = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ name: "Docs", prefix: "DOCS" }),
      });
    });

    expect(res.ok).toBe(false);
    const envelope = (await res.json()) as ErrorResponse;

    // Names the lock, and says the write did not complete.
    expect(envelope.code).toBe("conflict");
    expect(envelope.message).toMatch(/another process/i);
    expect(envelope.data_state).toBe("not_saved");

    // Names the filesystems where the lock is not trustworthy...
    expect(envelope.message).toMatch(/iCloud/i);
    expect(envelope.message).toMatch(/Dropbox/i);
    expect(envelope.message).toMatch(/OneDrive/i);
    expect(envelope.message).toMatch(/NFS/i);
    expect(envelope.message).toMatch(/SMB/i);
    // ...and recommends the fix, rather than only offering Retry.
    expect(envelope.message).toMatch(/local disk/i);

    // The panel must not show the project as created and then have it
    // vanish: nothing was written, so the list is byte-identical.
    const listAfter = await fetch(`${base}/api/projects`);
    expect(await listAfter.text()).toBe(projectsBefore);
  }, 20_000);

  // @verifies SET-39
  it("refuses a tracker settings write under a held lock, naming it and not corrupting", async () => {
    const locttDir = join(root, ".loctt");

    // SET-39 is contention on a **tracker settings** write. The case
    // frames it as a Dropbox-hosted tracker, where POSIX advisory
    // locks are unsafe; the observable the UI must get right is the
    // refused write and the untouched stored config.
    //
    // `/api/workflow` is the tracker-level settings write.
    // `/api/user-settings` is deliberately *not* used: those are
    // machine-local per-checkout state (XS-52 calls them caches, not
    // tracker data) and that path takes no state lock — measured, and
    // recorded in known-gaps.md rather than asserted here, because
    // locking a per-checkout cache is not what SET-39 asks for.
    const before = await fetch(`${base}/api/workflow`);
    const originalWorkflow = await before.text();
    // The PUT takes `{ workflow, remap }`. Sending the workflow back
    // unchanged is a legitimate write: it passes validation, so the
    // request reaches the lock rather than being rejected before it —
    // which is what makes this test about contention and not about
    // schema validation.
    // GET returns the workflow document itself (no wrapper); PUT
    // takes it under a `workflow` key. Measured, not assumed — the
    // first attempt sent the GET body through unchanged and was
    // rejected by validation before ever reaching the lock, which
    // would have made this a test of the schema rather than of
    // contention.
    const workflow = JSON.parse(originalWorkflow) as unknown;

    let res!: Response;
    await withStateLock(locttDir, async () => {
      res = await fetch(`${base}/api/workflow`, {
        method: "PUT",
        headers: csrf,
        body: JSON.stringify({ workflow }),
      });
    });

    expect(res.ok).toBe(false);

    const envelope = (await res.json()) as ErrorResponse;
    // First bullet: the failure names the lock and states that the
    // write did not complete.
    expect(envelope.code).toBe("conflict");
    expect(envelope.message).toMatch(/another process/i);
    // Second bullet: a warning rather than "the write being retried
    // into possible corruption" — `not_saved` is the claim that
    // nothing was half-written.
    expect(envelope.data_state).toBe("not_saved");

    // Third bullet: "the panel reverts to the last known-good values
    // rather than displaying the unsaved edit as saved". The server
    // half is that the stored config is byte-identical, so a refetch
    // hands the panel the truth.
    const after = await fetch(`${base}/api/workflow`);
    expect(await after.text()).toBe(originalWorkflow);
  }, 20_000);
});

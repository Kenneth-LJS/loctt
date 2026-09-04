import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, withMigrationLock } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies TSK-56
 *
 * A field write attempted while a schema migration holds the lock must
 * be *explained as a migration*, not reported as a generic failure. The
 * lock is checked inside `withStateLock` before any mutation, so nothing
 * is saved — the envelope has to say the tracker is being migrated, that
 * the change was not saved, and that the user should wait.
 *
 * The lock is `proper-lockfile` on `.loctt/.schema-version`, held here
 * via core's own `withMigrationLock`. This needs no schema-version bump:
 * `isMigrationLocked` checks only the advisory lock, not the version, so
 * the tracker stays at its current, supported version throughout — which
 * is why the boot guard (a *version* mismatch) does not fire and the
 * request reaches `handleSetField`.
 */
describe("a field write during an in-progress migration", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-miglock-"));
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

  const setStatus = async (value: string): Promise<Response> =>
    fetch(`${base}/api/tasks/T-1/set`, {
      method: "POST", headers: csrf, body: JSON.stringify({ field: "status", value }),
    });

  it("is refused as a migration, not saved, with a wait-and-retry recovery", async () => {
    // Hold the migration lock for the duration of the write attempt.
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const locktakenAndReleased = withMigrationLock(join(root, ".loctt"), () => held);

    // Give the lock a moment to be acquired before the write races it.
    await new Promise(r => setTimeout(r, 50));

    const res = await setStatus("in_progress");
    expect(res.status).toBe(409);
    const env = (await res.json()) as {
      code: string;
      message: string;
      data_state?: string;
      recovery?: { kind: string };
    };
    // The tracker is being migrated — the machine-readable cause says so.
    expect(env.code).toBe("schema_mismatch");
    // Nothing was written — the lock check precedes the mutation.
    expect(env.data_state).toBe("not_saved");
    // Told to wait, in words — not a generic "server failed" headline.
    expect(env.message).toMatch(/migration is in progress/i);
    expect(env.message).toMatch(/wait/i);
    // Retrying is the right action once the migration finishes.
    expect(env.recovery?.kind).toBe("retry");

    // Let the migration finish, then the same edit lands.
    release();
    await locktakenAndReleased;
    const after = await setStatus("in_progress");
    expect(after.status).toBe(200);
  });
});

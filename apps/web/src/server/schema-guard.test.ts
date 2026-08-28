import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies ONB-C6
 *
 * When the schema guard blocks the app, a cold-loading browser has no
 * cached state — every endpoint refuses, so the refusal itself has to
 * explain what is wrong and what to do. It does, via the structured
 * envelope.
 *
 * What it got wrong was the "what to do": every mismatch that was not
 * `SchemaTooNewError` was offered `loctt migrate` as the recovery
 * command, including a missing `.schema-version`, which `loctt migrate`
 * refuses outright — it needs a recorded version to migrate from. The
 * user spends a round trip discovering the suggested fix cannot work.
 */

interface Harness {
  root: string;
  base: string;
  stop: () => Promise<void>;
}

const started: Harness[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop();
    if (h) {
      await h.stop();
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-guard-"));
  await initLoctt(root);
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  const h: Harness = { root, base: `http://127.0.0.1:${port}`, stop: () => app.stop() };
  started.push(h);
  return h;
}

interface Envelope {
  code: string;
  message: string;
  detail?: string;
  recovery?: { kind: string; command?: string };
  schema_status?: { kind: string; on_disk?: number; current?: number; message?: string };
}

describe("web schema guard", () => {
  it("lets a cold client learn why it is blocked, from any endpoint", async () => {
    const { root, base } = await harness();
    await rm(join(root, ".loctt/.schema-version"), { force: true });

    // A fresh browser session has nothing cached, so whichever request
    // it makes first has to carry the explanation.
    for (const path of ["/api/info", "/api/tasks", "/api/workflow"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(409);
      const body = await res.json() as Envelope;
      expect(body.code).toBe("schema_mismatch");
      // Named, not a bare status: the UI branches on `code` and shows
      // `message`, and neither may be empty.
      expect(body.message.length).toBeGreaterThan(0);
    }
  });

  it("does not offer a migrate command that cannot help", async () => {
    const { root, base } = await harness();
    await rm(join(root, ".loctt/.schema-version"), { force: true });

    const res = await fetch(`${base}/api/info`);
    const body = await res.json() as Envelope;

    // `loctt migrate` refuses on a tracker with no recorded version —
    // offering it sends the user on a round trip to find that out.
    expect(body.recovery?.command).toBeUndefined();
    expect(body.recovery?.kind).toBe("none");
    // But something actionable must still be said.
    expect(body.detail).toMatch(/init --repair/);
  });

  it("offers no command for a tracker from a newer LocTT", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/.schema-version"), "99\n", "utf8");

    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(409);
    const body = await res.json() as Envelope;
    expect(body.code).toBe("schema_mismatch");
    // No local command produces a newer LocTT.
    expect(body.recovery?.kind).toBe("none");
    expect(body.message).toMatch(/newer version of LocTT/);
  });

  it("keeps the migrate endpoints reachable while the guard is refusing", async () => {
    const { root, base } = await harness();
    // An empty version file, chosen because the guard and the migrate
    // handler give *different* answers for it — a too-new tracker makes
    // both reply identically, so it could not tell an exempt route from
    // a guarded one.
    await writeFile(join(root, ".loctt/.schema-version"), "", "utf8");

    const guarded = await fetch(`${base}/api/info`);
    const guardedBody = await guarded.json() as Envelope;
    // The guard attaches the remedy it knows about.
    expect(guardedBody.detail).toMatch(/init --repair/);

    // Migration is the remedy for a mismatch, so it cannot be gated
    // behind one. Reaching its own handler is what this asserts: the
    // handler answers without the guard's detail.
    const exempt = await fetch(`${base}/api/migrate/plan`);
    const exemptBody = await exempt.json() as Envelope;
    expect(exemptBody.code).toBe("schema_mismatch");
    expect(exemptBody.detail).toBeUndefined();
  });

  it("serves normally once the schema is valid", async () => {
    const { base } = await harness();
    // Guards against the whole suite passing because every request 409s
    // for some unrelated reason.
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
  });
});

/**
 * The four schema states, told apart while the guard is refusing.
 *
 * The guard blocks `/api/info` along with everything else, so the
 * surface cannot read the status from the payload it just blocked.
 * Each state has a *different* remedy — P4 admits no generic "schema
 * problem" — so the refusal itself has to say which one this is.
 */
describe("the guard names which schema state it refused for", () => {
  /**
   * @verifies XS-33
   *
   * `missing` and `unknown` are distinct kinds: an absent version file
   * is not an unreadable one, and they have different remedies.
   */
  it("reports `missing` for an absent .schema-version", async () => {
    const { root, base } = await harness();
    await rm(join(root, ".loctt/.schema-version"), { force: true });

    const body = await (await fetch(`${base}/api/info`)).json() as Envelope;
    expect(body.schema_status?.kind).toBe("missing");
    // Nothing is known, so no numbers may be claimed.
    expect(body.schema_status?.on_disk).toBeUndefined();
  });

  /**
   * @verifies XS-34
   */
  it("reports `future` with both versions for a too-new tracker", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/.schema-version"), "99\n", "utf8");

    const body = await (await fetch(`${base}/api/info`)).json() as Envelope;
    expect(body.schema_status?.kind).toBe("future");
    expect(body.schema_status?.on_disk).toBe(99);
    expect(typeof body.schema_status?.current).toBe("number");
    expect(body.schema_status?.current).toBeLessThan(99);
    // Migration cannot help, so no command is offered.
    expect(body.recovery?.kind).toBe("none");
  });

  /**
   * @verifies XS-35
   *
   * The `outdated` state cannot be reached on this build.
   * `CURRENT_SCHEMA_VERSION` is 1 and `readSchemaVersion` rejects
   * anything below 1, so there is no value a tracker can hold that
   * reads as behind. XS-35's *copy* is covered where the banner is
   * tested; what this pins is that the gap is arithmetic and will
   * close on its own at version 2 — not a missing branch someone
   * should go and write.
   *
   * If this test starts failing, `CURRENT_SCHEMA_VERSION` has moved
   * and the real scenario is now reachable: replace this with a
   * fixture that writes `CURRENT_SCHEMA_VERSION - 1`.
   */
  it("cannot yet produce an outdated tracker, because version 1 is the floor", async () => {
    const { computeSchemaStatus, CURRENT_SCHEMA_VERSION } = await import("@loctt/core");
    expect(CURRENT_SCHEMA_VERSION).toBe(1);

    const { root } = await harness();
    const status = await computeSchemaStatus(join(root, ".loctt"));
    expect(status.kind).toBe("current");

    // The one value below current is not a legal version, so it reads
    // as unreadable rather than as behind.
    await writeFile(join(root, ".loctt/.schema-version"), "0\n", "utf8");
    expect((await computeSchemaStatus(join(root, ".loctt"))).kind).toBe("unknown");
  });

  /**
   * @verifies XS-33
   *
   * An unreadable version is `unknown`, not `missing` — the distinction
   * XS-33 draws by name.
   */
  it("reports `unknown` for an unparseable .schema-version", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/.schema-version"), "abc\n", "utf8");

    const body = await (await fetch(`${base}/api/info`)).json() as Envelope;
    expect(body.schema_status?.kind).toBe("unknown");
    expect(body.schema_status?.kind).not.toBe("missing");
  });
});

/**
 * @verifies XS-37
 *
 * The crashed-migration sentinel. `requireSupportedSchema` already
 * refused to boot against one — what was missing was the *state
 * reaching the surface*: `computeSchemaStatus` checked only the
 * recorded version, so a half-migrated tracker whose version stamp
 * happened to look current reported as healthy, and the UI showed the
 * ordinary banner (or nothing) for the one condition where no in-app
 * action is safe.
 */
describe("an interrupted migration", () => {
  it("is reported as its own kind, carrying the sentinel's recovery details", async () => {
    const { root, base } = await harness();
    const sentinel = join(root, ".loctt/.schema-migration-in-progress");
    const backup = join(root, ".loctt.backup-v1-20260828-abc123");
    await writeFile(sentinel, `from: 1\nto: 2\nbackup: ${backup}\n`, "utf8");

    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(409);
    const body = await res.json() as Envelope;
    expect(body.schema_status?.kind).toBe("interrupted");

    const status = body.schema_status as unknown as {
      from?: number; to?: number; backup?: string; sentinel_path?: string;
    };
    expect(status.from).toBe(1);
    expect(status.to).toBe(2);
    expect(status.backup).toBe(backup);
    expect(status.sentinel_path).toBe(sentinel);

    // No one-click fix: re-running over a half-migrated tracker
    // compounds the damage.
    expect(body.recovery?.kind).toBe("none");
    expect(body.recovery?.command).toBeUndefined();
  });

  it("outranks a recorded version that looks perfectly current", async () => {
    const { computeSchemaStatus } = await import("@loctt/core");
    const { root } = await harness();
    const locttDir = join(root, ".loctt");

    // The crash can land between the last step's version stamp and the
    // sentinel's removal, so this tracker is half-migrated *and* reads
    // as current. Checking the version first reports it healthy.
    expect((await computeSchemaStatus(locttDir)).kind).toBe("current");

    await writeFile(
      join(locttDir, ".schema-migration-in-progress"),
      "from: 1\nto: 2\nbackup: /tmp/x\n",
      "utf8",
    );
    expect((await computeSchemaStatus(locttDir)).kind).toBe("interrupted");
  });

  it("still reports interrupted when the sentinel is unreadable", async () => {
    const { computeSchemaStatus } = await import("@loctt/core");
    const { root } = await harness();
    const locttDir = join(root, ".loctt");

    // The file's *presence* is the fact that matters. Losing its
    // contents means showing less, not reporting the tracker healthy.
    await writeFile(join(locttDir, ".schema-migration-in-progress"), "garbage\n", "utf8");

    const status = await computeSchemaStatus(locttDir);
    expect(status.kind).toBe("interrupted");
    if (status.kind === "interrupted") {
      expect(status.from).toBeUndefined();
      expect(status.backup).toBeUndefined();
      expect(status.sentinel_path.length).toBeGreaterThan(0);
    }
  });
});

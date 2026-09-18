import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { getSchemaMigrationInProgressPath } from "../paths/index.js";
import { migrateToCurrent, planMigration, requireSupportedSchema } from "./migrate.js";

/**
 * Audit group B: the fatal `.schema-migration-in-progress` sentinel was
 * bypassed on the only path that can reach it (invariants.md:45).
 *
 * Every ordinary command refuses via `requireSupportedSchema`. But
 * `migrate` is deliberately exempt from that guard — it is the command
 * that fixes a stale schema — and neither `planMigration` nor
 * `migrateToCurrent` checked the sentinel themselves. So the one command
 * that can be running when a crash drops the sentinel would run again
 * over a half-migrated tracker, and with the version already advanced it
 * reported "already at v1, nothing to do" and exited 0.
 */
describe("interrupted-migration sentinel", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-sentinel-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function dropSentinel(): Promise<void> {
    await writeFile(
      getSchemaMigrationInProgressPath(locttDir),
      "backup: /somewhere/.loctt.backup-v1\n",
      "utf8",
    );
  }

  it("blocks every ordinary command", async () => {
    await dropSentinel();
    await expect(requireSupportedSchema(locttDir)).rejects.toThrow(/interrupted mid-run/);
  });

  it("blocks the migration itself rather than reporting nothing to do", async () => {
    await dropSentinel();
    // The bug: this resolved with `{steps: []}` and the CLI printed
    // "Schema is already at v1. Nothing to do." on a tracker whose
    // files may be only partly rewritten.
    await expect(migrateToCurrent(locttDir)).rejects.toThrow(/interrupted mid-run/);
  });

  it("blocks planning too, which is what `loctt migrate` calls first", async () => {
    await dropSentinel();
    // planMigration returning an empty plan is why the CLI never
    // reached migrateToCurrent — the check has to be on both.
    await expect(planMigration(locttDir)).rejects.toThrow(/interrupted mid-run/);
  });

  it("names the backup and says not to re-run without restoring", async () => {
    await dropSentinel();
    const err = await planMigration(locttDir).catch((e: unknown) => e) as Error & {
      remedy?: string;
    };
    expect(err.message).toContain(".schema-migration-in-progress");
    // Resuming is not offered: the crashed run applied an unknown subset
    // of one step, so there is no safe point to continue from.
    expect(err.message).toMatch(/cannot be resumed/);
    expect(err.remedy).toMatch(/[Rr]estore/);
  });

  it("proceeds normally once the sentinel is cleared", async () => {
    await dropSentinel();
    await expect(planMigration(locttDir)).rejects.toThrow();

    await rm(getSchemaMigrationInProgressPath(locttDir), { force: true });

    // Guards the fix from over-reaching: a healthy tracker must still
    // plan and migrate.
    const plan = await planMigration(locttDir);
    expect(plan.steps).toEqual([]);
    await expect(migrateToCurrent(locttDir)).resolves.toBeDefined();
  });
});

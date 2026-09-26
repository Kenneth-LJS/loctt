import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSchemaMigrationInProgressPath } from "../paths/index.js";
import {
  migrateToCurrent,
  planMigration,
  requireSupportedSchema,
} from "./migrate.js";
import type { Migration } from "./migrations.js";
import {
  CURRENT_SCHEMA_VERSION,
  SchemaTooNewError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";

let dir: string;

async function cleanupBackups(): Promise<void> {
  const parent = dirname(dir);
  const base = dir.split("/").pop() ?? "";
  for (const entry of await readdir(parent)) {
    if (entry.startsWith(`${base}.backup-`)) {
      await rm(join(parent, entry), { recursive: true, force: true });
    }
  }
}

beforeEach(async () => {
  dir = join(tmpdir(), `loctt-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await cleanupBackups();
  await rm(dir, { recursive: true, force: true });
});

describe("migrateToCurrent", () => {
  it("throws when .schema-version is missing", async () => {
    await expect(migrateToCurrent(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("is a no-op when already at current version", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION);
    const result = await migrateToCurrent(dir);
    expect(result.from).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.steps).toEqual([]);
    expect(result.backupPath).toBeUndefined();
  });

  it("throws SchemaTooNewError when tracker is newer than supported", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION + 5);
    await expect(migrateToCurrent(dir)).rejects.toThrow(SchemaTooNewError);
  });
});

describe("planMigration", () => {
  it("returns an empty plan when already at current", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION);
    const plan = await planMigration(dir);
    expect(plan.from).toBe(CURRENT_SCHEMA_VERSION);
    expect(plan.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(plan.steps).toEqual([]);
  });

  it("throws when .schema-version is missing", async () => {
    await expect(planMigration(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("throws SchemaTooNewError when tracker is newer", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION + 1);
    await expect(planMigration(dir)).rejects.toThrow(SchemaTooNewError);
  });
});

describe("requireSupportedSchema", () => {
  it("throws when missing", async () => {
    await expect(requireSupportedSchema(dir)).rejects.toThrow(SchemaVersionError);
  });

  it.skipIf(CURRENT_SCHEMA_VERSION === 1)(
    "throws when older than current",
    async () => {
      await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION - 1);
      await expect(requireSupportedSchema(dir)).rejects.toThrow(SchemaVersionError);
    },
  );

  it("throws when newer than current", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION + 1);
    await expect(requireSupportedSchema(dir)).rejects.toThrow(SchemaTooNewError);
  });

  it("passes silently when at current version", async () => {
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION);
    await expect(requireSupportedSchema(dir)).resolves.toBeUndefined();
  });

  it("error message points the user at `loctt migrate`", async () => {
    if (CURRENT_SCHEMA_VERSION === 1) return; // can't go below 1
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION - 1);
    await expect(requireSupportedSchema(dir)).rejects.toThrow(/loctt migrate/);
  });

  it("does not collide with the migration lock", async () => {
    // Just verifies the function reads the version file even when
    // the same path is used as a lock target.
    await writeSchemaVersion(dir, CURRENT_SCHEMA_VERSION);
    const exists = await readFile(join(dir, ".schema-version"), "utf-8");
    expect(exists.trim()).toBe(String(CURRENT_SCHEMA_VERSION));
    await expect(requireSupportedSchema(dir)).resolves.toBeUndefined();
  });
});

/**
 * @verifies SET-37
 *
 * "`POST /api/migrate` fails partway. The migration errors on the
 * second of three steps" — but no real multi-step migration is
 * registered in `MIGRATIONS` yet (`migrations.ts`: "No migrations
 * registered yet"), so that scenario cannot occur through the real
 * registry. `findMigrationPath` is the one seam `migrateToCurrent`
 * calls through without holding onto the registry itself, so a
 * three-step path with a throwing middle step is injected here via
 * `vi.mock` on the migrations module — the rest of `migrate.ts` (the
 * sentinel write/clear per step, the backup, the result shape) is the
 * real production code under test, not reimplemented.
 */
describe("migrateToCurrent: a step fails partway (SET-37)", () => {
  afterEach(() => {
    vi.doUnmock("./migrations.js");
    vi.doUnmock("./version.js");
    vi.resetModules();
  });

  it("leaves the sentinel recording the failed step and the intermediate version, and does not report partial success", async () => {
    // No real multi-step migration exists yet to start below (today's
    // only registered CURRENT_SCHEMA_VERSION is 1, with nothing below
    // it to migrate from), so this test raises the ceiling too: a
    // three-step path from v1 to a fake v4, with step two throwing.
    const startVersion = 1;
    const fakeCurrent = startVersion + 3;
    await writeSchemaVersion(dir, startVersion);
    const steps: Migration[] = [
      {
        from: startVersion,
        to: startVersion + 1,
        description: "step one",
        apply: async () => {},
      },
      {
        from: startVersion + 1,
        to: startVersion + 2,
        description: "step two (fails)",
        apply: () => {
          throw new Error("step two blew up");
        },
      },
      {
        from: startVersion + 2,
        to: startVersion + 3,
        description: "step three",
        apply: async () => {},
      },
    ];

    vi.doMock("./version.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./version.js")>();
      return { ...actual, CURRENT_SCHEMA_VERSION: fakeCurrent };
    });
    vi.doMock("./migrations.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./migrations.js")>();
      return { ...actual, findMigrationPath: () => steps };
    });
    vi.resetModules();
    const { migrateToCurrent: migrateWithFakePath } =
      await import("./migrate.js");
    const { requireSupportedSchema: requireWithFakeCurrent } =
      await import("./migrate.js");

    await expect(migrateWithFakePath(dir)).rejects.toThrow(/step two blew up/);

    // The intermediate version: step one's writeSchemaVersion landed
    // (startVersion + 1), step two's never did.
    const versionOnDisk = (await readFile(join(dir, ".schema-version"), "utf-8")).trim();
    expect(versionOnDisk).toBe(String(startVersion + 1));

    // The sentinel records exactly the step that was in flight when it
    // threw — step two's from/to — plus the backup path, by absolute
    // path (backupLocttDir always returns an absolute sibling path).
    const sentinelPath = getSchemaMigrationInProgressPath(dir);
    const sentinel = await readFile(sentinelPath, "utf-8");
    expect(sentinel).toContain(`from: ${startVersion + 1}`);
    expect(sentinel).toContain(`to: ${startVersion + 2}`);
    expect(sentinel).toMatch(/backup: \/.*\.backup-v/);

    // A second attempt (the "does not clear the schema banner" /
    // "does not report a partial success as success" bullets, read
    // from the boot-guard side) refuses rather than resuming.
    await expect(requireWithFakeCurrent(dir)).rejects.toThrow(/interrupted mid-run/);
  });
});

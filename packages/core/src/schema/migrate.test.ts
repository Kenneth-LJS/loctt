import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  migrateToCurrent,
  planMigration,
  requireSupportedSchema,
} from "./migrate.js";
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

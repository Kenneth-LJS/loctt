import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isMigrationLocked, withMigrationLock } from "./lock.js";
import { writeSchemaVersion } from "./version.js";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `loctt-mlock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await writeSchemaVersion(dir, 1);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("withMigrationLock", () => {
  it("runs the function and returns its value", async () => {
    const result = await withMigrationLock(dir, () => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("releases the lock after the callback resolves", async () => {
    await withMigrationLock(dir, () => Promise.resolve());
    expect(await isMigrationLocked(dir)).toBe(false);
  });

  it("releases the lock even when the callback throws", async () => {
    await expect(
      withMigrationLock(dir, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await isMigrationLocked(dir)).toBe(false);
  });

  it("isMigrationLocked is true while inside the lock", async () => {
    let observed = false;
    await withMigrationLock(dir, async () => {
      observed = await isMigrationLocked(dir);
    });
    expect(observed).toBe(true);
  });
});

describe("isMigrationLocked", () => {
  it("returns false when no lock has been taken", async () => {
    expect(await isMigrationLocked(dir)).toBe(false);
  });
});

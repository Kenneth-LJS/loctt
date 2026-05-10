import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { getSchemaVersionPath } from "../paths/index.js";
import { withMigrationLock } from "../schema/lock.js";
import { SchemaVersionError } from "../schema/version.js";
import { withStateLock } from "./lock.js";

describe("withStateLock", () => {
  let tmp: string;
  let locttDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loctt-lock-"));
    locttDir = join(tmp, ".loctt");
    await mkdir(locttDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("serializes parallel critical sections on the same locttDir", async () => {
    const order: string[] = [];

    const slow = withStateLock(locttDir, async () => {
      order.push("a:start");
      await new Promise(r => setTimeout(r, 100));
      order.push("a:end");
    });

    // Tiny delay to make sure `slow` acquires first.
    await new Promise(r => setTimeout(r, 10));

    const fast = withStateLock(locttDir, () => {
      order.push("b:start");
      order.push("b:end");
      return Promise.resolve();
    });

    await Promise.all([slow, fast]);

    // The second invocation must not interleave inside the first.
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("releases the lock when the critical section throws", async () => {
    await expect(
      withStateLock(locttDir, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    // The next call should acquire immediately, not hang.
    let ran = false;
    await withStateLock(locttDir, () => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });

  it("releases the lock on success so subsequent calls can acquire", async () => {
    let count = 0;
    await withStateLock(locttDir, () => { count++; return Promise.resolve(); });
    await withStateLock(locttDir, () => { count++; return Promise.resolve(); });
    await withStateLock(locttDir, () => { count++; return Promise.resolve(); });
    expect(count).toBe(3);
  });

  describe("interaction with the migration lock", () => {
    it("refuses to enter the state lock while a migration is in progress", async () => {
      // Stamp a schema-version file so the migration lock can attach.
      await writeFile(getSchemaVersionPath(locttDir), "1\n", "utf-8");

      let ranInsideStateLock = false;
      // Hold the migration lock while trying to acquire state lock.
      await withMigrationLock(locttDir, async () => {
        await expect(
          withStateLock(locttDir, () => {
            ranInsideStateLock = true;
            return Promise.resolve();
          }),
        ).rejects.toThrow(SchemaVersionError);
      });

      expect(ranInsideStateLock).toBe(false);
    });

    it("allows state lock again once the migration lock is released", async () => {
      await writeFile(getSchemaVersionPath(locttDir), "1\n", "utf-8");

      // First, demonstrate the block.
      await withMigrationLock(locttDir, async () => {
        await expect(
          withStateLock(locttDir, () => Promise.resolve()),
        ).rejects.toThrow(SchemaVersionError);
      });

      // After the migration lock is released, state writes work.
      let ran = false;
      await withStateLock(locttDir, () => {
        ran = true;
        return Promise.resolve();
      });
      expect(ran).toBe(true);
    });
  });
});

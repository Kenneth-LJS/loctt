import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backupLocttDir,
  compareFormatVersions,
  readSchemaVersion,
  SchemaUnmigratableError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `loctt-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// @verifies ONB-C11
describe("readSchemaVersion (K142: a format version is semver)", () => {
  it("returns null when .schema-version is absent", async () => {
    expect(await readSchemaVersion(dir)).toBeNull();
  });

  it("returns the format version when valid", async () => {
    await writeFile(join(dir, ".schema-version"), "0.3.0\n", "utf-8");
    expect(await readSchemaVersion(dir)).toBe("0.3.0");
  });

  it("ignores surrounding whitespace", async () => {
    await writeFile(join(dir, ".schema-version"), "  0.1.0  \n", "utf-8");
    expect(await readSchemaVersion(dir)).toBe("0.1.0");
  });

  it("refuses an empty file, saying what it must hold", async () => {
    await writeFile(join(dir, ".schema-version"), "", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(/is empty\. It must hold a format version such as 0\.4\.0/);
  });

  // No compatibility for the old integer (K142): Ken edits `1` to `0.1.0`.
  it("refuses the old integer 1, saying what the file must hold and what to write", async () => {
    await writeFile(join(dir, ".schema-version"), "1\n", "utf-8");
    const err = await readSchemaVersion(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaUnmigratableError);
    expect((err as Error).message).toBe(
      ".schema-version must hold a format version such as 0.4.0 (three whole numbers separated by dots). Got: 1.",
    );
    expect((err as SchemaUnmigratableError).remedy).toMatch(/0\.1\.0 for a tracker made by loctt 0\.2\.x or earlier \(which wrote 1\)/);
  });

  it.each(["abc", "0.3", "0.3.0.1", "v0.3.0", "0.3.0-beta.1", "01.2.3", "0.03.0", "-1.0.0"])(
    "refuses %s (not MAJOR.MINOR.PATCH, or a pre-release tag)",
    async (raw) => {
      await writeFile(join(dir, ".schema-version"), raw, "utf-8");
      await expect(readSchemaVersion(dir)).rejects.toThrow(/must hold a format version/);
    },
  );
});

// @verifies ONB-C11
describe("compareFormatVersions", () => {
  it("compares as semver, not as strings", () => {
    expect(compareFormatVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareFormatVersions("0.1.0", "0.3.0")).toBeLessThan(0);
    expect(compareFormatVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareFormatVersions("0.3.0", "0.3.0")).toBe(0);
    expect(compareFormatVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
  });
});

describe("writeSchemaVersion", () => {
  it("writes the version atomically with a trailing newline", async () => {
    await writeSchemaVersion(dir, "0.3.0");
    const contents = await readFile(join(dir, ".schema-version"), "utf-8");
    expect(contents).toBe("0.3.0\n");
  });

  it("rejects a non-semver version", async () => {
    await expect(writeSchemaVersion(dir, "1")).rejects.toThrow(SchemaVersionError);
    await expect(writeSchemaVersion(dir, "0.3.0-rc.1")).rejects.toThrow(SchemaVersionError);
  });

  it("round-trips through read", async () => {
    await writeSchemaVersion(dir, "4.5.6");
    expect(await readSchemaVersion(dir)).toBe("4.5.6");
  });
});

describe("backupLocttDir", () => {
  it("copies the directory to a sibling path with a versioned timestamped name", async () => {
    await writeFile(join(dir, "marker.txt"), "hello", "utf-8");
    const backupPath = await backupLocttDir(dir, "0.1.0");
    expect(backupPath).toMatch(/\.backup-v0\.1\.0-/);
    const stats = await stat(backupPath);
    expect(stats.isDirectory()).toBe(true);
    const copied = await readFile(join(backupPath, "marker.txt"), "utf-8");
    expect(copied).toBe("hello");
    await rm(backupPath, { recursive: true, force: true });
  });
});

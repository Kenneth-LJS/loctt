import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backupLocttDir,
  readSchemaVersion,
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

describe("readSchemaVersion", () => {
  it("returns null when .schema-version is absent", async () => {
    expect(await readSchemaVersion(dir)).toBeNull();
  });

  it("returns the integer when valid", async () => {
    await writeFile(join(dir, ".schema-version"), "3\n", "utf-8");
    expect(await readSchemaVersion(dir)).toBe(3);
  });

  it("ignores surrounding whitespace", async () => {
    await writeFile(join(dir, ".schema-version"), "  7  \n", "utf-8");
    expect(await readSchemaVersion(dir)).toBe(7);
  });

  it("throws on empty content", async () => {
    await writeFile(join(dir, ".schema-version"), "", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("throws on non-numeric content", async () => {
    await writeFile(join(dir, ".schema-version"), "abc", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("throws on zero", async () => {
    await writeFile(join(dir, ".schema-version"), "0", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("throws on negative", async () => {
    await writeFile(join(dir, ".schema-version"), "-1", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(SchemaVersionError);
  });

  it("throws on non-integer", async () => {
    await writeFile(join(dir, ".schema-version"), "1.5", "utf-8");
    await expect(readSchemaVersion(dir)).rejects.toThrow(SchemaVersionError);
  });
});

describe("writeSchemaVersion", () => {
  it("writes the version atomically with a trailing newline", async () => {
    await writeSchemaVersion(dir, 2);
    const contents = await readFile(join(dir, ".schema-version"), "utf-8");
    expect(contents).toBe("2\n");
  });

  it("rejects non-integer", async () => {
    await expect(writeSchemaVersion(dir, 1.5)).rejects.toThrow(SchemaVersionError);
  });

  it("rejects zero", async () => {
    await expect(writeSchemaVersion(dir, 0)).rejects.toThrow(SchemaVersionError);
  });

  it("round-trips through read", async () => {
    await writeSchemaVersion(dir, 42);
    expect(await readSchemaVersion(dir)).toBe(42);
  });
});

describe("backupLocttDir", () => {
  it("copies the directory to a sibling path with a versioned timestamped name", async () => {
    await writeFile(join(dir, "marker.txt"), "hello", "utf-8");
    const backupPath = await backupLocttDir(dir, 3);
    expect(backupPath).toMatch(/\.backup-v3-/);
    const stats = await stat(backupPath);
    expect(stats.isDirectory()).toBe(true);
    const copied = await readFile(join(backupPath, "marker.txt"), "utf-8");
    expect(copied).toBe("hello");
    await rm(backupPath, { recursive: true, force: true });
  });
});

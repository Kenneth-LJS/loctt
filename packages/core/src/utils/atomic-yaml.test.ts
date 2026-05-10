import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { writeFileAtomically, writeYamlAtomically } from "./atomic-yaml.js";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `loctt-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeYamlAtomically", () => {
  it("writes serialized YAML to the target path", async () => {
    const path = join(dir, "config.yaml");
    await writeYamlAtomically(path, { greeting: "hello", count: 3 });
    const raw = await readFile(path, "utf-8");
    expect(parseYaml(raw)).toEqual({ greeting: "hello", count: 3 });
  });

  it("creates parent directories as needed", async () => {
    const path = join(dir, "nested", "deep", "config.yaml");
    await writeYamlAtomically(path, { ok: true });
    const raw = await readFile(path, "utf-8");
    expect(parseYaml(raw)).toEqual({ ok: true });
  });

  it("does not leave temp files behind on success", async () => {
    const path = join(dir, "config.yaml");
    await writeYamlAtomically(path, { a: 1 });
    const entries = await readdir(dir);
    expect(entries.filter(e => e.endsWith(".tmp"))).toHaveLength(0);
  });

  it("overwrites existing files", async () => {
    const path = join(dir, "config.yaml");
    await writeYamlAtomically(path, { v: 1 });
    await writeYamlAtomically(path, { v: 2 });
    const raw = await readFile(path, "utf-8");
    expect(parseYaml(raw)).toEqual({ v: 2 });
  });
});

describe("writeFileAtomically", () => {
  it("writes plain text content", async () => {
    const path = join(dir, "version.txt");
    await writeFileAtomically(path, "1\n");
    expect(await readFile(path, "utf-8")).toBe("1\n");
  });

  it("creates parent directories as needed", async () => {
    const path = join(dir, "nested", "v.txt");
    await writeFileAtomically(path, "x");
    expect(await readFile(path, "utf-8")).toBe("x");
  });
});

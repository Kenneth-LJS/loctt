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

  it("concurrent readers never see a half-written file", async () => {
    // Hammer the file with overlapping writes (multiple writer
    // loops running in parallel, each emitting payloads spanning
    // multiple filesystem pages so the kernel actually has the
    // chance to tear a non-atomic write) while many readers read in
    // parallel. Every read must produce either ENOENT (before the
    // first rename lands) or a complete, parseable YAML doc with
    // a version-correlated payload. A read that returns truncated
    // bytes would either fail to parse or yield a wrong-length
    // payload — both fail this assertion.
    //
    // To prove this catches non-atomic writes, swap
    // writeYamlAtomically for a naive writeFile: the readers will
    // see torn payloads and the test will fail loudly.
    const path = join(dir, "config.yaml");
    // Each "page" is 4 KiB; emit payloads spanning >=16 pages so a
    // partial write is visible to a racing reader.
    const PAGE_BYTES = 4096;
    const PAYLOAD_PAGES = 16;
    const charForVersion = (v: number) => String.fromCharCode(33 + (v % 90));
    const payloadFor = (v: number) => charForVersion(v).repeat(PAGE_BYTES * PAYLOAD_PAGES);

    // Seed so the first reader always finds something rather than
    // racing the very first write.
    await writeYamlAtomically(path, { v: 0, payload: payloadFor(0) });

    let stop = false;
    const readErrors: string[] = [];
    const seenVersions = new Set<number>();

    const reader = async () => {
      while (!stop) {
        try {
          const raw = await readFile(path, "utf-8");
          const parsed = parseYaml(raw) as { v?: number; payload?: string };
          if (typeof parsed?.v !== "number" || typeof parsed.payload !== "string") {
            readErrors.push(`shape mismatch: ${JSON.stringify(parsed).slice(0, 80)}`);
            return;
          }
          // Length and content must both match the version stamp.
          // A truncated read would either fail YAML parsing above,
          // or land here with a short payload.
          const expected = payloadFor(parsed.v);
          if (parsed.payload.length !== expected.length) {
            readErrors.push(
              `payload length ${parsed.payload.length} != ${expected.length} for v=${parsed.v}`,
            );
            return;
          }
          // Cheap content check (don't compare the whole 64 KiB).
          if (parsed.payload[0] !== expected[0] || parsed.payload[parsed.payload.length - 1] !== expected[expected.length - 1]) {
            readErrors.push(`payload boundary mismatch for v=${parsed.v}`);
            return;
          }
          seenVersions.add(parsed.v);
        } catch (err) {
          // Any parse error fails the test — that's exactly the
          // half-write window we're trying to prove doesn't exist.
          readErrors.push((err as Error).message);
          return;
        }
      }
    };

    // Two writers racing each other. They share a single counter so
    // version stamps strictly increase, but the actual writeYamlAtomically
    // calls overlap in flight — the temp-file + rename pattern must
    // serialize them at the filesystem layer.
    let nextVersion = 1;
    const writer = async (limit: number) => {
      while (true) {
        const v = nextVersion;
        if (v > limit) return;
        nextVersion = v + 1;
        await writeYamlAtomically(path, { v, payload: payloadFor(v) });
      }
    };

    const readers = [reader(), reader(), reader(), reader()];
    await Promise.all([writer(40), writer(40)]);
    stop = true;
    await Promise.all(readers);

    expect(readErrors).toEqual([]);
    expect(seenVersions.size).toBeGreaterThan(1);
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

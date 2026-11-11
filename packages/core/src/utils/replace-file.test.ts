import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { replaceFile } from "./replace-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-replace-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("replaceFile", () => {
  it("lands every write when two writers replace the same file at once", async () => {
    // On Windows a plain `rename` over a file another rename is replacing
    // fails with EPERM (measured: a few in every 80 here). The retry is
    // what makes the atomic writes safe to race. Red-proof: swap
    // `replaceFile` for `rename` and this fails on Windows.
    const target = join(dir, "state.yaml");
    await writeFile(target, "0");
    const failures: string[] = [];
    const writer = async (id: string): Promise<void> => {
      for (let i = 0; i < 150; i += 1) {
        const tmp = `${target}.${id}.${String(i)}.tmp`;
        await writeFile(tmp, `${id}${String(i)}`.repeat(4096));
        try {
          await replaceFile(tmp, target);
        } catch (err) {
          failures.push((err as NodeJS.ErrnoException).code ?? "?");
        }
      }
    };
    await Promise.all([writer("a"), writer("b")]);
    expect(failures).toEqual([]);
    expect((await readFile(target, "utf-8")).length).toBeGreaterThan(0);
  });

  it("rethrows a failure that is not a transient lock at once", async () => {
    const started = Date.now();
    await expect(replaceFile(join(dir, "missing.tmp"), join(dir, "x"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

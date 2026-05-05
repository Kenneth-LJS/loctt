import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { withTmpLoctt, WORKSPACE_PREFIX } from "./tmp-loctt.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("withTmpLoctt fixture", () => {
  it("creates a workspace under tests/workspace/ and removes it after", async () => {
    let observedRoot: string | null = null;

    await withTmpLoctt(async ({ root }) => {
      observedRoot = root;
      expect(root.startsWith(WORKSPACE_PREFIX)).toBe(true);
      expect(await pathExists(root)).toBe(true);
      const stats = await stat(root);
      expect(stats.isDirectory()).toBe(true);
    });

    expect(observedRoot).not.toBeNull();
    expect(await pathExists(observedRoot!)).toBe(false);
  });

  it("initializes .loctt/ by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      expect(await pathExists(path.join(root, ".loctt"))).toBe(true);
      expect(await pathExists(path.join(root, ".loctt/config/workflow.yaml"))).toBe(true);
    });
  });

  it("skips init when opts.init is false", async () => {
    await withTmpLoctt(
      async ({ root }) => {
        expect(await pathExists(path.join(root, ".loctt"))).toBe(false);
      },
      { init: false },
    );
  });

  it("cleans up even when fn throws", async () => {
    let observedRoot: string | null = null;

    await expect(
      withTmpLoctt(async ({ root }) => {
        observedRoot = root;
        expect(await pathExists(root)).toBe(true);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(observedRoot).not.toBeNull();
    expect(await pathExists(observedRoot!)).toBe(false);
  });

  it("isolates concurrent workspaces", async () => {
    const roots = await Promise.all(
      Array.from({ length: 4 }, () =>
        withTmpLoctt(async ({ root }) => {
          const sentinel = path.join(root, "sentinel.txt");
          await writeFile(sentinel, root, "utf8");
          const back = await readFile(sentinel, "utf8");
          expect(back).toBe(root);
          return root;
        }),
      ),
    );

    // every root unique
    expect(new Set(roots).size).toBe(roots.length);

    // every root cleaned up
    for (const root of roots) {
      expect(await pathExists(root)).toBe(false);
    }
  });

  it("restores process.cwd, process.env, and process.argv after fn", async () => {
    const cwdBefore = process.cwd();
    const argvBefore = [...process.argv];
    const envSnapshot = { ...process.env };

    await withTmpLoctt(async ({ root }) => {
      process.chdir(root);
      process.argv = ["node", "fake", "args"];
      process.env.LOCTT_TEST_FIXTURE_SENTINEL = "1";
      delete process.env.PATH; // intentionally trash something present before
      await Promise.resolve();
    });

    expect(process.cwd()).toBe(cwdBefore);
    expect(process.argv).toEqual(argvBefore);
    expect(process.env.LOCTT_TEST_FIXTURE_SENTINEL).toBeUndefined();
    expect(process.env.PATH).toBe(envSnapshot.PATH);
  });
});

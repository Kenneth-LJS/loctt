import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/** `loctt user settings`, against the spawned binary and the file on disk. */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("CLI user settings (spawned binary)", () => {
  // @verifies SET-11
  it("prints the stored personal settings", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(await settingsPath(root), "theme: dark\n", "utf8");
      const result = await runCli(["user", "settings"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("theme");
      expect(result.stdout).toContain("dark");
    });
  });

  // @verifies SET-11
  it("renders a nested UI-only key as JSON, not [object Object]", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Settings round-trip unknown keys through `.passthrough()`, and
      // several are nested objects. Printing them via `String(v)` gives
      // the user "[object Object]" — strictly less information than the
      // file they already have.
      await writeFile(
        await settingsPath(root),
        "list_view:\n  filter_chips:\n    show:\n      - reporter\n",
        "utf8",
      );
      const result = await runCli(["user", "settings"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("[object Object]");
      expect(result.stdout).toContain("reporter");
    });
  });
});

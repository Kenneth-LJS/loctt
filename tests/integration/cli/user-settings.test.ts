import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt user settings` (SET-13, SET-27).
 *
 * Core gained the pin sweep for the web UI's pins panel. Ken's layer
 * rule is that a core capability reaches CLI and MCP too, so this
 * exercises the CLI surface of it against the spawned binary and the
 * file on disk.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("CLI user settings (spawned binary)", () => {
  // @verifies SET-27
  it("names the pins it sweeps and rewrites settings.yaml without them", async () => {
    await withTmpLoctt(async ({ root }) => {
      const file = await settingsPath(root);
      await writeFile(
        file,
        "theme: dark\nsidebar_pins:\n  - v_gone\n  - v_also_gone\n",
        "utf8",
      );

      const result = await runCli(["user", "settings", "--sweep-pins"], { cwd: root });
      expect(result.exitCode).toBe(0);
      // Named, not counted — "removed 2 pins" gives the user nothing
      // to act on. This is the explaining behaviour the README's P7
      // amendment requires over SET-13's superseded "silently".
      expect(result.stdout).toContain("v_gone");
      expect(result.stdout).toContain("v_also_gone");

      const after = await readFile(file, "utf8");
      expect(after).toContain("sidebar_pins: []");
      // An unrelated preference is not collateral damage of the sweep.
      expect(after).toContain("theme: dark");
    });
  });

  // @verifies SET-13
  it("keeps a pin whose view still exists and reports nothing to sweep", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Read a real view id out of the shipped queries.yaml, so the
      // pin points at something that genuinely exists.
      const queries = await readFile(
        path.join(root, ".loctt", "config", "queries.yaml"),
        "utf8",
      );
      // Entries are list items, so the id line reads "- id: <ulid>".
      const idLine = queries.split("\n").find(l => /^\s*-?\s*id:/.test(l));
      const viewId = String(idLine).split(":")[1]?.trim();
      expect(viewId).toBeTruthy();

      const file = await settingsPath(root);
      await writeFile(file, `sidebar_pins:\n  - ${String(viewId)}\n`, "utf8");

      const result = await runCli(["user", "settings", "--sweep-pins"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No stale sidebar pins");

      // The pin is untouched — existence is the test, not task counts.
      expect(await readFile(file, "utf8")).toContain(String(viewId));
    });
  });

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

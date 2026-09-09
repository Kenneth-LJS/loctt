import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * CLI-1 (B5): `--root` is the canonical global tracker-root flag, `--cwd`
 * is its back-compat alias, and `LOCTT_ROOT` is an env fallback. These run
 * against the REAL spawned binary so they prove the built arg-parsing
 * end-to-end — a wrong root operates on the wrong tracker, which is a data
 * hazard, so the targeting is exercised, not just asserted in a unit.
 *
 * The binary is spawned from a NON-tracker directory (`elsewhere`) so a
 * passing result can only come from the flag/env, never from an ambient
 * `.loctt/` in the spawn cwd.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

describe("CLI --root / --cwd / LOCTT_ROOT targeting (spawned binary)", () => {
  let elsewhere: string;

  beforeEach(async () => {
    // A directory with no .loctt/ — the spawn cwd must not be a tracker.
    elsewhere = await mkdtemp(path.join(workspaceRoot, "loctt-elsewhere-"));
  });
  afterEach(async () => {
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("--root <dir> targets that tracker from a different cwd", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(["--root", root, "create", "rooted task"], { cwd: elsewhere });
      expect(create.exitCode).toBe(0);
      expect(create.stdout).toContain("T-1");

      const list = await runCli(["--root", root, "list"], { cwd: elsewhere });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("rooted task");
    });
  });

  it("--cwd <dir> still works as the alias", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(["--cwd", root, "create", "aliased task"], { cwd: elsewhere });
      expect(create.exitCode).toBe(0);
      const list = await runCli(["--cwd", root, "list"], { cwd: elsewhere });
      expect(list.stdout).toContain("aliased task");
    });
  });

  it("LOCTT_ROOT env targets the tracker when no flag is given", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(["create", "env task"], {
        cwd: elsewhere,
        env: { LOCTT_ROOT: root },
      });
      expect(create.exitCode).toBe(0);
      const list = await runCli(["list"], { cwd: elsewhere, env: { LOCTT_ROOT: root } });
      expect(list.stdout).toContain("env task");
    });
  });

  it("an explicit flag wins over LOCTT_ROOT (flag > env precedence)", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Point the env at the empty `elsewhere` dir but the flag at the
      // real tracker; the flag must win, so the create lands in `root`.
      const create = await runCli(["--root", root, "create", "flag wins"], {
        cwd: elsewhere,
        env: { LOCTT_ROOT: elsewhere },
      });
      expect(create.exitCode).toBe(0);
      const list = await runCli(["--root", root, "list"], { cwd: elsewhere });
      expect(list.stdout).toContain("flag wins");
    });
  });

  it("--root and --cwd with different values is a usage error (exit 2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["--root", root, "--cwd", elsewhere, "list"], { cwd: elsewhere });
      expect(res.exitCode).toBe(2);
      expect(res.stderr).toMatch(/--root.*--cwd|--cwd.*--root/);
    });
  });

  it("loctt ui accepts --root directly (not 'unknown option')", async () => {
    await withTmpLoctt(async ({ root }) => {
      // `--port 0` is below the valid range, so `ui` exits 2 on the PORT —
      // which proves the global `--root` was stripped/accepted and never
      // reached `ui`'s unknown-option guard. (Spawning a real server would
      // bind a port; this exercises the same arg path without that.)
      const res = await runCli(["ui", "--root", root, "--port", "0", "--no-open"], {
        cwd: elsewhere,
      });
      expect(res.exitCode).toBe(2);
      expect(res.stderr).not.toMatch(/unknown option/i);
      expect(res.stderr).toMatch(/--port/);
    });
  });
});

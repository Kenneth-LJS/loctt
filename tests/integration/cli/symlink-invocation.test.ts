import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const REAL_BINARY = path.join(REPO_ROOT, "apps/cli/dist/index.js");

/**
 * The CLI's "is this being run directly?" guard previously compared
 * process.argv[1] verbatim against fileURLToPath(import.meta.url). When
 * the binary is invoked through a symlink (npm link, global install,
 * nvm shim, etc.), argv[1] points at the symlink while import.meta.url
 * resolves to the real path, so the guard mis-fired and main() never
 * ran — the binary exited 0 with no output.
 *
 * This test pins the behavior: invoking via a symlink must produce the
 * same output as invoking the real path.
 */
describe("CLI symlink invocation", () => {
  let symlinkDir: string;

  beforeEach(async () => {
    symlinkDir = await mkdtemp(path.join(tmpdir(), "loctt-symlink-"));
  });

  afterEach(async () => {
    await rm(symlinkDir, { recursive: true, force: true });
  });

  it("loctt help works when invoked through a symlink", async () => {
    const symlinkPath = path.join(symlinkDir, "loctt");
    await symlink(REAL_BINARY, symlinkPath);

    await withTmpLoctt(async ({ root }) => {
      const result = await execa(process.execPath, [symlinkPath, "help"], {
        cwd: root,
        reject: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage: loctt");
    });
  });

  it("loctt init+create works when invoked through a symlink", async () => {
    const symlinkPath = path.join(symlinkDir, "loctt");
    await symlink(REAL_BINARY, symlinkPath);

    await withTmpLoctt(
      async ({ root }) => {
        const init = await execa(process.execPath, [symlinkPath, "init"], {
          cwd: root,
          reject: false,
        });
        expect(init.exitCode).toBe(0);

        const create = await execa(process.execPath, [symlinkPath, "create", "via symlink"], {
          cwd: root,
          reject: false,
        });
        expect(create.exitCode).toBe(0);
        expect(create.stdout).toContain("T-1");
      },
      { init: false },
    );
  });
});

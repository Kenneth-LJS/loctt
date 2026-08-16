import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C9
 * @verifies GIT-C9
 *
 * Two "leaves nothing wrong behind" cases. Both behave correctly and
 * neither was asserted — and a partial failure is exactly the kind of
 * thing that regresses without anyone noticing, because the happy path
 * still works.
 */
describe("failures leave no partial state", () => {
  it("rejects a documented-but-absent flag rather than discarding it (PRU-C9)", async () => {
    await withTmpLoctt(async ({ root }) => {
      // The reference once documented `--label` on project create. The
      // CLI never read it, so the worked example created a project named
      // `web` and dropped the label without a word.
      const res = await runCli(
        ["project", "create", "web", "--prefix", "WEB-", "--label", "Website"],
        { cwd: root },
      );

      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/--label/);

      // And it must not have created the project anyway.
      const list = await runCli(["project", "list"], { cwd: root });
      expect(list.stdout).not.toMatch(/\bweb\b/);
    });
  });

  it("leaves nothing behind when git enable fails (GIT-C9)", async () => {
    // Deliberately outside the repo tree: withTmpLoctt creates
    // workspaces under tests/workspace/, which is inside LocTT's own
    // git repo, so isGitRepo walks up and finds .git — enable would
    // succeed and the test would prove nothing.
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(path.join(tmpdir(), "loctt-nogit-"));
    try {
      await runCli(["init"], { cwd: root });

      const res = await runCli(["git", "enable"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/git repository/i);

      // A sync.yaml written by a failed enable would leave the tracker
      // claiming git-backed mode it cannot perform.
      await expect(
        access(path.join(root, ".loctt/local/sync.yaml")),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

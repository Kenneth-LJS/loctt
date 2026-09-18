import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { getSyncStatePath, resolveLocttDir } from "../paths/index.js";
import { loadSyncState } from "../state/sync.js";
import { disableGit, enableGit, getGitStatus } from "./git-mode.js";
import { branchHeadCommit, GitBranchAdoptNeededError, publish } from "./publish-sync.js";

describe("git mode", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-git-"));
    // Initialize a git repo
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("enableGit", () => {
    it("creates sync.yaml with enabled=true", async () => {
      await enableGit(locttDir, root);
      const status = await getGitStatus(locttDir, root);
      expect(status.enabled).toBe(true);
      expect(status.branch).toBe("loctt");
      expect(status.isGitRepo).toBe(true);
    });

    it("throws when already enabled", async () => {
      await enableGit(locttDir, root);
      await expect(enableGit(locttDir, root)).rejects.toThrow("already enabled");
    });
  });

  /**
   * GIT-25: enabling git sync when a `loctt` branch already exists from a
   * previous setup. The branch here is LocTT-written (created by a real
   * publish) — distinct from the foreign-content case, which stays a hard
   * refusal. `git config` is needed for the publish's commit.
   */
  describe("enableGit — pre-existing LocTT branch (GIT-25)", () => {
    beforeEach(() => {
      execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    });

    /**
     * Creates a real LocTT-written `loctt` branch (via enable+publish),
     * then removes sync.yaml so a subsequent enable starts fresh — the
     * "branch from a previous setup, git mode now off" situation GIT-25
     * describes. Returns the branch head.
     */
    async function seedExistingBranch(): Promise<string> {
      await enableGit(locttDir, root);
      await publish(locttDir, root);
      const head = branchHeadCommit(root, "loctt");
      if (head === undefined) throw new Error("test setup: loctt branch was not created");
      // Wipe the local sync state so enable runs as if freshly set up,
      // with only the branch left behind.
      await rm(getSyncStatePath(locttDir), { force: true });
      return head;
    }

    it("without adopt: reports the branch head and does NOT enable (no silent adopt)", async () => {
      // @verifies GIT-25
      const head = await seedExistingBranch();

      const err = await enableGit(locttDir, root).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GitBranchAdoptNeededError);
      const adoptErr = err as GitBranchAdoptNeededError;
      expect(adoptErr.branch).toBe("loctt");
      expect(adoptErr.branchHead).toBe(head);
      // It shows the head commit before adopting.
      expect(adoptErr.message).toContain(head.slice(0, 8));

      // Nothing was written: git mode is still off — no silent adopt.
      const status = await getGitStatus(locttDir, root);
      expect(status.enabled).toBe(false);
      expect(status.lastSyncedCommit).toBeUndefined();
    });

    it("with adopt: enables, sets last_synced_commit to the branch head, and reports agreement", async () => {
      // @verifies GIT-25
      const head = await seedExistingBranch();

      const result = await enableGit(locttDir, root, undefined, { adopt: true });

      // Adopting sets last_synced_commit to the branch head.
      const state = await loadSyncState(locttDir);
      expect(state.git.enabled).toBe(true);
      expect(state.git.last_synced_commit).toBe(head);

      // The adopt outcome names the branch + head and reports agreement.
      // The branch was published from the current local state and nothing
      // changed since, so local agrees with it — no sync needed.
      expect(result.adopted).toBeDefined();
      expect(result.adopted?.branch).toBe("loctt");
      expect(result.adopted?.branchHead).toBe(head);
      expect(result.adopted?.inAgreement).toBe(true);
    });

    it("with adopt: reports disagreement when local state differs from the branch", async () => {
      // @verifies GIT-25
      await seedExistingBranch();
      // Diverge local from the branch: add a publishable config file that
      // the branch does not carry.
      await writeFile(join(locttDir, "config", "extra.yaml"), "added: true\n", "utf-8");

      const result = await enableGit(locttDir, root, undefined, { adopt: true });
      expect(result.adopted?.inAgreement).toBe(false);
    });

    it("a fresh enable (no pre-existing branch) does not report an adopt outcome", async () => {
      // @verifies GIT-25
      const result = await enableGit(locttDir, root);
      expect(result.adopted).toBeUndefined();
      const state = await loadSyncState(locttDir);
      expect(state.git.last_synced_commit).toBeUndefined();
    });
  });

  describe("disableGit", () => {
    it("sets enabled=false", async () => {
      await enableGit(locttDir, root);
      await disableGit(locttDir);
      const status = await getGitStatus(locttDir, root);
      expect(status.enabled).toBe(false);
    });

    it("throws when not enabled", async () => {
      await expect(disableGit(locttDir)).rejects.toThrow("not enabled");
    });
  });

  describe("getGitStatus", () => {
    it("reports disabled when no sync.yaml", async () => {
      const status = await getGitStatus(locttDir, root);
      expect(status.enabled).toBe(false);
      expect(status.isGitRepo).toBe(true);
    });

    it("detects non-git repos", async () => {
      const nonGitRoot = await mkdtemp(join(tmpdir(), "loctt-nogit-"));
      await initLoctt(nonGitRoot);
      const ngLocttDir = resolveLocttDir(nonGitRoot);
      const status = await getGitStatus(ngLocttDir, nonGitRoot);
      expect(status.isGitRepo).toBe(false);
      await rm(nonGitRoot, { recursive: true, force: true });
    });
  });
});

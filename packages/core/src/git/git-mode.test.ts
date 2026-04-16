import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLoctt } from "../init/init.js";
import { enableGit, disableGit, getGitStatus } from "./git-mode.js";
import { resolveLocttDir } from "../paths/index.js";

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
      expect(status.branch).toBe(".loctt");
      expect(status.isGitRepo).toBe(true);
    });

    it("throws when already enabled", async () => {
      await enableGit(locttDir, root);
      await expect(enableGit(locttDir, root)).rejects.toThrow("already enabled");
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

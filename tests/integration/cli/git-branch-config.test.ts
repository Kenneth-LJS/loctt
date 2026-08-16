import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";

/**
 * @verifies GIT-C10
 *
 * `git.branch` is user-configurable, so nothing may assume the literal
 * `loctt`. The operations were already correct — publish, sync, status
 * and the foreign-content guard all read the configured name — but every
 * success message printed "loctt branch" regardless, naming a branch
 * that does not exist on a tracker that renamed it.
 *
 * Workspaces live under the OS tmpdir, not `tests/workspace/`: a
 * `git init` inside LocTT's own checkout resolves to LocTT's `.git`, and
 * every assertion here would be about the wrong repository.
 */

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const r = roots.pop();
    if (r) await rm(r, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A git repo with a tracker in it, git mode on, branch renamed. */
async function renamedTracker(branch = "my-tasks"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loctt-branch-"));
  roots.push(root);
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "commit", "--allow-empty", "-m", "init");

  await runCli(["init", "--prefix", "B"], { cwd: root });
  await runCli(["create", "before rename"], { cwd: root });
  // git mode must be enabled before config writes: the keys live in
  // sync.yaml, which enable creates.
  await runCli(["git", "enable"], { cwd: root });
  await runCli(["config", "set", "git.branch", branch], { cwd: root });
  return root;
}

describe("configured git.branch (spawned binary)", () => {
  it("publishes to the configured branch and names it", async () => {
    const root = await renamedTracker();

    const pub = await runCli(["git", "publish"], { cwd: root });
    expect(pub.exitCode).toBe(0);
    // The message used to say "loctt branch" on a tracker with no
    // branch by that name.
    expect(pub.stdout).toContain("my-tasks");
    expect(pub.stdout).not.toMatch(/to loctt branch/);

    const branches = execFileSync("git", ["branch", "--format=%(refname:short)"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(branches).toContain("my-tasks");
    expect(branches.split("\n")).not.toContain("loctt");
  });

  it("names the configured branch when a sync applies changes", async () => {
    const root = await renamedTracker();
    await runCli(["git", "publish"], { cwd: root });

    // Move the branch from outside, so the next sync has work to do.
    const worktree = join(root, "..", `wt-branch-${process.pid}`);
    git(root, "worktree", "add", "-q", worktree, "my-tasks");
    try {
      const file = join(worktree, "config/workflow.yaml");
      await writeFile(file, `${await readFile(file, "utf8")}\n# touched\n`, "utf8");
      git(worktree, "add", "-A");
      git(worktree, "commit", "-m", "branch edit");
    } finally {
      git(root, "worktree", "remove", "--force", worktree);
    }

    const sync = await runCli(["git", "sync"], { cwd: root });
    expect(sync.exitCode).toBe(0);
    // Guard against a vacuous pass: "Already up to date" contains no
    // branch name at all and would satisfy a naive assertion.
    expect(sync.stdout).toContain("into local workspace");
    expect(sync.stdout).toContain("my-tasks");
    expect(sync.stdout).not.toMatch(/Synced loctt branch/);
  });

  it("reports the configured branch in status", async () => {
    const root = await renamedTracker();
    const status = await runCli(["git", "status"], { cwd: root });
    expect(status.stdout).toMatch(/Branch:\s+my-tasks/);
  });

  it("refuses to adopt a configured branch holding unrelated work", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-branch-foreign-"));
    roots.push(root);
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "test");
    await writeFile(join(root, "readme.md"), "hi\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-m", "init");
    // A branch that already holds someone's work, under the name the
    // tracker is about to be pointed at.
    git(root, "checkout", "-q", "-b", "notes");
    await writeFile(join(root, "notes.txt"), "my notes\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-m", "notes");
    git(root, "checkout", "-q", "-");

    await runCli(["init", "--prefix", "F"], { cwd: root });
    await runCli(["git", "enable"], { cwd: root });
    await runCli(["config", "set", "git.branch", "notes"], { cwd: root });

    const pub = await runCli(["git", "publish"], { cwd: root });
    expect(pub.exitCode).not.toBe(0);
    const out = `${pub.stdout}${pub.stderr}`;
    // The guard has to fire on the *configured* name, and say which.
    expect(out).toMatch(/refusing to publish/i);
    expect(out).toContain("notes");
    expect(out).toContain("notes.txt");

    // And the work must still be there.
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "notes"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(files).toContain("notes.txt");
  });

  it("names the configured branch through MCP too", async () => {
    const root = await renamedTracker();
    const client = await startMcpClient(root);
    try {
      const result = await client.callTool("publish_to_git", {});
      expect(result.isError).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("my-tasks");
      expect(text).not.toMatch(/to loctt branch/);
    } finally {
      await client.close();
    }
  });
});

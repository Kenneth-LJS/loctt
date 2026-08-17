import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";

/**
 * A file LocTT cannot read must never be reported as a fact about the
 * data. Three surfaces, one rule.
 *
 * Reproduced against the built binary 2026-08-17:
 *
 *   git status      Enabled: true  ->  Enabled: false, exit 0
 *   config list     five values    ->  five blanks,    exit 0
 *   list_views      the views      ->  "No saved views configured."
 *
 * Each is a plausible answer, which is what makes it dangerous: nothing
 * signals it should be distrusted, and the natural response — re-enable
 * git mode, recreate the views — writes over the state being recovered.
 *
 * These run outside the repo tree. `withTmpLoctt` creates workspaces
 * under `tests/workspace/`, where `isGitRepo` walks up and finds
 * LocTT's own `.git`, so a git test there proves nothing.
 */

let root: string;

function syncPath(): string {
  return path.join(root, ".loctt/local/sync.yaml");
}

function queriesPath(): string {
  return path.join(root, ".loctt/config/queries.yaml");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "loctt-unreadable-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await runCli(["init", "--project-label", "Web", "--prefix", "T"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  await runCli(["git", "enable"], { cwd: root });
});

afterEach(async () => {
  await chmod(syncPath(), 0o644).catch(() => {});
  await chmod(queriesPath(), 0o644).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("git status on an unreadable sync.yaml", () => {
  it("reports enabled when the file reads", async () => {
    const r = await runCli(["git", "status"], { cwd: root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Enabled: true");
  });

  it("does not report git mode as disabled when it could not be read", async () => {
    await chmod(syncPath(), 0o000);
    const r = await runCli(["git", "status"], { cwd: root });

    // The whole finding: `Enabled: false` here is a claim about a file
    // nobody read, and it is indistinguishable from git mode genuinely
    // being off.
    expect(r.stdout).not.toContain("Enabled: false");
    expect(r.stdout).toContain("Enabled: unknown");
  });

  it("exits non-zero, because it could not answer the question", async () => {
    await chmod(syncPath(), 0o000);
    const r = await runCli(["git", "status"], { cwd: root });
    expect(r.exitCode).not.toBe(0);
  });

  it("names the file and says unknown is not the same as disabled", async () => {
    await chmod(syncPath(), 0o000);
    const r = await runCli(["git", "status"], { cwd: root });
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain("sync.yaml");
    expect(all).toMatch(/not the same as git mode being disabled/i);
  });

  it("still answers what it genuinely knows", async () => {
    await chmod(syncPath(), 0o000);
    const r = await runCli(["git", "status"], { cwd: root });
    // Computed from the filesystem, not from the unreadable file, so
    // blanking it too would be its own kind of wrong answer.
    expect(r.stdout).toContain("Inside git repo: true");
  });
});

describe("config list on an unreadable sync.yaml", () => {
  it("prints the values when the file reads", async () => {
    const r = await runCli(["config", "list"], { cwd: root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("git.enabled = true");
  });

  it("does not print a blank, which reads as 'not set'", async () => {
    await chmod(syncPath(), 0o000);
    const r = await runCli(["config", "list"], { cwd: root });

    expect(r.stdout).not.toMatch(/^git\.enabled = *$/m);
    expect(r.stdout).toMatch(/git\.enabled = <unreadable/);
  });

  it("agrees with `config get`, which already exits 1 on the same file", async () => {
    await chmod(syncPath(), 0o000);
    const list = await runCli(["config", "list"], { cwd: root });
    const get = await runCli(["config", "get", "git.enabled"], { cwd: root });

    // The two disagreed: `get` exited 1 with a real cause while `list`
    // exited 0 with a blank. A binary that contradicts itself in
    // adjacent subcommands teaches the user to trust neither.
    expect(get.exitCode).not.toBe(0);
    expect(list.exitCode).not.toBe(0);
  });
});

describe("MCP list_views on an unreadable queries.yaml", () => {
  it("returns the views when the file reads", async () => {
    const client = await startMcpClient(root);
    try {
      const result = await client.callTool("list_views", {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text ?? "").toContain("\"id\"");
    } finally {
      await client.close();
    }
  });

  it("does not claim there are none when it could not read the file", async () => {
    await chmod(queriesPath(), 0o000);
    const client = await startMcpClient(root);
    try {
      const result = await client.callTool("list_views", {});
      const body = result.content[0]?.text ?? "";

      // An agent told "no saved views" may offer to recreate the
      // catalog — over the file that holds it.
      expect(body).not.toBe("No saved views configured.");
      expect(result.isError).toBe(true);
      expect(body).toMatch(/not the same as having none/i);
    } finally {
      await client.close();
    }
  });

  it("still reports a genuinely absent file as having no views", async () => {
    await rm(queriesPath());
    const client = await startMcpClient(root);
    try {
      const result = await client.callTool("list_views", {});
      // Absent is a real state and must stay distinguishable from a
      // failure — otherwise the fix trades one wrong answer for another.
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text ?? "").toBe("No saved views configured.");
    } finally {
      await client.close();
    }
  });
});

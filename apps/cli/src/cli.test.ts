import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import type { MockInstance } from "vitest";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./index.js";

describe("CLI entry point", () => {
  it("exports an async main function", () => {
    expect(typeof main).toBe("function");
  });
});

describe("CLI commands", () => {
  let root: string;
  let originalArgv: string[];
  let consoleSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-"));
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("init creates .loctt directory", async () => {
    process.argv = ["node", "loctt", "init"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Initialized"));
  });

  it("info shows tracker state", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "info"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("LocTT directory"));
  });

  it("doctor runs checks", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "doctor"];
    await main();
    expect(consoleSpy).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("create adds a task", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "My first task"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("T-1"));
  });

  it("list shows tasks", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "Task A"];
    await main();
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "list"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Task A"));
  });

  it("help shows usage", async () => {
    process.argv = ["node", "loctt", "help"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("unknown command shows usage with error", async () => {
    process.argv = ["node", "loctt", "bogus"];
    await main();
    expect(process.exitCode).toBe(1);
  });
});

describe("CLI git subcommands", () => {
  let root: string;
  let originalArgv: string[];
  let consoleSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-git-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("git enable enables git mode", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("enabled"));
  });

  it("git status reports state", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "git", "status"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Enabled: true"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Branch: loctt"));
  });

  it("git disable then status shows disabled", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    process.argv = ["node", "loctt", "git", "disable"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "git", "status"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Enabled: false"));
  });

  it("git publish commits to loctt branch", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    process.argv = ["node", "loctt", "create", "Task X"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "git", "publish"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Published"));
    // verify the loctt branch exists
    const out = execSync("git rev-parse --verify loctt", { cwd: root, encoding: "utf-8" });
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it("git sync reports up-to-date when nothing on the branch", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "git", "sync"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("unknown git subcommand sets exitCode=1", async () => {
    process.argv = ["node", "loctt", "git", "bogus"];
    await main();
    expect(process.exitCode).toBe(1);
  });
});

describe("CLI config subcommands", () => {
  let root: string;
  let originalArgv: string[];
  let consoleSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-cfg-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("config get returns default when no sync.yaml", async () => {
    process.argv = ["node", "loctt", "config", "get", "git.remote"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith("origin");
  });

  it("config set + get round-trips after enabling git", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    process.argv = ["node", "loctt", "config", "set", "git.remote", "upstream"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "config", "get", "git.remote"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith("upstream");
  });

  it("config unset resets to default", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    process.argv = ["node", "loctt", "config", "set", "git.auto_push", "false"];
    await main();
    process.argv = ["node", "loctt", "config", "unset", "git.auto_push"];
    await main();
    consoleSpy.mockClear();
    process.argv = ["node", "loctt", "config", "get", "git.auto_push"];
    await main();
    expect(consoleSpy).toHaveBeenCalledWith("true");
  });

  it("config list prints all known keys", async () => {
    process.argv = ["node", "loctt", "config", "list"];
    await main();
    const lines = consoleSpy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => l.startsWith("git.enabled = "))).toBe(true);
    expect(lines.some(l => l.startsWith("git.remote = "))).toBe(true);
    expect(lines.some(l => l.startsWith("git.branch = "))).toBe(true);
    expect(lines.some(l => l.startsWith("git.auto_push = "))).toBe(true);
    expect(lines.some(l => l.startsWith("git.auto_fetch = "))).toBe(true);
  });

  it("config set on unknown key sets exitCode=1", async () => {
    process.argv = ["node", "loctt", "git", "enable"];
    await main();
    process.argv = ["node", "loctt", "config", "set", "bogus.key", "x"];
    await main();
    expect(process.exitCode).toBe(1);
  });

  it("config set without git mode enabled errors cleanly", async () => {
    process.argv = ["node", "loctt", "config", "set", "git.remote", "upstream"];
    await main();
    expect(process.exitCode).toBe(1);
  });

  it("migrate is a no-op when schema is at the current version", async () => {
    process.argv = ["node", "loctt", "migrate"];
    await main();
    const lines = consoleSpy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => /already at v/.test(l))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("migrate --dry-run does not crash on a fresh tracker", async () => {
    // With no migrations registered yet, the planner returns an
    // empty plan and the command short-circuits with "already at v…".
    // Dry-run still must not set exitCode.
    process.argv = ["node", "loctt", "migrate", "--dry-run"];
    await main();
    expect(process.exitCode).toBeUndefined();
  });

  it("info fails fast against a tracker with a too-new schema", async () => {
    // Simulate a tracker created by a future LocTT version.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    process.argv = ["node", "loctt", "info"];
    await main();
    expect(process.exitCode).toBe(1);
  });
});

describe("CLI schema guard exemption for init", () => {
  let root: string;
  let originalArgv: string[];

  beforeEach(async () => {
    // Fresh dir, no .loctt yet — the test exercises init from
    // scratch.
    root = await mkdtemp(join(tmpdir(), "loctt-cli-init-"));
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("init does not trigger the schema guard (works on empty cwd)", async () => {
    process.argv = ["node", "loctt", "init"];
    await main();
    expect(process.exitCode).toBeUndefined();
  });
});

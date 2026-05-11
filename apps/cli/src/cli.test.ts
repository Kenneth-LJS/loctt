import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupByKey, resolveLocttDir } from "@loctt/core";
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

  it("unknown command shows usage with usage-error exit code", async () => {
    process.argv = ["node", "loctt", "bogus"];
    await main();
    // EXIT.USAGE = 2; distinguishes "you typed it wrong" from a
    // runtime/domain error (1).
    expect(process.exitCode).toBe(2);
  });

  it("supports --flag=value form (project create)", async () => {
    process.argv = ["node", "loctt", "init"];
    await main();
    process.exitCode = undefined;
    // `--prefix=Z` form (=value) instead of `--prefix Z` (space-separated).
    // The legacy parser only accepted the space form; the new parser
    // accepts both.
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();
    process.argv = ["node", "loctt", "project", "create", "zeta", "--prefix=ZE", "--label=Zeta"];
    await main();
    if (process.exitCode !== undefined) {
      // Surface the CLI's own error message so a future regression
      // is debuggable from the test output.
      const errs = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      throw new Error(`exit ${String(process.exitCode)}; stderr:\n${errs}`);
    }
  });

  it("--cwd <dir> targets a tracker outside the process cwd, leaving cwd untouched", async () => {
    // Initialise both trackers and the source one (already done in
    // beforeEach for `root`). process.cwd() is mocked to `root`.
    const otherRoot = await mkdtemp(join(tmpdir(), "loctt-cli-cwd-"));
    try {
      await initLoctt(otherRoot);
      process.argv = ["node", "loctt", "init"]; // safe no-op (already inited)
      // First, init root via the CLI so it has a clean baseline too.
      // (beforeEach initialises root via initLoctt directly already.)
      await main();
      process.exitCode = undefined;

      process.argv = ["node", "loctt", "--cwd", otherRoot, "create", "elsewhere"];
      await main();
      expect(process.exitCode).toBeUndefined();

      // Other tracker contains the new task.
      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "--cwd", otherRoot, "list"];
      await main();
      const otherLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(otherLog).toContain("elsewhere");

      // Process cwd's tracker MUST NOT contain it — proves --cwd
      // wasn't silently ignored and the create didn't double-write.
      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "list"];
      await main();
      const cwdLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(cwdLog).not.toContain("elsewhere");
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("usage error from a converted command exits 2 and prints the Usage hint", async () => {
    // `project create` without --prefix is a usage error. Confirms
    // runCommand → UsageError pipeline maps to EXIT.USAGE AND that
    // the hint line is printed (the whole point of UsageError.usage).
    process.argv = ["node", "loctt", "init"];
    await main();
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();
    process.argv = ["node", "loctt", "project", "create", "p"];
    await main();
    expect(process.exitCode).toBe(2);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/missing key or --prefix/);
    expect(stderr).toMatch(/Usage:/);
    expect(stderr).toMatch(/loctt project create/);
  });

  it("--cwd <flag-looking-value> does not silently swallow the next flag", async () => {
    // Regression: `loctt --cwd --help` previously consumed --help as
    // the value of --cwd. Now the next-token-must-not-start-with-dash
    // rule preserves --help.
    process.argv = ["node", "loctt", "--cwd", "--help"];
    await main();
    // --help routes through the help case, which doesn't set exitCode.
    expect(process.exitCode).toBeUndefined();
  });

  it("board-rerank --before actually places the task ahead of the referenced sibling", async () => {
    // Verifying the rank change here — not just the success log — so a
    // future regression that silently no-ops can't slip through.
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "alpha"];
    await main();
    process.argv = ["node", "loctt", "create", "bravo"];
    await main();
    process.argv = ["node", "loctt", "create", "charlie"];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank", "T-3", "--before", "T-1"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("Reranked T-3 on board");

    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    const t3 = await lookupByKey(locttDir, "T-3");
    expect(typeof t3.frontmatter.board_rank).toBe("string");
    // Lexicographic comparison — T-3's rank must sort before T-1's
    // rank after the reorder, because --before places it ahead.
    expect(t3.frontmatter.board_rank).toBeDefined();
    if (t1.frontmatter.board_rank !== undefined) {
      // T-1 had a board_rank assigned (it was created and presumably
      // stamped on create); T-3 must sort before it.
      expect(t3.frontmatter.board_rank! < t1.frontmatter.board_rank).toBe(true);
    }
  });

  it("board-rerank --after places the task behind the referenced sibling", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "alpha"];
    await main();
    process.argv = ["node", "loctt", "create", "bravo"];
    await main();
    process.argv = ["node", "loctt", "create", "charlie"];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank", "T-1", "--after", "T-3"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("Reranked T-1 on board");

    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    const t3 = await lookupByKey(locttDir, "T-3");
    expect(t1.frontmatter.board_rank).toBeDefined();
    if (t3.frontmatter.board_rank !== undefined) {
      expect(t1.frontmatter.board_rank! > t3.frontmatter.board_rank).toBe(true);
    }
  });

  it("board-rerank with no --before/--after moves the task to the end", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "alpha"];
    await main();
    process.argv = ["node", "loctt", "create", "bravo"];
    await main();
    process.argv = ["node", "loctt", "create", "charlie"];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank", "T-1"];
    await main();
    expect(process.exitCode).toBeUndefined();

    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    const t2 = await lookupByKey(locttDir, "T-2");
    const t3 = await lookupByKey(locttDir, "T-3");
    // T-1 must now sort last among the three.
    expect(t1.frontmatter.board_rank).toBeDefined();
    if (
      t2.frontmatter.board_rank !== undefined &&
      t3.frontmatter.board_rank !== undefined
    ) {
      expect(t1.frontmatter.board_rank! > t2.frontmatter.board_rank).toBe(true);
      expect(t1.frontmatter.board_rank! > t3.frontmatter.board_rank).toBe(true);
    }
  });

  it("board-rerank rejects --before and --after together", async () => {
    await initLoctt(root);
    process.argv = ["node", "loctt", "create", "alpha"];
    await main();
    process.argv = ["node", "loctt", "create", "bravo"];
    await main();
    process.argv = ["node", "loctt", "create", "charlie"];
    await main();
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank", "T-3", "--before", "T-1", "--after", "T-2"];
    await main();
    expect(process.exitCode).toBe(2);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/mutually exclusive/);
  });

  it("board-rerank exits cleanly when the task ref does not resolve", async () => {
    // Regression for TaskNotFoundError leaking past runCommand. Before
    // the whitelist gained TaskNotFoundError, this case threw an
    // uncaught exception and exited with a stack trace. Now it prints
    // a clean Error line and exits with the runtime exit code.
    await initLoctt(root);
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank", "T-999"];
    await main();
    // EXIT.RUNTIME = 1
    expect(process.exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/Error:/);
    // Implementation detail of TaskNotFoundError, but pinning the user
    // visible reference helps with debugging.
    expect(stderr).toMatch(/T-999/);
  });

  it("board-rerank requires the task argument", async () => {
    await initLoctt(root);
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "board-rerank"];
    await main();
    expect(process.exitCode).toBe(2);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/missing task/);
    expect(stderr).toMatch(/Usage:/);
  });

  it("preserves an empty-string flag value (--set '')", async () => {
    // Regression for the mri auto-coercion bug: --set "" must not
    // become 0 or be treated as missing.
    process.argv = ["node", "loctt", "init"];
    await main();
    process.exitCode = undefined;
    process.argv = ["node", "loctt", "create", "doomed"];
    await main();
    process.exitCode = undefined;
    process.argv = ["node", "loctt", "body", "T-1", "--set", ""];
    await main();
    expect(process.exitCode).toBeUndefined();
    process.exitCode = undefined;
    process.argv = ["node", "loctt", "body", "T-1"];
    consoleSpy.mockClear();
    await main();
    const logged = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    // The body was set to empty (not "0"), so the read prints the
    // empty-body sentinel.
    expect(logged).toContain("(empty body)");
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

  it("unknown git subcommand sets a usage-error exit code", async () => {
    process.argv = ["node", "loctt", "git", "bogus"];
    await main();
    expect(process.exitCode).toBe(2);
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

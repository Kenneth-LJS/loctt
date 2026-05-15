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

  it("create honors the per-user default_project when --project is omitted", async () => {
    // Init creates one project ("task") and a default user. Add a
    // second project so resolution is genuinely ambiguous without a
    // default. Set the per-user default_project to the second one
    // and confirm `create` uses it instead of the workspace default.
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    const { createProject, getCurrentUser, saveUserSettings } = await import("@loctt/core");
    await createProject(locttDir, { key: "alpha", label: "Alpha", prefix: "A-" });
    const current = await getCurrentUser(locttDir);
    if (!current) throw new Error("test setup: no current user");
    await saveUserSettings(locttDir, current.id, { default_project: "alpha" });

    process.argv = ["node", "loctt", "create", "user-defaulted"];
    process.exitCode = undefined;
    consoleSpy.mockClear();
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("A-1");
  });

  it("create with --project explicit wins over per-user default", async () => {
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    const { createProject, getCurrentUser, saveUserSettings } = await import("@loctt/core");
    await createProject(locttDir, { key: "alpha", label: "Alpha", prefix: "A-" });
    const current = await getCurrentUser(locttDir);
    if (!current) throw new Error("test setup: no current user");
    await saveUserSettings(locttDir, current.id, { default_project: "alpha" });

    process.argv = ["node", "loctt", "create", "explicit-wins", "--project", "task"];
    process.exitCode = undefined;
    consoleSpy.mockClear();
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    // workspace default prefix is "T-"
    expect(log).toContain("T-1");
  });

  it("create falls through when per-user default_project points at a non-existent project", async () => {
    // Stale per-user default — the resolution chain documents that
    // we ignore it and fall through to workspace default.
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    const { getCurrentUser, saveUserSettings } = await import("@loctt/core");
    const current = await getCurrentUser(locttDir);
    if (!current) throw new Error("test setup: no current user");
    await saveUserSettings(locttDir, current.id, { default_project: "ghost" });

    process.argv = ["node", "loctt", "create", "stale-fallback"];
    process.exitCode = undefined;
    consoleSpy.mockClear();
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("T-1");
  });

  it("sprint burndown prints a table by default", async () => {
    await initLoctt(root);
    process.argv = [
      "node", "loctt", "sprint", "create", "s1",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "s1"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("Sprint:");
    expect(log).toContain("s1");
    expect(log).toContain("2026-05-04");
    expect(log).toContain("Remaining");
    // Ideal column header is part of the table.
    expect(log).toContain("Ideal");
  });

  it("sprint burndown --format json emits a parseable payload", async () => {
    await initLoctt(root);
    process.argv = [
      "node", "loctt", "sprint", "create", "s1",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "s1", "--format", "json"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    const payload = JSON.parse(log) as {
      sprintKey: string;
      series: { date: string; remaining: number }[];
      ideal: unknown[];
    };
    expect(payload.sprintKey).toBe("s1");
    expect(payload.series.length).toBe(5);
    expect(payload.series[0]?.date).toBe("2026-05-04");
    expect(payload.ideal.length).toBe(5);
  });

  it("sprint burndown exits cleanly when the key does not resolve", async () => {
    await initLoctt(root);
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "nonexistent"];
    await main();
    expect(process.exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/unknown sprint: nonexistent/);
  });

  it("sprint burndown rejects an unknown --format", async () => {
    await initLoctt(root);
    process.argv = [
      "node", "loctt", "sprint", "create", "s1",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "s1", "--format", "html"];
    await main();
    expect(process.exitCode).toBe(2);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/--format must be one of/);
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

  describe("error paths on wrapped task commands", () => {
    // Regression tests for the runCommand-wrapping fix: domain errors
    // from the listed commands must surface as `Error: ...` to stderr
    // and exit EXIT.RUNTIME (1), not bubble as stack traces.

    async function expectCleanRuntimeError(argv: string[], match: RegExp): Promise<void> {
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = argv;
      await main();
      expect(process.exitCode).toBe(1);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(match);
      // No raw stack trace leaked through.
      expect(stderr).not.toMatch(/\s+at /);
    }

    it("show on missing task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "show", "T-999"],
        /Error:.*T-999/i,
      );
    });

    it("set on missing task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "set", "T-999", "priority", "high"],
        /Error:.*T-999/i,
      );
    });

    it("unset on missing task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "unset", "T-999", "priority"],
        /Error:.*T-999/i,
      );
    });

    it("link on missing source task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "real"];
      await main();
      await expectCleanRuntimeError(
        ["node", "loctt", "link", "T-999", "blocks", "T-1"],
        /Error:.*T-999/i,
      );
    });

    it("unlink on missing source task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "real"];
      await main();
      await expectCleanRuntimeError(
        ["node", "loctt", "unlink", "T-999", "blocks", "T-1"],
        /Error:.*T-999/i,
      );
    });

    it("archive on missing task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "archive", "T-999"],
        /Error:.*T-999/i,
      );
    });

    it("unarchive on missing task surfaces a clean runtime error", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "unarchive", "T-999"],
        /Error:.*T-999/i,
      );
    });

    it("body / log / delete on missing task surface clean runtime errors", async () => {
      await initLoctt(root);
      await expectCleanRuntimeError(
        ["node", "loctt", "body", "T-999"],
        /Error:.*T-999/i,
      );
      await expectCleanRuntimeError(
        ["node", "loctt", "log", "T-999"],
        /Error:.*T-999/i,
      );
      // delete needs --yes to skip the interactive prompt; the
      // lookup runs before the prompt so the not-found error still
      // surfaces cleanly.
      await expectCleanRuntimeError(
        ["node", "loctt", "delete", "T-999", "--yes"],
        /Error:.*T-999/i,
      );
    });

    it("attach with --force missing prints 'use --force to overwrite' hint", async () => {
      const { writeFile } = await import("node:fs/promises");
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "real"];
      await main();
      // Place a small file to attach.
      const src = join(root, "payload.txt");
      await writeFile(src, "hello", "utf-8");
      // First attach succeeds.
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "attach", "T-1", src];
      await main();
      expect(process.exitCode).toBeUndefined();
      // Second attach without --force triggers the augmented hint.
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "attach", "T-1", src];
      await main();
      expect(process.exitCode).toBe(1);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/use --force to overwrite/i);
    });

    it("missing args on wrapped commands print Usage and exit 2", async () => {
      // Confirms the usage-error path inside runCommand still routes
      // through EXIT.USAGE for every wrapped command.
      await initLoctt(root);
      for (const argv of [
        ["node", "loctt", "show"],
        ["node", "loctt", "set", "T-1"],
        ["node", "loctt", "unset"],
        ["node", "loctt", "link", "T-1"],
        ["node", "loctt", "unlink", "T-1"],
        ["node", "loctt", "archive"],
        ["node", "loctt", "unarchive"],
        ["node", "loctt", "create"],
        ["node", "loctt", "body"],
        ["node", "loctt", "log"],
        ["node", "loctt", "delete"],
        ["node", "loctt", "attach"],
      ]) {
        const errSpy = vi.mocked(console.error);
        errSpy.mockClear();
        process.exitCode = undefined;
        process.argv = argv;
        await main();
        expect(process.exitCode, `argv=${argv.join(" ")}`).toBe(2);
        const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
        expect(stderr).toMatch(/^Error:/m);
        expect(stderr).toMatch(/^Usage:/m);
      }
    });

    it("single-dash long-form (`-project`) is rejected; only `--project` is accepted", async () => {
      // LocTT defines no short flags, so `-project` was always a
      // typo for `--project`. The old parser silently accepted it;
      // the new parser ignores the single-dash form. End result:
      // the value isn't picked up, so a command needing it falls
      // through to its usage error.
      await initLoctt(root);
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      // `loctt create "foo" -project task` — the `-project task`
      // tokens are now treated as positional / ignored, so the
      // command itself still runs against the default project.
      // The point is just that single-dash isn't recognized; it's
      // not a hard error, just silently inert.
      process.argv = ["node", "loctt", "create", "task with single-dash flag", "-project", "task"];
      await main();
      // The command succeeded against the default project — the
      // single-dash form didn't match a flag, so it was treated as
      // (ignored) garbage in the trailing args.
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("CLI flag handling edge cases", () => {
    it("body --set and --append are mutually exclusive (exit 2)", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "body", "T-1", "--set", "x", "--append", "y"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/mutually exclusive/);
    });

    it("body --set with empty string is treated as set-to-empty (not omitted)", async () => {
      // Regression for the rolled-our-own arg parser: empty-string
      // values must survive as `""` rather than being coerced or
      // treated as missing.
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const consoleSpy = vi.mocked(console.log);
      consoleSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "body", "T-1", "--set", ""];
      await main();
      expect(process.exitCode).toBeUndefined();
      const stdout = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stdout).toMatch(/Updated body for T-1/);
    });

    it("log --limit rejects non-integer values (exit 2)", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "log", "T-1", "--limit", "abc"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/--limit must be a non-negative integer/);
    });

    it("log --limit=-3 rejects negative values (exit 2)", async () => {
      // Use `=` form to pass a negative number; the bare-arg form
      // (`--limit -3`) treats `-3` as a flag, not as the value,
      // which is consistent with how getArg refuses to swallow
      // anything starting with `-` as a value.
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "log", "T-1", "--limit=-3"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/--limit must be a non-negative integer/);
    });

    it("log --limit=0 returns no entries but is not an error", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const consoleSpy = vi.mocked(console.log);
      consoleSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "log", "T-1", "--limit", "0"];
      await main();
      expect(process.exitCode).toBeUndefined();
      const stdout = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stdout).toMatch(/No history entries/);
    });
  });

  describe("CLI enum pre-validation against workflow config", () => {
    // Regression tests for the assertWorkflowEnumKey / ...Relationship
    // helpers: unknown workflow keys fail at the CLI boundary with a
    // friendly "Known: ..." hint instead of bubbling from core.

    it("create --status with an unknown key prints a Known list and exits 2", async () => {
      await initLoctt(root);
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "create", "t", "--status", "nope"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown status 'nope'/);
      expect(stderr).toMatch(/Known:/);
    });

    it("create --priority with an unknown key exits 2 with hint", async () => {
      await initLoctt(root);
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "create", "t", "--priority", "nope"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown priority 'nope'/);
    });

    it("create --type with an unknown key exits 2 with hint", async () => {
      await initLoctt(root);
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "create", "t", "--type", "nope"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown task_type 'nope'/);
    });

    it("set <task> status with an unknown key exits 2 with hint", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "real"];
      await main();
      process.exitCode = undefined;
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.argv = ["node", "loctt", "set", "T-1", "status", "nope"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown status 'nope'/);
    });

    it("link with an unknown relationship key exits 2 with hint", async () => {
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "a"];
      await main();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "create", "b"];
      await main();
      process.exitCode = undefined;
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.argv = ["node", "loctt", "link", "T-1", "noSuchRel", "T-2"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown relationship 'noSuchRel'/);
    });

    it("set <task> status with a valid key succeeds (sanity)", async () => {
      // Guards against the pre-validation accidentally rejecting
      // legitimate values.
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "real"];
      await main();
      process.exitCode = undefined;
      // 'in_progress' is in the default workflow's statuses.
      process.argv = ["node", "loctt", "set", "T-1", "status", "in_progress"];
      await main();
      expect(process.exitCode).toBeUndefined();
    });
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

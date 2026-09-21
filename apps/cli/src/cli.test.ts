import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupByKey, resolveLocttDir, serializeQueriesConfig } from "@loctt/core";
import type { MockInstance } from "vitest";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./index.js";

/**
 * Captures what a confirm prompt actually asked. ESM will not let us
 * spy on `createInterface` after the fact, so the module is mocked;
 * `promptAnswer` drives the reply and `promptQuestion` records the
 * question a test wants to assert on.
 */
let promptQuestion = "";
let promptAnswer = "n";
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: (q: string) => {
      promptQuestion = q;
      return Promise.resolve(promptAnswer);
    },
    close: () => {},
  }),
}));

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

  const initOutput = (): string =>
    consoleSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");

  it("init prints a Next steps block guiding a first-time user", async () => {
    process.argv = ["node", "loctt", "init"];
    await main();
    const out = initOutput();
    expect(out).toContain("Next steps:");
    // The three orientations a cold user needs.
    expect(out).toContain("loctt create");
    expect(out).toContain("loctt ui");
    expect(out).toContain(".loctt/docs/");
  });

  it("init --no-docs omits the docs line from Next steps", async () => {
    process.argv = ["node", "loctt", "init", "--no-docs"];
    await main();
    const out = initOutput();
    expect(out).toContain("Next steps:");
    expect(out).not.toContain(".loctt/docs/");
  });

  it("init --quiet prints neither the summary nor the Next steps block", async () => {
    process.argv = ["node", "loctt", "init", "--quiet"];
    await main();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("init --json prints a machine-readable summary and no Next steps block", async () => {
    process.argv = ["node", "loctt", "init", "--json"];
    await main();
    const out = initOutput();
    expect(out).not.toContain("Next steps:");
    const parsed = JSON.parse(out) as { created: string[]; locttDir: string; repaired: boolean };
    expect(parsed.repaired).toBe(false);
    expect(Array.isArray(parsed.created)).toBe(true);
    expect(parsed.locttDir).toContain(".loctt");
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

  it("refuses a flag where a name belongs, rather than naming a project --name", async () => {
    process.argv = ["node", "loctt", "init"];
    await main();
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    // `--name` is a real flag of `project rename`, so it is in the
    // accepted list and sails past `rejectUnknownFlags` — then
    // `args[2]` ate it as the positional. This created a project
    // literally called `--name`, discarded "Second", and exited 0.
    // Found by the M1 round-8 gate in passing.
    process.argv = [
      "node", "loctt", "project", "create", "--name", "Second", "--prefix", "SEC",
    ];
    await main();
    expect(process.exitCode).toBe(2);
    const errs = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(errs).toMatch(/got the flag --name/);
    process.exitCode = undefined;

    // And the escape hatch the message promises actually works — an
    // earlier cut returned undefined for `--`, so the documented way
    // to name something `--weird` produced a usage error.
    errSpy.mockClear();
    process.argv = ["node", "loctt", "label", "create", "--", "--weird"];
    await main();
    expect(process.exitCode).toBeUndefined();
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
    // `--label` was here and is not a flag project create accepts — it
    // was silently discarded, which is the bug PRU-C9 names. The
    // subject of this test is the `=value` form, so it uses a flag the
    // command actually reads.
    process.argv = ["node", "loctt", "project", "create", "zeta", "--prefix=ZE"];
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

  it("--root <dir> targets a tracker outside the process cwd (canonical alias of --cwd)", async () => {
    // CLI-1: --root is the canonical name; it must target another tracker
    // exactly as --cwd does. Mirrors the --cwd test above.
    const otherRoot = await mkdtemp(join(tmpdir(), "loctt-cli-root-"));
    try {
      await initLoctt(otherRoot);
      process.argv = ["node", "loctt", "--root", otherRoot, "create", "rooted"];
      await main();
      expect(process.exitCode).toBeUndefined();

      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "--root", otherRoot, "list"];
      await main();
      const otherLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(otherLog).toContain("rooted");

      // The process-cwd tracker must NOT contain it — proves --root was
      // honoured and not silently ignored.
      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "list"];
      await main();
      const cwdLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(cwdLog).not.toContain("rooted");
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("LOCTT_ROOT env targets a tracker when no flag is given", async () => {
    // CLI-1: LOCTT_ROOT is accepted as a fallback below an explicit flag.
    const otherRoot = await mkdtemp(join(tmpdir(), "loctt-cli-env-"));
    const prevEnv = process.env["LOCTT_ROOT"];
    try {
      await initLoctt(otherRoot);
      process.env["LOCTT_ROOT"] = otherRoot;

      process.argv = ["node", "loctt", "create", "fromenv"];
      await main();
      expect(process.exitCode).toBeUndefined();

      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "list"];
      await main();
      const envLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(envLog).toContain("fromenv");

      // An explicit flag overrides the env var (flag > env precedence).
      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "--root", root, "list"];
      await main();
      const flagLog = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(flagLog).not.toContain("fromenv");
    } finally {
      if (prevEnv === undefined) delete process.env["LOCTT_ROOT"];
      else process.env["LOCTT_ROOT"] = prevEnv;
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("--root and --cwd given together with different values errors clearly", async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), "loctt-cli-both-"));
    const errSpy = vi.mocked(console.error);
    try {
      await initLoctt(otherRoot);
      errSpy.mockClear();
      process.argv = ["node", "loctt", "--root", root, "--cwd", otherRoot, "list"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/--root.*--cwd|--cwd.*--root/);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("--root and --cwd given together with the SAME value is accepted", async () => {
    // Consistent duplicates are not an error — only a conflict is.
    const otherRoot = await mkdtemp(join(tmpdir(), "loctt-cli-same-"));
    try {
      await initLoctt(otherRoot);
      process.exitCode = undefined;
      consoleSpy.mockClear();
      process.argv = ["node", "loctt", "--root", otherRoot, "--cwd", otherRoot, "list"];
      await main();
      expect(process.exitCode).toBeUndefined();
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
    expect(stderr).toMatch(/missing name or --prefix/);
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

  // @verifies K11
  it("board-move --status writes status AND board_rank in one change set", async () => {
    // K11: the CLI could not express a cross-column move at all. Two
    // commands (`set status` then `board-rerank`) is the non-atomicity
    // `boardMove` exists to fix, so the assertion is that BOTH fields
    // landed from ONE invocation — not that the command printed.
    await initLoctt(root);
    for (const t of ["alpha", "bravo", "charlie"]) {
      process.argv = ["node", "loctt", "create", t];
      await main();
    }
    const locttDir = resolveLocttDir(root);
    // An anchor already in the DESTINATION column. `boardMove`
    // validates anchors against the column being moved *to* (BRD-35),
    // so a backlog neighbour is correctly refused for an in_progress
    // drop — measured.
    process.argv = ["node", "loctt", "board-move", "T-1", "--status", "in_progress"];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    const beforeMove = await lookupByKey(locttDir, "T-3");
    expect(beforeMove.frontmatter.status).not.toBe("in_progress");

    process.argv = [
      "node", "loctt", "board-move", "T-3",
      "--status", "in_progress", "--before", "T-1",
    ];
    await main();
    expect(process.exitCode).toBeUndefined();

    const t1 = await lookupByKey(locttDir, "T-1");
    const t3 = await lookupByKey(locttDir, "T-3");
    // The status half.
    expect(t3.frontmatter.status).toBe("in_progress");
    // The rank half, from the same single write: --before places it
    // ahead of T-1 in the destination column's sequence.
    expect(t3.frontmatter.board_rank).toBeDefined();
    expect(t1.frontmatter.board_rank).toBeDefined();
    expect(t3.frontmatter.board_rank! < t1.frontmatter.board_rank!).toBe(true);
  });

  // @verifies K11
  it("board-move without --status leaves status untouched", async () => {
    // XS-9's rule, now reachable from the CLI: an intra-column
    // reposition must not resend `status`. If `--status` defaulted to
    // anything, or the command always wrote the field, this rewrites it.
    await initLoctt(root);
    for (const t of ["alpha", "bravo", "charlie"]) {
      process.argv = ["node", "loctt", "create", t];
      await main();
    }
    const locttDir = resolveLocttDir(root);
    process.argv = ["node", "loctt", "set", "T-3", "status", "in_progress"];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    // Unanchored: appends to the end of T-3's own column. Anchors are
    // beside the point here — the claim under test is about `status`.
    process.argv = ["node", "loctt", "board-move", "T-3"];
    await main();
    expect(process.exitCode).toBeUndefined();

    const t3 = await lookupByKey(locttDir, "T-3");
    expect(t3.frontmatter.status).toBe("in_progress");
    expect(t3.frontmatter.board_rank).toBeDefined();
  });

  // @verifies K11
  it("board-move accepts --before and --after together", async () => {
    // The one place this command deliberately differs from
    // `board-rerank`, whose mutex exits 2 on the same pair. A drop
    // lands BETWEEN two neighbours (BRD-32), so the pair is the
    // position, and the rank must land strictly between theirs.
    await initLoctt(root);
    for (const t of ["alpha", "bravo", "charlie"]) {
      process.argv = ["node", "loctt", "create", t];
      await main();
    }
    const locttDir = resolveLocttDir(root);
    // Give T-1 and T-2 real ranks in their shared column, ascending.
    process.argv = ["node", "loctt", "board-rerank", "T-1"];
    await main();
    process.argv = ["node", "loctt", "board-rerank", "T-2"];
    await main();
    process.exitCode = undefined;

    const t1before = await lookupByKey(locttDir, "T-1");
    const t2before = await lookupByKey(locttDir, "T-2");
    expect(t1before.frontmatter.board_rank! < t2before.frontmatter.board_rank!).toBe(true);

    process.argv = [
      "node", "loctt", "board-move", "T-3", "--after", "T-1", "--before", "T-2",
    ];
    await main();
    // Not a usage error — `board-rerank` with the same flags exits 2.
    expect(process.exitCode).toBeUndefined();

    const t3 = await lookupByKey(locttDir, "T-3");
    // Interpolated strictly between the pair, not appended past both.
    expect(t3.frontmatter.board_rank! > t1before.frontmatter.board_rank!).toBe(true);
    expect(t3.frontmatter.board_rank! < t2before.frontmatter.board_rank!).toBe(true);
  });

  // @verifies K11
  it("board-move requires the task argument", async () => {
    await initLoctt(root);
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();
    process.argv = ["node", "loctt", "board-move"];
    await main();
    expect(process.exitCode).toBe(2);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/missing task/);
    expect(stderr).toMatch(/loctt board-move/);
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
    const alpha = await createProject(locttDir, { name: "Alpha", prefix: "A" });
    const current = await getCurrentUser(locttDir);
    if (!current) throw new Error("test setup: no current user");
    await saveUserSettings(locttDir, current.id, { default_project: alpha.id });

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
    const alpha = await createProject(locttDir, { name: "Alpha", prefix: "A" });
    const current = await getCurrentUser(locttDir);
    if (!current) throw new Error("test setup: no current user");
    await saveUserSettings(locttDir, current.id, { default_project: alpha.id });

    process.argv = ["node", "loctt", "create", "explicit-wins", "--project", "Tasks"];
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
      "node", "loctt", "sprint", "create", "Sprint One",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "Sprint One"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(log).toContain("Sprint:");
    expect(log).toContain("2026-05-04");
    expect(log).toContain("Remaining");
    expect(log).toContain("Ideal");
  });

  it("sprint burndown --format json emits a parseable payload", async () => {
    await initLoctt(root);
    process.argv = [
      "node", "loctt", "sprint", "create", "Sprint One",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    consoleSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "Sprint One", "--format", "json"];
    await main();
    expect(process.exitCode).toBeUndefined();
    const log = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    const payload = JSON.parse(log) as {
      sprintId: string;
      series: { date: string; remaining: number }[];
      ideal: unknown[];
    };
    expect(payload.sprintId).toMatch(/^[0-9A-Z]{26}$/);
    expect(payload.series.length).toBe(5);
    expect(payload.series[0]?.date).toBe("2026-05-04");
    expect(payload.ideal.length).toBe(5);
  });

  it("sprint burndown exits cleanly when the name does not resolve", async () => {
    await initLoctt(root);
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "Nonexistent"];
    await main();
    expect(process.exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(stderr).toMatch(/unknown sprint/);
  });

  it("sprint burndown rejects an unknown --format", async () => {
    await initLoctt(root);
    process.argv = [
      "node", "loctt", "sprint", "create", "Sprint One",
      "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active",
    ];
    await main();
    process.exitCode = undefined;
    const errSpy = vi.mocked(console.error);
    errSpy.mockClear();

    process.argv = ["node", "loctt", "sprint", "burndown", "Sprint One", "--format", "html"];
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
    it("init rejects the removed --project-key (exit 2)", async () => {
      // Removing a flag from the parser is not enough on its own: the
      // parser ignores what it doesn't recognize, so a script still
      // passing --project-key would exit 0 while silently doing
      // something other than what it says.
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "init", "--project-key", "bugs"];
      await main();
      expect(process.exitCode).toBe(2);
      const stderr = errSpy.mock.calls.map(c => String(c[0])).join("\n");
      expect(stderr).toMatch(/unknown option --project-key/);
      // The message must name what is accepted, or the user has to go
      // read the docs that told them to pass the flag in the first place.
      expect(stderr).toMatch(/--project-label/);
    });

    it("init still accepts every documented flag", async () => {
      process.exitCode = undefined;
      process.argv = [
        "node", "loctt", "init",
        "--prefix", "BUG",
        "--project-label", "Bug tracker",
        "--timezone", "UTC",
        "--no-docs",
      ];
      await main();
      expect(process.exitCode).toBeUndefined();
    });

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

    it("list --limit rejects a negative value the same way log does", async () => {
      // `list` and `log` carried byte-identical --limit validation in
      // one file, now shared. Only `log` was covered, so extracting
      // the helper would have left half of it unguarded — and the two
      // drifting apart is exactly what the duplication risked.
      await initLoctt(root);
      process.argv = ["node", "loctt", "create", "t"];
      await main();
      const errSpy = vi.mocked(console.error);
      errSpy.mockClear();
      process.exitCode = undefined;
      process.argv = ["node", "loctt", "list", "--limit=-3"];
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

  it("info reports a too-new schema rather than refusing to run", async () => {
    // Simulate a tracker created by a future LocTT version.
    //
    // This test asserted exit 1 — info was blocked by the boot guard
    // like any write command. ONB-C5 requires the opposite: info's job
    // is to describe the tracker, and the schema mismatch is one of the
    // things worth describing. Refusing meant the command that answers
    // "what is this tracker" could not answer precisely when it
    // mattered. It is read-only, so reporting costs nothing that
    // refusing was protecting.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation(m => { logs.push(String(m)); });
    try {
      process.argv = ["node", "loctt", "info"];
      await main();
    } finally {
      spy.mockRestore();
    }
    expect(process.exitCode).toBeUndefined();
    expect(logs.join("\n")).toMatch(/999/);
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

describe("CLI list — stale saved view warning", () => {
  let root: string;
  let originalArgv: string[];
  let logSpy: MockInstance;
  let errSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-warn-"));
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await initLoctt(root);
    // A view referencing a custom field that doesn't exist — the
    // shape a tracker ends up in after the field is deleted.
    // K102: a saved view stores an ordered `filters[]` list, not a `query`
    // DSL string or a derived `conditions` tree. A single advanced filter
    // carrying the stale DSL reaches the same unknown-custom-field warning.
    await writeFile(
      join(root, ".loctt", "config", "queries.yaml"),
      serializeQueriesConfig({
        queries: [
          {
            id: "01HSV0000000000000STALE3",
            name: "stale",
            filters: [{ kind: "advanced", query: "fields.deleted_field = x" }],
          },
        ],
      }),
      "utf-8",
    );
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  // The view still runs (breaking existing trackers would be worse),
  // but silently returning fewer results reads as "nothing matches".
  it("warns on stderr and still runs the view", async () => {
    process.argv = ["node", "loctt", "list", "--view", "stale"];
    await main();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unknown custom field"));
    expect(logSpy).toHaveBeenCalledWith("No tasks found.");
    // Warning is advisory, not a failure.
    expect(process.exitCode).toBeUndefined();
  });

  it("does not warn for a healthy view", async () => {
    await writeFile(
      join(root, ".loctt", "config", "queries.yaml"),
      "queries:\n"
      + "  - id: 01HSV0000000000000FINE01\n"
      + "    name: fine\n"
      + "    filters:\n"
      + "      - kind: advanced\n"
      + "        query: status != done\n",
      "utf-8",
    );
    process.argv = ["node", "loctt", "list", "--view", "fine"];
    await main();
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("Warning:"));
  });
});

/**
 * @verifies PRU-C10, PRU-C11
 *
 * `loctt project set-prefix`. The core rewrite is covered in
 * packages/core/src/projects/prefix.test.ts; these cover the CLI's own
 * contract — the confirmation, the blast radius it states, and the exit
 * codes a script depends on.
 */
describe("project set-prefix", () => {
  let root: string;
  let originalArgv: string[];
  let logSpy: MockInstance;
  let errSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-setprefix-"));
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await initLoctt(root);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function seed(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      process.argv = ["node", "loctt", "create", `task ${i}`];
      await main();
    }
    logSpy.mockClear();
  }

  it("renames every task, preserving numbers", async () => {
    await seed(3);
    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks", "WEB", "--yes"];
    await main();

    const locttDir = resolveLocttDir(root);
    // Old key still resolves, and resolves to the renamed task — the
    // whole point of keeping key_history.
    const t2 = await lookupByKey(locttDir, "T-2");
    expect(t2.frontmatter.key).toBe("WEB-2");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Renamed 3 task(s)"));
    expect(process.exitCode).toBeUndefined();
  });

  it("states the blast radius in numbers before doing it", async () => {
    await seed(3);
    // Drive the real prompt: PRU-C10 requires the confirmation to name
    // how many tasks will be renamed, so the question text is the
    // subject here, not the refusal. Answering "n" leaves the tracker
    // untouched.
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    promptAnswer = "n";
    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks", "WEB"];
    await main();

    // The count, both prefixes, and the promise that old keys survive.
    expect(promptQuestion).toContain("3 task(s)");
    expect(promptQuestion).toContain("T");
    expect(promptQuestion).toContain("WEB");
    expect(promptQuestion).toContain("key_history");

    // Declining is a clean exit, and nothing was renamed.
    expect(process.exitCode).toBe(0);
    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    expect(t1.frontmatter.key).toBe("T-1");
  });

  it("refuses without --yes when not a TTY, rather than renaming unasked", async () => {
    await seed(2);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks", "WEB"];
    await main();

    // USAGE, not SUCCESS: the script forgot the flag. A script that
    // read this as success would think the rename happened.
    expect(process.exitCode).toBe(2);
    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    expect(t1.frontmatter.key).toBe("T-1");
  });

  it("rejects a prefix another project holds, and renames nothing", async () => {
    await seed(2);
    process.argv = ["node", "loctt", "project", "create", "API", "--prefix", "API"];
    await main();

    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks", "API", "--yes"];
    await main();

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("API"));
    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    expect(t1.frontmatter.key).toBe("T-1");
  });

  it("treats a project's own prefix as a no-op, not a collision", async () => {
    await seed(1);
    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks", "T", "--yes"];
    await main();

    // Succeeds. Reporting this as a collision would be wrong — the
    // prefix is not in use by *another* project.
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("already uses prefix"));
    const locttDir = resolveLocttDir(root);
    const t1 = await lookupByKey(locttDir, "T-1");
    expect(t1.frontmatter.key_history).toBeUndefined();
  });

  it("is a usage error without a prefix argument", async () => {
    process.argv = ["node", "loctt", "project", "set-prefix", "Tasks"];
    await main();
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("set-prefix"));
  });
});

/**
 * @verifies K107 — the `--archived <active|archived|all>` scope on the
 * config-entity list commands (milestone, sprint, label, project, user,
 * views).
 *
 * Default (no flag) is `active` and HIDES archived — a behavior change:
 * before K107 these lists took `--all` to reveal archived and the views
 * list always showed archived inline. `--archived archived` shows only
 * archived; `--archived all` (and the deprecated `--all` alias) shows
 * both. Filtering goes through core's `applyArchivedScope` and the flag
 * through `parseArchivedScope`. Driven through `main()` — the same path a
 * user's shell hits.
 */
describe("config-entity list archived scope (K107)", () => {
  let root: string;
  let originalArgv: string[];
  let logSpy: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-k107-"));
    originalArgv = process.argv;
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await initLoctt(root);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const run = async (...argv: string[]): Promise<string> => {
    logSpy.mockClear();
    process.argv = ["node", "loctt", ...argv];
    await main();
    return logSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");
  };

  // entity -> [create argv builder, archive argv builder, list argv]
  const cases: Array<{
    label: string;
    create: (name: string) => string[];
    archive: (name: string) => string[];
    list: string[];
  }> = [
    {
      label: "milestone",
      create: n => ["milestone", "create", n],
      archive: n => ["milestone", "archive", n],
      list: ["milestone", "list"],
    },
    {
      label: "sprint",
      create: n => ["sprint", "create", n, "--start", "2026-01-01", "--end", "2026-01-14"],
      archive: n => ["sprint", "archive", n],
      list: ["sprint", "list"],
    },
    {
      label: "label",
      create: n => ["label", "create", n],
      archive: n => ["label", "archive", n],
      list: ["label", "list"],
    },
    {
      label: "user",
      // A freshly created user is not the active user, so it can be archived.
      create: n => ["user", "create", n],
      archive: n => ["user", "archive", n],
      list: ["user", "list"],
    },
  ];

  for (const c of cases) {
    it(`${c.label} list defaults to active and honors --archived archived|all|--all`, async () => {
      await run(...c.create("KeepMe"));
      await run(...c.create("GoneAway"));
      await run(...c.archive("GoneAway"));

      // Default: archived hidden.
      const active = await run(...c.list);
      expect(active).toContain("KeepMe");
      expect(active).not.toContain("GoneAway");

      // Only archived.
      const onlyArchived = await run(...c.list, "--archived", "archived");
      expect(onlyArchived).toContain("GoneAway");
      expect(onlyArchived).not.toContain("KeepMe");

      // Both, via the tri-state value.
      const all = await run(...c.list, "--archived", "all");
      expect(all).toContain("KeepMe");
      expect(all).toContain("GoneAway");

      // Both, via the deprecated --all alias.
      const alias = await run(...c.list, "--all");
      expect(alias).toContain("KeepMe");
      expect(alias).toContain("GoneAway");
    });
  }

  it("project list defaults to active and honors --archived archived|all|--all", async () => {
    // initLoctt seeds the "Tasks" project; add + archive a second one.
    await run("project", "create", "KeepProj", "--prefix", "KEP");
    await run("project", "create", "GoneProj", "--prefix", "GON");
    await run("project", "archive", "GoneProj");

    const active = await run("project", "list");
    expect(active).toContain("KeepProj");
    expect(active).not.toContain("GoneProj");

    const onlyArchived = await run("project", "list", "--archived", "archived");
    expect(onlyArchived).toContain("GoneProj");
    expect(onlyArchived).not.toContain("KeepProj");

    const all = await run("project", "list", "--archived", "all");
    expect(all).toContain("KeepProj");
    expect(all).toContain("GoneProj");

    const alias = await run("project", "list", "--all");
    expect(alias).toContain("GoneProj");
  });

  it("views list defaults to active and honors --archived archived|all", async () => {
    await run("views", "create", "keep-view", "--query", "status = backlog");
    await run("views", "create", "gone-view", "--query", "status = done");
    await run("views", "archive", "gone-view");

    const active = await run("views", "list");
    expect(active).toContain("keep-view");
    expect(active).not.toContain("gone-view");

    const onlyArchived = await run("views", "list", "--archived", "archived");
    expect(onlyArchived).toContain("gone-view");
    expect(onlyArchived).not.toContain("keep-view");

    const all = await run("views", "list", "--archived", "all");
    expect(all).toContain("keep-view");
    expect(all).toContain("gone-view");
  });

  it("rejects an invalid --archived value with a usage error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = ["node", "loctt", "label", "list", "--archived", "activ"];
    await main();
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("invalid value for --archived"));
  });
});

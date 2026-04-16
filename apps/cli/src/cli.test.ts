import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "./index.js";
import { initLoctt } from "@loctt/core";

describe("CLI entry point", () => {
  it("exports an async main function", () => {
    expect(typeof main).toBe("function");
  });
});

describe("CLI commands", () => {
  let root: string;
  let originalArgv: string[];
  let originalCwd: () => string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-"));
    originalArgv = process.argv;
    originalCwd = process.cwd;
    process.cwd = () => root;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    process.cwd = originalCwd;
    consoleSpy.mockRestore();
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

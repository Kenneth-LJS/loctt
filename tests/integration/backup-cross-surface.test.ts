/**
 * The backup crosses surfaces.
 *
 * BAK-C1's last bullet: "A backup taken on the CLI restores through
 * MCP, and the reverse." That is the assertion the layer rule exists
 * for — a backup only one surface can take is not a backup — and it is
 * the one thing a core-only test cannot show, because both surfaces
 * could drift from core in the same direction and a core test would
 * still pass.
 *
 * These run the real CLI binary and a real MCP stdio server against a
 * real tracker, so a wiring mistake in either surface fails here.
 */

import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./adapters/cli-spawn.js";
import { startMcpClient } from "./adapters/mcp-stdio.js";

let src: string;
let dst: string;

beforeEach(async () => {
  src = await mkdtemp(join(tmpdir(), "loctt-xs-src-"));
  dst = await mkdtemp(join(tmpdir(), "loctt-xs-dst-"));
  await runCli(["init", "--no-docs"], { cwd: src });
  await runCli(["init", "--no-docs"], { cwd: dst });
});

afterEach(async () => {
  await rm(src, { recursive: true, force: true });
  await rm(dst, { recursive: true, force: true });
});

/** Empties the destination so a bare restore is legal. */
async function emptyTasks(root: string): Promise<void> {
  await rm(join(root, ".loctt", "tasks"), { recursive: true, force: true });
}

function parseMcpJson(text: string | undefined): Record<string, unknown> {
  return JSON.parse(text ?? "{}") as Record<string, unknown>;
}

describe("cross-surface backup", () => {
  // @verifies BAK-C1
  // @verifies BAK-C24
  it("a CLI-taken backup restores through MCP", async () => {
    const created = await runCli(["create", "Written on the CLI"], { cwd: src });
    expect(created.exitCode).toBe(0);
    const backup = await runCli(["backup", "backup.jsonl"], { cwd: src });
    expect(backup.exitCode).toBe(0);
    // The export names its own exclusions (BAK-C1).
    expect(backup.stdout).toContain("Excluded from this backup:");
    expect(backup.stdout).toContain("recents.yaml");

    const srcIds = await readdir(join(src, ".loctt", "tasks"));
    expect(srcIds).toHaveLength(1);

    await emptyTasks(dst);
    const client = await startMcpClient(dst);
    try {
      const res = await client.callTool("restore", {
        files: [join(src, "backup.jsonl")],
        mode: "bare",
      });
      expect(res.isError ?? false).toBe(false);
      const report = parseMcpJson(res.content[0]?.text);
      expect(report["created"]).toBe(1);
    } finally {
      await client.close();
    }

    // Read the far end: the task directory exists on disk, with a body.
    const dstIds = await readdir(join(dst, ".loctt", "tasks"));
    expect(dstIds).toEqual(srcIds);
    const restored = await readFile(
      join(dst, ".loctt", "tasks", srcIds[0] as string, "task.md"), "utf-8",
    );
    expect(restored).toContain("Written on the CLI");
  });

  // @verifies BAK-C1
  // @verifies BAK-C24
  it("an MCP-taken backup restores through the CLI", async () => {
    const client = await startMcpClient(src);
    let reportedTasks: unknown;
    try {
      const created = await client.callTool("create_task", { title: "Written over MCP" });
      expect(created.isError ?? false).toBe(false);
      const res = await client.callTool("backup", { output: "mcp-backup.jsonl" });
      expect(res.isError ?? false).toBe(false);
      const report = parseMcpJson(res.content[0]?.text);
      reportedTasks = report["tasks"];
      // The size is reported (BAK-C6) and the exclusions travel with it.
      expect(typeof report["bytes"]).toBe("number");
      expect(Array.isArray(report["excluded"])).toBe(true);
    } finally {
      await client.close();
    }
    expect(reportedTasks).toBe(1);

    const srcIds = await readdir(join(src, ".loctt", "tasks"));
    await emptyTasks(dst);

    const restore = await runCli(
      ["restore", join(src, "mcp-backup.jsonl")], { cwd: dst },
    );
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout).toContain("created: 1");

    const dstIds = await readdir(join(dst, ".loctt", "tasks"));
    expect(dstIds).toEqual(srcIds);
    expect(await readFile(
      join(dst, ".loctt", "tasks", srcIds[0] as string, "task.md"), "utf-8",
    )).toContain("Written over MCP");
  });

  // @verifies BAK-C9
  it("the CLI refuses a bare restore into a non-empty tracker, exiting non-zero", async () => {
    await runCli(["create", "A"], { cwd: src });
    await runCli(["backup", "backup.jsonl"], { cwd: src });
    await runCli(["create", "Already here"], { cwd: dst });
    const before = await readdir(join(dst, ".loctt", "tasks"));

    const res = await runCli(["restore", join(src, "backup.jsonl")], { cwd: dst });

    // Exit non-zero, both flags named, nothing written.
    expect(res.exitCode).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/--merge/);
    expect(`${res.stdout}${res.stderr}`).toMatch(/--overwrite/);
    expect(await readdir(join(dst, ".loctt", "tasks"))).toEqual(before);
  });

  // @verifies BAK-C15
  it("--dry-run changes nothing on the CLI", async () => {
    await runCli(["create", "A"], { cwd: src });
    await runCli(["backup", "backup.jsonl"], { cwd: src });
    await emptyTasks(dst);

    const dry = await runCli(
      ["restore", join(src, "backup.jsonl"), "--dry-run"], { cwd: dst },
    );
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("Dry run");
    // Predicted, not performed.
    expect(await stat(join(dst, ".loctt", "tasks")).then(() => true, () => false))
      .toBe(false);
  });

  // @verifies BAK-C4
  it("--no-history is honoured end to end and reported", async () => {
    await runCli(["create", "A"], { cwd: src });
    const res = await runCli(
      ["backup", "nohist.jsonl", "--no-history"], { cwd: src },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("History: excluded");

    await emptyTasks(dst);
    expect((await runCli(["restore", join(src, "nohist.jsonl")], { cwd: dst })).exitCode)
      .toBe(0);
    const ids = await readdir(join(dst, ".loctt", "tasks"));
    expect(await stat(join(dst, ".loctt", "tasks", ids[0] as string, "_history.yaml"))
      .then(() => true, () => false)).toBe(false);
  });
});

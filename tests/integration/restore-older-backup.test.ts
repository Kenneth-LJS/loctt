/**
 * Restoring an older backup upgrades it, on the CLI and over MCP (K161,
 * B55). The real CLI binary and a real MCP stdio server, against a
 * genuine 0.1.0 backup: `exportBackup` over the frozen 0.1.0 seed, which
 * records the seed's own `.schema-version` in the header. The upgrade's
 * data correctness is tested in core (`backup/restore-upgrade.test.ts`).
 *
 * @verifies BAK-C25
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportBackup } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./adapters/cli-spawn.js";
import { startMcpClient } from "./adapters/mcp-stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FROZEN = path.join(repoRoot, "tests/fixtures/trackers/seed-0.1.0/.loctt");

let work: string;
let dst: string;
let backup: string;
let taskCount: number;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "loctt-restore-older-"));
  const srcDir = path.join(work, "src", ".loctt");
  await cp(FROZEN, srcDir, { recursive: true });
  backup = path.join(work, "backup.jsonl");
  const report = await exportBackup(srcDir, { outputPath: backup });
  expect(report.schemaVersion).toBe("0.1.0");
  taskCount = report.tasks;
  dst = path.join(work, "dst");
  await mkdir(dst, { recursive: true });
  const init = await runCli(["init", "--no-docs"], { cwd: dst });
  expect(init.exitCode).toBe(0);
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function tasksIn(root: string): Promise<string[]> {
  return readdir(path.join(root, ".loctt", "tasks")).catch(() => []);
}

const versionOf = async (root: string): Promise<string> =>
  (await readFile(path.join(root, ".loctt/.schema-version"), "utf8")).trim();

/** The backup with its header's recorded format replaced. */
async function withFormat(version: string): Promise<string> {
  const lines = (await readFile(backup, "utf8")).split("\n");
  const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
  header["schema_version"] = version;
  lines[0] = JSON.stringify(header);
  const out = path.join(work, `backup-${version}.jsonl`);
  await writeFile(out, lines.join("\n"), "utf8");
  return out;
}

describe("CLI: loctt restore of an older backup", () => {
  it("the dry run names the upgrade and each step, and writes nothing", async () => {
    const res = await runCli(["restore", backup, "--dry-run"], { cwd: dst });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Dry run (bare), nothing written:");
    expect(res.stdout).toContain("The restored data will be upgraded from format 0.1.0 to 0.4.0:");
    expect(res.stdout).toContain("  1. 0.1.0 → 0.3.0  Save the order of every task's links");
    expect(res.stdout).toContain("  2. 0.3.0 → 0.4.0  Move sidebar settings to the Views layout");
    // What each step changes, as `loctt migrate` shows it.
    expect(res.stdout).toContain("     Each task's links keep the order they are shown in today");
    expect(await tasksIn(dst)).toEqual([]);
  });

  it("restores it, upgraded, and the tracker works without `loctt migrate`", async () => {
    const res = await runCli(["restore", backup], { cwd: dst });
    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stdout).toContain(`  created: ${String(taskCount)}`);
    expect(res.stdout).toContain("The restored data was upgraded from format 0.1.0 to 0.4.0:");
    expect(res.stdout).toContain("  1. 0.1.0 → 0.3.0  Save the order of every task's links");
    expect(await tasksIn(dst)).toHaveLength(taskCount);
    expect(await versionOf(dst)).toBe("0.4.0");
    expect(await readFile(path.join(dst, ".loctt/config/workflow.yaml"), "utf8")).not.toMatch(/ranked:/);

    const list = await runCli(["list"], { cwd: dst });
    expect(list.exitCode, list.stderr).toBe(0);
    expect(list.stderr).not.toContain("needs upgrading");
  });

  it("refuses a newer backup naming the release, and writes nothing", async () => {
    const res = await runCli(["restore", await withFormat("0.5.0")], { cwd: dst });
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("This tracker needs loctt 0.5.0 or newer.");
    expect(await tasksIn(dst)).toEqual([]);
  });

  it("no longer says to open the tracker to upgrade it", async () => {
    const res = await runCli(["restore", await withFormat("0.3.0"), "--dry-run"], { cwd: dst });
    expect(res.exitCode).toBe(0);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/open the tracker/);
    expect(res.stdout).toContain("The restored data will be upgraded from format 0.3.0 to 0.4.0:");
  });
});

describe("MCP: restore of an older backup", () => {
  it("dry_run returns the upgrade and its steps, then a confirmed restore upgrades", async () => {
    const client = await startMcpClient(dst);
    try {
      const preview = await client.callTool("restore", { files: [backup], dry_run: true });
      expect(preview.isError ?? false).toBe(false);
      const planned = JSON.parse(preview.content[0]?.text ?? "{}") as {
        dryRun: boolean;
        upgrade?: { from: string; to: string; steps: { from: string; to: string; description: string; changes?: string }[] };
      };
      expect(planned.dryRun).toBe(true);
      expect(planned.upgrade?.from).toBe("0.1.0");
      expect(planned.upgrade?.to).toBe("0.4.0");
      expect(planned.upgrade?.steps.map(s => `${s.from}>${s.to} ${s.description}`)).toEqual([
        "0.1.0>0.3.0 Save the order of every task's links",
        "0.3.0>0.4.0 Move sidebar settings to the Views layout",
      ]);
      for (const s of planned.upgrade?.steps ?? []) expect(s.changes).toMatch(/\w/);
      expect(await tasksIn(dst)).toEqual([]);

      const res = await client.callTool("restore", { files: [backup], confirm: true });
      expect(res.isError ?? false).toBe(false);
      const report = JSON.parse(res.content[0]?.text ?? "{}") as { created: number; upgrade?: { from: string } };
      expect(report.created).toBe(taskCount);
      expect(report.upgrade?.from).toBe("0.1.0");
      expect(await versionOf(dst)).toBe("0.4.0");

      // The next tool call works: nothing asks for an upgrade.
      const listed = await client.callTool("list_tasks", {});
      expect(listed.isError ?? false).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("refuses a newer backup naming the release, and writes nothing", async () => {
    const client = await startMcpClient(dst);
    try {
      const res = await client.callTool("restore", { files: [await withFormat("0.5.0")], confirm: true });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain("This tracker needs loctt 0.5.0 or newer.");
      expect(await tasksIn(dst)).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

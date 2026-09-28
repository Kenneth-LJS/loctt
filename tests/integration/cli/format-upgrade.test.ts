import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Format versions through the real CLI binary and MCP server (K142,
 * K143): the automatic 0.1.0 → 0.3.0 upgrade on first use, the one line
 * each surface shows, the refusals, the crash sentinel, and two opens at
 * once. The upgrade's data correctness is tested in core
 * (`schema/upgrade-0.3.0.test.ts`) and in the runthrough.
 *
 * @verifies ONB-C12
 * @verifies ONB-C13
 * @verifies ONB-C14
 * @verifies ONB-C16
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FROZEN = path.join(repoRoot, "tests/fixtures/trackers/seed-0.1.0/.loctt");

const LINE = /^Upgraded this tracker from 0\.1\.0 to 0\.3\.0 \(backup: (.+\.loctt\.backup-v0\.1\.0-[^)]+)\)\.$/m;

async function frozenSeed(root: string): Promise<void> {
  await cp(FROZEN, path.join(root, ".loctt"), { recursive: true });
}

const versionOf = async (root: string): Promise<string> =>
  (await readFile(path.join(root, ".loctt/.schema-version"), "utf8")).trim();

const backupsIn = async (root: string): Promise<string[]> =>
  (await readdir(root)).filter(n => n.startsWith(".loctt.backup-v0.1.0-"));

describe("automatic upgrade on first use", () => {
  it("CLI: the first command upgrades, prints the line on stderr, and runs; the next says nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const first = await runCli(["list", "--limit", "1"], { cwd: root });
      expect(first.exitCode, first.stderr).toBe(0);
      const m = LINE.exec(first.stderr);
      expect(m, first.stderr).not.toBeNull();
      expect(first.stdout).not.toMatch(/Upgraded/);
      expect(await versionOf(root)).toBe("0.3.0");
      expect(await backupsIn(root)).toEqual([path.basename(m?.[1] ?? "")]);
      expect((await readFile(path.join(m?.[1] ?? "", ".schema-version"), "utf8")).trim()).toBe("0.1.0");

      const second = await runCli(["list", "--limit", "1"], { cwd: root });
      expect(second.stderr).not.toMatch(/Upgraded/);

      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout.split("\n").filter(l => /^ {2}[!✗]/.test(l))).toEqual([
        "  ! key index: no index on disk. Will rebuild on next lookup",
      ]);
    }, { init: false });
  });

  it("MCP: the first tool call upgrades and carries the line after its own content", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const client = await startMcpClient(root);
      try {
        const first = await client.callTool("list_tasks", { limit: 1 });
        expect(first.isError).toBeFalsy();
        const texts = first.content.map(c => c.text ?? "");
        expect(texts[0]).not.toMatch(/Upgraded/);
        expect(texts[texts.length - 1]).toMatch(LINE);
        const second = await client.callTool("list_tasks", { limit: 1 });
        expect(second.content.some(c => (c.text ?? "").startsWith("Upgraded"))).toBe(false);
      } finally {
        await client.close();
      }
      expect(await versionOf(root)).toBe("0.3.0");
      expect(await backupsIn(root)).toHaveLength(1);
    }, { init: false });
  });

  it("doctor and info describe an older tracker without upgrading it", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout).toContain(
        "✗ schema version: on disk 0.1.0, this build reads 0.3.0. The next command that opens it upgrades it (with a backup), or run loctt migrate",
      );
      expect(doctor.stdout).toContain("! workflow.yaml retired settings: 'ranked' on blocks, 'ranked' on parent no longer does anything");
      await runCli(["info"], { cwd: root });
      expect(await versionOf(root)).toBe("0.1.0");
      expect(await backupsIn(root)).toEqual([]);
    }, { init: false });
  });

  it("two commands opening the tracker at once upgrade it once", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const results = await Promise.all([
        runCli(["list", "--limit", "1"], { cwd: root, timeout: 60_000 }),
        runCli(["list", "--limit", "1"], { cwd: root, timeout: 60_000 }),
        runCli(["show", "WEB-9"], { cwd: root, timeout: 60_000 }),
      ]);
      for (const r of results) expect(r.exitCode, r.stderr).toBe(0);
      expect(results.filter(r => LINE.test(r.stderr))).toHaveLength(1);
      expect(await backupsIn(root)).toHaveLength(1);
      expect(await versionOf(root)).toBe("0.3.0");
    }, { init: false });
  });
});

describe("what every surface refuses", () => {
  it.each([
    ["9.9.9\n", "This tracker needs loctt 9.9.9 or newer."],
    ["1\n", ".schema-version must hold a format version such as 0.3.0 (three whole numbers separated by dots). Got: 1."],
    ["garbage\n", ".schema-version must hold a format version such as 0.3.0 (three whole numbers separated by dots). Got: garbage."],
    ["", ".schema-version is empty. It must hold a format version such as 0.3.0."],
  ])("%j: CLI and MCP refuse with the message, and nothing is written", async (content, message) => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/.schema-version"), content, "utf8");
      const cli = await runCli(["list"], { cwd: root });
      expect(cli.exitCode).toBe(1);
      expect(cli.stderr).toContain(`Error: ${message}`);
      if (content === "1\n") {
        // What to write instead (K142: Ken edits `1` to `0.1.0`).
        expect(cli.stderr).toContain("0.1.0 for a tracker made by loctt 0.2.x or earlier (which wrote 1)");
      }
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toContain(message);
      } finally {
        await client.close();
      }
      expect(await readFile(path.join(root, ".loctt/.schema-version"), "utf8")).toBe(content);
      expect(await readdir(root)).not.toContainEqual(expect.stringMatching(/^\.loctt\.backup-/));
    });
  });

  it("an upgrade that crashed part-way: every surface refuses with the recovery message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      // What a crash inside the step leaves (core's crash test produces
      // it by injecting a throw): the version still 0.1.0, the sentinel
      // naming the backup.
      const backup = path.join(root, ".loctt.backup-v0.1.0-crashed");
      await cp(path.join(root, ".loctt"), backup, { recursive: true });
      await writeFile(
        path.join(root, ".loctt/.schema-migration-in-progress"),
        `from: 0.1.0\nto: 0.3.0\nbackup: ${backup}\n`,
        "utf8",
      );
      const cli = await runCli(["list"], { cwd: root });
      expect(cli.exitCode).toBe(1);
      expect(cli.stderr).toContain("A schema migration was interrupted mid-run.");
      expect(cli.stderr).toContain("Restore from the backup named in");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toContain("A schema migration was interrupted mid-run.");
      } finally {
        await client.close();
      }
      expect(await versionOf(root)).toBe("0.1.0");
    }, { init: false });
  });
});

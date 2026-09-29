import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Format versions through the real CLI binary and MCP server (K142,
 * K154): an older tracker is refused on every surface with the upgrade
 * message and nothing is written, until the user upgrades it on purpose
 * (`loctt migrate`, which previews and asks). Also the refusals, the
 * crash sentinel, and two upgrades at once. The upgrade's data
 * correctness is tested in core (`schema/upgrade-0.3.0.test.ts`) and in
 * the runthrough.
 *
 * Rewritten for K154: the first describe asserted K143's automatic
 * upgrade on first use (the one line on stderr, the extra MCP content
 * item), the superseded rule.
 *
 * @verifies ONB-C12
 * @verifies ONB-C13
 * @verifies ONB-C14
 * @verifies ONB-C16
 * @verifies ONB-C20
 * @verifies ONB-C21
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FROZEN = path.join(repoRoot, "tests/fixtures/trackers/seed-0.1.0/.loctt");

const REFUSAL =
  "This tracker needs upgrading from 0.1.0 to 0.4.0. Run `loctt migrate` (a backup is made first).";

async function frozenSeed(root: string): Promise<void> {
  await cp(FROZEN, path.join(root, ".loctt"), { recursive: true });
}

const versionOf = async (root: string): Promise<string> =>
  (await readFile(path.join(root, ".loctt/.schema-version"), "utf8")).trim();

const backupsIn = async (root: string): Promise<string[]> =>
  (await readdir(root)).filter(n => n.startsWith(".loctt.backup-v0.1.0-"));

/** Every file under `root`, path → content: "nothing was written". */
async function fingerprint(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(p.slice(root.length), await readFile(p, "utf8"));
    }
  };
  await walk(root);
  return out;
}

describe("an older tracker is refused until the user upgrades it (K154)", () => {
  it("CLI: reads and writes are refused with the message, exit 1, nothing written", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const before = await fingerprint(root);
      for (const args of [["list"], ["show", "WEB-9"], ["create", "New task"], ["set", "WEB-9", "priority", "high"]]) {
        const res = await runCli(args, { cwd: root });
        expect(res.exitCode, args.join(" ")).toBe(1);
        expect(res.stderr, args.join(" ")).toContain(`Error: ${REFUSAL}`);
        expect(res.stdout, args.join(" ")).toBe("");
      }
      expect(await fingerprint(root)).toEqual(before);
    }, { init: false });
  });

  it("MCP: tools return the message, nothing written", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const before = await fingerprint(root);
      const client = await startMcpClient(root);
      try {
        for (const [tool, args] of [["list_tasks", {}], ["create_task", { title: "x" }], ["get_task", { ref: "WEB-9" }]] as const) {
          const res = await client.callTool(tool, args);
          expect(res.isError, tool).toBe(true);
          expect(res.content.map(c => c.text), tool).toEqual([`Error: ${REFUSAL}`]);
        }
      } finally {
        await client.close();
      }
      expect(await fingerprint(root)).toEqual(before);
    }, { init: false });
  });

  it("doctor and info describe it and write nothing, even asked to repair", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const before = await fingerprint(root);
      const doctor = await runCli(["doctor", "--fix", "--rebuild-index"], { cwd: root });
      expect(doctor.stdout).toContain(
        "✗ schema version: needs upgrading from 0.1.0 to 0.4.0. Run loctt migrate (a backup is made first)",
      );
      expect(doctor.stdout).toContain(
        "✗ repairs: skipped. This tracker needs upgrading first. Run loctt migrate, then run the repair again",
      );
      expect(doctor.stdout).toContain("! workflow.yaml retired settings: 'ranked' on blocks, 'ranked' on parent no longer does anything");
      const info = await runCli(["info"], { cwd: root });
      expect(info.stdout).toContain("Schema: needs upgrading from 0.1.0 to 0.4.0. Run `loctt migrate` (a backup is made first)");
      expect(await fingerprint(root)).toEqual(before);
    }, { init: false });
  });

  it("loctt migrate: previews, refuses without --yes off a terminal, --dry-run changes nothing, --yes upgrades", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const before = await fingerprint(root);

      const dry = await runCli(["migrate", "--dry-run"], { cwd: root });
      expect(dry.exitCode, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("This tracker needs upgrading from 0.1.0 to 0.4.0.");
      expect(dry.stdout).toContain("1. 0.1.0 → 0.3.0  Save the order of every task's links");
      // K160: the chain continues in the same run.
      expect(dry.stdout).toContain("2. 0.3.0 → 0.4.0  Move sidebar settings to the Views layout");
      expect(dry.stdout).toContain(".loctt.backup-v0.1.0-<date and time>");
      expect(dry.stdout).toContain("Dry run. Nothing was changed.");

      const noYes = await runCli(["migrate"], { cwd: root });
      expect(noYes.exitCode).toBe(2);
      expect(noYes.stderr).toContain("Pass --yes");
      expect(await fingerprint(root)).toEqual(before);

      const yes = await runCli(["migrate", "--yes"], { cwd: root });
      expect(yes.exitCode, yes.stderr).toBe(0);
      expect(yes.stdout).toContain("Upgraded this tracker from 0.1.0 to 0.4.0.");
      const backup = /Backup written to (.+)/.exec(yes.stdout)?.[1] ?? "";
      expect(await backupsIn(root)).toEqual([path.basename(backup)]);
      expect((await readFile(path.join(backup, ".schema-version"), "utf8")).trim()).toBe("0.1.0");
      expect(await versionOf(root)).toBe("0.4.0");

      const list = await runCli(["list", "--limit", "1"], { cwd: root });
      expect(list.exitCode, list.stderr).toBe(0);
      expect(list.stderr).toBe("");
      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout.split("\n").filter(l => /^ {2}[!✗]/.test(l))).toEqual([
        "  ! key index: no index on disk. Will rebuild on next lookup",
      ]);
    }, { init: false });
  });

  it("two `loctt migrate --yes` at once upgrade it once, and the other says why it did nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await frozenSeed(root);
      const results = await Promise.all([
        runCli(["migrate", "--yes"], { cwd: root, timeout: 60_000 }),
        runCli(["migrate", "--yes"], { cwd: root, timeout: 60_000 }),
      ]);
      expect(results.filter(r => r.exitCode === 0 && r.stdout.includes("Upgraded this tracker from 0.1.0 to 0.4.0."))).toHaveLength(1);
      // The other found it done, or found it mid-upgrade and said so
      // (never "interrupted", never a second run).
      const other = results.find(r => !r.stdout.includes("Upgraded this tracker"));
      expect(`${other?.stdout ?? ""}${other?.stderr ?? ""}`).toMatch(
        /already at format 0\.4\.0|being upgraded by another loctt process/,
      );
      expect(await backupsIn(root)).toHaveLength(1);
      expect(await versionOf(root)).toBe("0.4.0");
    }, { init: false });
  });
});

describe("what every surface refuses", () => {
  it.each([
    ["9.9.9\n", "This tracker needs loctt 9.9.9 or newer."],
    ["1\n", ".schema-version must hold a format version such as 0.4.0 (three whole numbers separated by dots). Got: 1."],
    ["garbage\n", ".schema-version must hold a format version such as 0.4.0 (three whole numbers separated by dots). Got: garbage."],
    ["", ".schema-version is empty. It must hold a format version such as 0.4.0."],
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

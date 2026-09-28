import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { lookupTask, resolveLocttDir } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * K140 / K141 through the real CLI binary and MCP server.
 *
 * The report, verbatim: "loctt create --parent GAME-4 writes the raw key
 * into the task file instead of the task ID, and doesn't add the child
 * link on the parent. doctor then reports 26 broken references, and
 * unlink can't remove them."
 *
 * @verifies REL-C6
 * @verifies REL-C7
 */

async function cli(root: string, ...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCli(args, { cwd: root });
}

async function relsOf(root: string, key: string): Promise<unknown> {
  return (await lookupTask(resolveLocttDir(root), key)).frontmatter.relationships;
}

async function idOf(root: string, key: string): Promise<string> {
  return (await lookupTask(resolveLocttDir(root), key)).frontmatter.id;
}

/** Hand-writes a child the way `create --parent KEY` did before the fix. */
async function writeKeyValuedChild(root: string, key: string, parentKey: string): Promise<void> {
  const locttDir = resolveLocttDir(root);
  const projects = await readFile(path.join(locttDir, "config", "projects.yaml"), "utf8");
  const project = /id: (\S+)/.exec(projects)?.[1] ?? "";
  const id = `01J00000000000000000000${key.replace(/\D/g, "").padStart(3, "0")}`;
  await mkdir(path.join(locttDir, "tasks", id), { recursive: true });
  await writeFile(path.join(locttDir, "tasks", id, "task.md"), [
    "---",
    `id: ${id}`,
    `key: ${key}`,
    `title: child ${key}`,
    "created_at: 2026-09-01T00:00:00.000Z",
    "updated_at: 2026-09-01T00:00:00.000Z",
    `project: ${project}`,
    "status: backlog",
    "relationships:",
    "  - type: parent",
    `    target: ${parentKey}`,
    "---",
    "",
  ].join("\n"), "utf8");
}

describe("CLI: create --parent (K140)", () => {
  it("the reported scenario: create --parent KEY links both ways, doctor is clean, unlink works", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (let i = 1; i <= 4; i += 1) await cli(root, "create", `task ${String(i)}`);
      const res = await cli(root, "create", "the child", "--parent", "T-4");
      expect(res.exitCode, res.stderr).toBe(0);

      const parentId = await idOf(root, "T-4");
      const childId = await idOf(root, "T-5");
      expect(await relsOf(root, "T-5")).toEqual([{ type: "parent", target: parentId }]);
      expect(await relsOf(root, "T-4")).toEqual([{ type: "child", target: childId }]);

      expect((await cli(root, "show", "T-5")).stdout).toMatch(/ {2}parent → T-4 {2}task 4 {2}\[backlog\]/);
      expect((await cli(root, "show", "T-4")).stdout).toMatch(/ {2}child → T-5 {2}the child {2}\[backlog\]/);

      const doctor = await cli(root, "doctor");
      expect(doctor.exitCode).toBe(0);
      expect(doctor.stdout).not.toMatch(/relationships|data integrity: \//);
      expect(doctor.stdout).not.toMatch(/^ {2}[!✗]/m);

      const unlink = await cli(root, "unlink", "T-5", "parent", "T-4");
      expect(unlink.exitCode, unlink.stderr).toBe(0);
      expect(await relsOf(root, "T-5")).toBeUndefined();
      expect(await relsOf(root, "T-4")).toBeUndefined();
    });
  });

  it("refuses a parent that does not exist, with link's message, and creates nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "one");
      const res = await cli(root, "create", "orphan", "--parent", "NOPE-99");
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(`Task not found: "NOPE-99"`);
      // The key was not used up.
      expect((await cli(root, "create", "two")).stdout).toContain("Created T-2: two");
    });
  });

  it("refuses an archived parent, with link's message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "old");
      await cli(root, "archive", "T-1");
      const res = await cli(root, "create", "child", "--parent", "T-1");
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Cannot link to archived task T-1. Unarchive it first.");
      expect((await cli(root, "create", "next")).stdout).toContain("Created T-2: next");
    });
  });

  it("show lists children in the web's order: ranked first, then unranked in stored order", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "parent");
      await cli(root, "create", "a", "--parent", "T-1");
      await cli(root, "create", "b", "--parent", "T-1");
      await cli(root, "create", "c", "--parent", "T-1");
      // Ranking only T-4 puts it above the two unranked children.
      expect((await cli(root, "rerank", "T-1", "child", "T-4")).exitCode).toBe(0);
      const lines = (await cli(root, "show", "T-1")).stdout.split("\n").filter(l => l.startsWith("  child → "));
      expect(lines.map(l => l.slice("  child → ".length, "  child → ".length + 3))).toEqual(["T-4", "T-2", "T-3"]);
    });
  });
});

describe("CLI: doctor --repair-relationships and --fix (K141)", () => {
  it("detects the broken tracker, repairs it, is clean after, and a second run does nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "the parent");
      await writeKeyValuedChild(root, "T-2", "T-1");
      await writeKeyValuedChild(root, "T-3", "T-1");
      await cli(root, "doctor", "--rebuild-index");

      const before = await cli(root, "doctor");
      expect(before.stdout).toContain(
        "! relationships: 2 issue(s) found. 4 can be fixed with loctt doctor --repair-relationships",
      );
      expect(before.stdout).toContain(`target "T-1" is a task key, not a task id.`);

      const unlink = await cli(root, "unlink", "T-2", "parent", "T-1");
      expect(unlink.exitCode).toBe(1); // what the reporter hit

      const repair = await cli(root, "doctor", "--repair-relationships");
      expect(repair.stdout).toContain(
        "✓ relationship repair: repaired: 2 key(s) rewritten to ids, 2 missing side(s) added",
      );
      expect(repair.stdout).not.toMatch(/^ {2}[!✗]/m);

      const parentId = await idOf(root, "T-1");
      expect(await relsOf(root, "T-2")).toEqual([{ type: "parent", target: parentId }]);
      expect(await relsOf(root, "T-1")).toEqual([
        { type: "child", target: await idOf(root, "T-2") },
        { type: "child", target: await idOf(root, "T-3") },
      ]);

      const again = await cli(root, "doctor", "--repair-relationships");
      expect(again.stdout).toContain("✓ relationship repair: nothing to repair");

      expect((await cli(root, "unlink", "T-2", "parent", "T-1")).exitCode).toBe(0);
    });
  });

  it("--fix runs every safe repair, then reports what is left", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "the parent");
      await writeKeyValuedChild(root, "T-2", "T-1");
      const res = await cli(root, "doctor", "--fix");
      expect(res.stdout).toContain("✓ key index rebuild: rebuilt with 2 entry/entries");
      expect(res.stdout).toContain("✓ relationship repair: repaired: 1 key(s) rewritten to ids, 1 missing side(s) added");
      expect(res.stdout).not.toMatch(/^ {2}[!✗]/m);
    });
  });
});

describe("MCP: create_task parent, get_task order, doctor repair (K140, K141)", () => {
  it("create_task with a parent key or id links both ways; a missing parent is an error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "the parent");
      const parentId = await idOf(root, "T-1");
      const client = await startMcpClient(root);
      try {
        expect((await client.callTool("create_task", { title: "by key", parent: "T-1" })).isError).toBeFalsy();
        expect((await client.callTool("create_task", { title: "by id", parent: parentId })).isError).toBeFalsy();
        const missing = await client.callTool("create_task", { title: "orphan", parent: "NOPE-99" });
        expect(missing.isError).toBe(true);
        expect(missing.content[0]?.text).toContain(`Task not found: "NOPE-99"`);
      } finally {
        await client.close();
      }
      expect(await relsOf(root, "T-2")).toEqual([{ type: "parent", target: parentId }]);
      expect(await relsOf(root, "T-3")).toEqual([{ type: "parent", target: parentId }]);
      expect(await relsOf(root, "T-1")).toEqual([
        { type: "child", target: await idOf(root, "T-2") },
        { type: "child", target: await idOf(root, "T-3") },
      ]);
      // The orphan used no key.
      expect((await cli(root, "create", "next")).stdout).toContain("Created T-4: next");
    });
  });

  it("get_task lists relationships in the web's order and returns each rank", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "parent");
      await cli(root, "create", "a", "--parent", "T-1");
      await cli(root, "create", "b", "--parent", "T-1");
      await cli(root, "rerank", "T-1", "child", "T-3");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task", { ref: "T-1" });
        const task = JSON.parse(res.content[0]?.text ?? "{}") as { relationships: { target: string; rank?: string }[] };
        expect(task.relationships.map(r => r.target)).toEqual(["T-3", "T-2"]);
        expect(typeof task.relationships[0]?.rank).toBe("string");
        expect(task.relationships[1]?.rank).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });

  it("doctor repair_relationships and fix repair the tracker and report what is left", async () => {
    await withTmpLoctt(async ({ root }) => {
      await cli(root, "create", "the parent");
      await writeKeyValuedChild(root, "T-2", "T-1");
      await writeKeyValuedChild(root, "T-3", "T-1");
      const client = await startMcpClient(root);
      try {
        const check = JSON.parse((await client.callTool("doctor", {})).content[0]?.text ?? "{}") as {
          checks: { name: string; fix?: string }[];
        };
        expect(check.checks.find(c => c.name === "relationships")?.fix).toBe("repair-relationships");

        const repaired = JSON.parse((await client.callTool("doctor", { repair_relationships: true })).content[0]?.text ?? "{}") as {
          checks: { name: string; status: string; message: string }[];
        };
        expect(repaired.checks.find(c => c.name === "relationship repair")?.message)
          .toBe("repaired: 2 key(s) rewritten to ids, 2 missing side(s) added");
        // Nothing about links is left. (The hand-written tasks are not in
        // the key index yet, which `fix` below rebuilds.)
        expect(repaired.checks.filter(c => c.status !== "ok").map(c => c.name)).toEqual(["key index"]);

        const fixed = JSON.parse((await client.callTool("doctor", { fix: true })).content[0]?.text ?? "{}") as {
          healthy: boolean;
          checks: { name: string; status: string; message: string }[];
        };
        expect(fixed.checks.filter(c => c.status !== "ok")).toEqual([]);
        expect(fixed.checks.find(c => c.name === "relationship repair")?.message).toBe("nothing to repair");
        expect(fixed.checks.find(c => c.name === "key index rebuild")).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });
});

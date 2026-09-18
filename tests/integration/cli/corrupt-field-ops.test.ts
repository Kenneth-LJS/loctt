import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A set/unset round-trip and a derived-op refusal over an ON-DISK corrupt
 * task reach the CLI/MCP as clear outcomes, not stack traces (DEG-4,
 * DEG-3, DEG-6).
 *
 * The fixture is a real corrupt task.md, not a dangling reference: two
 * field-local corruptions on one task — a wrong-typed `estimate` and a
 * wrong-typed `relationships` — so a repair of one can be shown to leave
 * the other untouched (preserve-others), and a derived op that must read
 * `relationships` (link) refuses naming the field.
 *
 * @verifies DEG-C4
 */
describe("set/unset and derived-op refusal over an on-disk corrupt task", () => {
  const taskFileForKey = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    for (const id of await readdir(dir)) {
      const file = path.join(dir, id, "task.md");
      if ((await readFile(file, "utf-8")).includes(`key: ${key}\n`)) return file;
    }
    throw new Error(`no task file for ${key}`);
  };

  /** Adds two field-local corruptions (estimate + relationships). */
  const corruptTwoFields = async (root: string, key: string): Promise<string> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    const after = before.replace(
      /^key: .*$/m,
      m => `${m}\nestimate:\n  - not\n  - a\n  - number\nrelationships: not-a-list`,
    );
    expect(after).not.toBe(before);
    await writeFile(file, after, "utf-8");
    return file;
  };

  it("CLI: set repairs a corrupt field and leaves a corrupt sibling untouched", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "victim"], { cwd: root });
      const file = await corruptTwoFields(root, "T-1");

      // Repair `estimate` with a valid set.
      const set = await runCli(["set", "T-1", "estimate", "5"], { cwd: root });
      expect(set.exitCode).toBe(0);

      // estimate repaired; relationships sibling preserved (DEG-3).
      const after = await readFile(file, "utf-8");
      expect(after).toMatch(/estimate: ["']?5["']?/);
      expect(after).toContain("relationships: not-a-list");

      // show reports the surviving corruption clearly, no stack trace.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toMatch(/Estimate: 5/);
      expect(show.stdout).toMatch(/⚠ relationships/);
    });
  });

  it("CLI: unset removes a corrupt field cleanly", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "victim"], { cwd: root });
      const file = await corruptTwoFields(root, "T-1");

      const unset = await runCli(["unset", "T-1", "estimate"], { cwd: root });
      expect(unset.exitCode).toBe(0);
      const after = await readFile(file, "utf-8");
      expect(after).not.toMatch(/^estimate:/m);
      // Sibling still preserved.
      expect(after).toContain("relationships: not-a-list");
    });
  });

  it("CLI: a derived op refuses with a corrupt-field error naming the field", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "victim"], { cwd: root });
      await runCli(["create", "other"], { cwd: root });
      await corruptTwoFields(root, "T-1");

      // link must read+merge `relationships` — it refuses (DEG-6).
      const link = await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      const out = `${link.stdout}${link.stderr}`;
      expect(link.exitCode).not.toBe(0);
      expect(out).toMatch(/relationships/);
      // A clear domain message, not a raw stack trace / 500.
      expect(out).not.toMatch(/at Object\.|\n\s+at /);
    });
  });

  it("MCP: set_field repairs, unset_field removes, link_tasks refuses via isError", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "victim"], { cwd: root });
      await runCli(["create", "other"], { cwd: root });
      await corruptTwoFields(root, "T-1");

      const client = await startMcpClient(root);
      try {
        // Repair estimate.
        const set = await client.callTool("update_task", { ref: "T-1", field: "estimate", value: "5" });
        expect(set.isError).toBeFalsy();

        // Derived op refuses with an isError envelope naming the field —
        // MCP signals failure differently from the CLI (isError vs exit
        // code) but both name `relationships` and neither emits a fault.
        const link = await client.callTool("link_tasks", { ref: "T-1", type: "blocks", target: "T-2" });
        expect(link.isError).toBe(true);
        expect(link.content[0]?.text ?? "").toMatch(/relationships/);

        // Unset the (now repaired) estimate cleanly.
        const unset = await client.callTool("unset_field", { ref: "T-1", field: "estimate" });
        expect(unset.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });
});

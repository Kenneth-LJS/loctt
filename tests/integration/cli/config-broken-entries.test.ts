import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A hand-broken config entry is surfaced by the `list` commands on both
 * CLI and MCP — named and marked, distinct from an empty list. One broken
 * sprint must not read as "no sprints" (A138 / DEG-11).
 *
 * The tolerant loaders lift an entry that does not validate into
 * `config.broken` and load the rest; the CLI saved-views list already
 * rendered this, but the sprint/label/milestone/project lists and their
 * MCP twins showed only the valid entries — so a broken entry was
 * invisible on two of three surfaces.
 *
 * Each config keeps one valid entry and gains one that parses as YAML but
 * fails its schema (a bare `id` with no other required field), so the
 * loader degrades exactly one entry rather than fatalling the file.
 *
 * @verifies DEG-C3
 */
describe("a broken config entry is surfaced by list, never read as none", () => {
  /** Inserts a schema-invalid (but YAML-valid) entry as the FIRST item of
   * the config's list. A lone `id` fails every entry schema (name/dates/
   * prefix all required somewhere) yet is valid YAML, so it degrades to
   * `broken`. Inserting at the head of the list (right after the `<key>:`
   * line) keeps it inside the array — `projects.yaml` has a trailing
   * `default:` key, so appending to the end of the file would land it
   * outside the list and change the file's shape rather than one entry. */
  const breakOne = async (
    root: string,
    file: string,
  ): Promise<void> => {
    const p = path.join(root, ".loctt/config", file);
    const before = await readFile(p, "utf-8");
    // The first line is the list key (`sprints:`, `labels:`, …). Splice
    // the broken entry in right after it.
    const after = before.replace(
      /^([a-z_]+:)\n/m,
      "$1\n  - id: 01BROKENENTRY0000000000000\n",
    );
    if (after === before) throw new Error(`could not find list key in ${file}`);
    await writeFile(p, after, "utf-8");
  };

  const seed = async (root: string): Promise<void> => {
    await runCli(["sprint", "create", "S1", "--start", "2026-01-01", "--end", "2026-01-14"], { cwd: root });
    await runCli(["label", "create", "Bug"], { cwd: root });
    await runCli(["milestone", "create", "M1"], { cwd: root });
    await runCli(["project", "create", "Api", "--prefix", "A"], { cwd: root });
    await breakOne(root, "sprints.yaml");
    await breakOne(root, "labels.yaml");
    await breakOne(root, "milestones.yaml");
    await breakOne(root, "projects.yaml");
  };

  const cases: { cmd: string[]; valid: string }[] = [
    { cmd: ["sprint", "list"], valid: "S1" },
    { cmd: ["label", "list"], valid: "Bug" },
    { cmd: ["milestone", "list"], valid: "M1" },
    { cmd: ["project", "list"], valid: "Api" },
  ];

  for (const c of cases) {
    it(`loctt ${c.cmd.join(" ")} lists the broken entry beside the valid one`, async () => {
      await withTmpLoctt(async ({ root }) => {
        await seed(root);
        const res = await runCli(c.cmd, { cwd: root });
        expect(res.exitCode).toBe(0);
        // The valid entry is still there — the broken one degrades, it
        // does not take the file down.
        expect(res.stdout).toContain(c.valid);
        // The broken entry is named and marked, distinct from an empty
        // list. The marker word and the offending id both appear.
        expect(res.stdout).toMatch(/broken/i);
        expect(res.stdout).toContain("01BROKENENTRY0000000000000");
      });
    });
  }

  const mcpCases: { tool: string; listKey: string; valid: string }[] = [
    { tool: "list_sprints", listKey: "sprints", valid: "S1" },
    { tool: "list_labels", listKey: "labels", valid: "Bug" },
    { tool: "list_milestones", listKey: "milestones", valid: "M1" },
    { tool: "list_projects", listKey: "projects", valid: "Api" },
  ];

  for (const c of mcpCases) {
    it(`MCP ${c.tool} carries the broken entry in a broken[] list`, async () => {
      await withTmpLoctt(async ({ root }) => {
        await seed(root);
        const client = await startMcpClient(root);
        try {
          const res = await client.callTool(c.tool, {});
          const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
            broken?: { id?: string }[];
          } & Record<string, unknown>;
          // The valid entries are present.
          expect(JSON.stringify(parsed)).toContain(c.valid);
          // The broken entry rides in `broken[]`, not silently omitted.
          expect(parsed.broken?.some(b => b.id === "01BROKENENTRY0000000000000")).toBe(true);
        } finally {
          await client.close();
        }
      });
    });
  }

  it("a clean config lists no broken entries on either surface", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["label", "create", "Bug"], { cwd: root });
      const cli = await runCli(["label", "list"], { cwd: root });
      expect(cli.exitCode).toBe(0);
      expect(cli.stdout).not.toMatch(/broken/i);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_labels", {});
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as { broken?: unknown };
        expect(parsed.broken).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});

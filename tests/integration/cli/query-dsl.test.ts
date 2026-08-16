import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies QRY-C3
 * @verifies QRY-C6
 *
 * QRY-C3 is a documentation-vs-reality check: every DSL construct the
 * reference documents must actually run. All ten do — this pins them.
 *
 * QRY-C6 was two live defects. `list_views` returned only
 * `{name, query}`, so two views sharing a name were indistinguishable
 * and neither was addressable. And `listTasks` had its own private
 * lookup matching on name alone, which silently ran whichever entry came
 * first — exit 0, no warning, wrong results — while rejecting the id
 * that `findView` tells the user to fall back to.
 */

/** Seeds a tracker with a custom field and one relationship, so every construct has something to bind to. */
async function seeded(root: string): Promise<void> {
  const workflow = path.join(root, ".loctt/config/workflow.yaml");
  const text = await readFile(workflow, "utf8");
  await writeFile(
    workflow,
    text.replace(
      "custom_fields: []",
      // `multi` and `searchable` are required. This fixture omitted
      // them and passed anyway, because `loadOptionalConfigs` swallowed
      // the parse error and ran as though there were no workflow config
      // at all — so these tests were exercising an unconfigured tracker.
      "custom_fields:\n  - key: points\n    label: Points\n    type: number\n    multi: false\n    searchable: true",
    ),
    "utf8",
  );
  await runCli(["create", "alpha"], { cwd: root });
  await runCli(["create", "beta"], { cwd: root });
}

describe("documented DSL constructs (spawned binary)", () => {
  const CONSTRUCTS = [
    "status in (backlog, done)",
    "status not in (backlog)",
    'text ~ "alpha"',
    "text ~ 'alpha'",
    "due_date < today",
    "parent = T-1",
    "fields.points > 3",
    "not (status = done)",
    "status = backlog and (priority = high or priority = low)",
    // Every built-in sidebar filter depends on this one.
    "status.category not in (completed, discarded)",
  ];

  it.each(CONSTRUCTS)("runs %s", async (query) => {
    await withTmpLoctt(async ({ root }) => {
      await seeded(root);
      const result = await runCli(["list", "--query", query], { cwd: root });
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/Error:/);
      expect(result.exitCode).toBe(0);
    });
  });

  it("rejects the bracket list form, naming the bracket", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seeded(root);
      const result = await runCli(
        ["list", "--query", "priority in [high, critical]"],
        { cwd: root },
      );
      // Brackets must not be accepted on one surface and rejected on
      // another; the message has to show the parenthesised form.
      expect(result.exitCode).not.toBe(0);
      const text = `${result.stdout}${result.stderr}`;
      expect(text).toContain("[");
      expect(text).toMatch(/parenthes|\(backlog/);
    });
  });

  it("treats single and double quotes identically", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seeded(root);
      const dq = await runCli(["list", "--query", 'text ~ "alpha"'], { cwd: root });
      const sq = await runCli(["list", "--query", "text ~ 'alpha'"], { cwd: root });
      expect(dq.exitCode).toBe(0);
      expect(sq.stdout).toBe(dq.stdout);
      // Guard against both being empty, which would match trivially.
      expect(dq.stdout).toContain("alpha");
    });
  });
});

/** Two views sharing a name, plus an archived one. */
const QUERIES_YAML = `queries:
  - id: 01M0AAAAAAAAAAAAAAAAAAAAA1
    name: overdue
    query: due_date < today
    sort:
      - field: priority
        direction: desc
  - id: 01M0AAAAAAAAAAAAAAAAAAAAA2
    name: overdue
    query: status = backlog
  - id: 01M0AAAAAAAAAAAAAAAAAAAAA3
    name: retired
    query: status = done
    archived: true
`;

describe("saved views are addressable (QRY-C6)", () => {
  it("exposes id, sort and archived through list_views", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/config/queries.yaml"), QUERIES_YAML, "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_views", {});
        const views = JSON.parse(result.content[0]?.text ?? "[]") as Array<{
          id?: string;
          name: string;
          sort?: unknown;
          archived?: boolean;
        }>;

        expect(views).toHaveLength(3);
        // Without ids the two `overdue` views are the same entry twice.
        const overdue = views.filter(v => v.name === "overdue");
        expect(overdue).toHaveLength(2);
        expect(overdue[0]?.id).not.toBe(overdue[1]?.id);
        expect(overdue.every(v => typeof v.id === "string")).toBe(true);

        expect(views.find(v => v.id === "01M0AAAAAAAAAAAAAAAAAAAAA1")?.sort).toBeDefined();
        expect(views.find(v => v.name === "retired")?.archived).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("reports a missing queries.yaml as no views, not an error", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_views", {});
        expect(result.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  it("refuses an ambiguous view name instead of running one of them", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/config/queries.yaml"), QUERIES_YAML, "utf8");
      await runCli(["create", "alpha"], { cwd: root });

      const result = await runCli(["list", "--view", "overdue"], { cwd: root });
      // The failure being fixed: exit 0 with results from whichever
      // entry happened to come first, and nothing saying so.
      expect(result.exitCode).not.toBe(0);
      const text = `${result.stdout}${result.stderr}`;
      expect(text).toMatch(/multiple views named/);
      // Both ids, so the suggested fallback is actionable.
      expect(text).toContain("01M0AAAAAAAAAAAAAAAAAAAAA1");
      expect(text).toContain("01M0AAAAAAAAAAAAAAAAAAAAA2");
    });
  });

  it("runs a view addressed by id", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/config/queries.yaml"), QUERIES_YAML, "utf8");
      await runCli(["create", "alpha"], { cwd: root });

      const result = await runCli(
        ["list", "--view", "01M0AAAAAAAAAAAAAAAAAAAAA2"],
        { cwd: root },
      );
      // The id is the documented escape hatch from ambiguity, and it
      // used to be rejected outright as an unknown view.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alpha");
    });
  });

  it("still resolves an unambiguous name", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/config/queries.yaml"), QUERIES_YAML, "utf8");
      await runCli(["create", "alpha"], { cwd: root });

      // Guards the fix from over-reaching: names must keep working when
      // they are unique.
      const result = await runCli(["list", "--view", "retired"], { cwd: root });
      expect(result.exitCode).toBe(0);
    });
  });
});

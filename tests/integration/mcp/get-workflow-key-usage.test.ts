import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

async function addNumberField(root: string): Promise<void> {
  const wfPath = path.join(root, ".loctt", "config", "workflow.yaml");
  const yaml = await readFile(wfPath, "utf8");
  await writeFile(
    wfPath,
    yaml.replace(
      /^custom_fields: \[\]$/m,
      [
        "custom_fields:",
        "  - key: story_points",
        "    label: Story points",
        "    type: number",
        "    multi: false",
        "    searchable: false",
      ].join("\n"),
    ),
    "utf8",
  );
}

/** Writes a numeric field value into a task's frontmatter directly. */
async function setNumberFieldOnTask(
  root: string, taskKey: string, field: string, value: number,
): Promise<void> {
  const taskDir = path.join(root, ".loctt", "tasks");
  for (const dir of await readdir(taskDir)) {
    const file = path.join(taskDir, dir, "task.md");
    const md = await readFile(file, "utf8");
    if (!new RegExp(`^key: ${taskKey}$`, "m").test(md)) continue;
    await writeFile(
      file,
      md.replace(/\n---\n/, `\nfields:\n  ${field}: ${String(value)}\n---\n`),
      "utf8",
    );
    return;
  }
  throw new Error(`task ${taskKey} not found`);
}

/**
 * `get_workflow_key_usage` — the MCP half of core's
 * `computeWorkflowKeyCounts`.
 *
 * An agent asked to "clean up unused statuses" has no other way to
 * tell an unreferenced key from one nine tasks hold, and deleting the
 * second without a remap is refused by `applyWorkflowEdit` — so this
 * is what turns a blind edit into an informed one.
 */
describe("MCP get_workflow_key_usage (stdio)", () => {
  it("returns per-key task counts across every workflow collection", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "c"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_key_usage", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
          statuses: Record<string, number>;
          priorities: Record<string, number>;
          task_types: Record<string, number>;
          relationships: Record<string, number>;
          custom_field_values: Record<string, Record<string, number>>;
        };

        // Counts, not presence. A `1` here for `in_progress` would tell
        // an agent a two-task deletion was a one-task one.
        expect(parsed.statuses["in_progress"]).toBe(2);
        expect(parsed.statuses["backlog"]).toBe(1);
        // A key nothing references is absent, which is the documented
        // reading of "no tasks hold this".
        expect(parsed.statuses["done"]).toBeUndefined();

        // Every collection is present, so an agent can rely on the
        // shape without guarding each field.
        expect(parsed.priorities).toBeDefined();
        expect(parsed.task_types).toBeDefined();
        expect(parsed.relationships).toBeDefined();
        expect(parsed.custom_field_values).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  it("reports custom_fields totals covering number fields with no enum values", async () => {
    await withTmpLoctt(async ({ root }) => {
      await addNumberField(root);
      const a = await runCli(["create", "a"], { cwd: root });
      const keyA = /T-\d+/.exec(a.stdout + a.stderr)?.[0] as string;
      await setNumberFieldOnTask(root, keyA, "story_points", 5);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_key_usage", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
          custom_field_values: Record<string, Record<string, number>>;
          custom_fields: Record<string, number>;
        };
        // The whole-field blast radius covers a number field the per-value
        // table cannot: `custom_field_values.story_points` is empty (no enum
        // values), but one task holds the field.
        expect(parsed.custom_fields["story_points"]).toBe(1);
      } finally {
        await client.close();
      }
    });
  });

  it("agrees with the CLI's `config usage` on the same tracker", async () => {
    // P10: two surfaces must not answer the same question differently.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b"], { cwd: root });

      const cli = await runCli(["config", "usage"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_key_usage", {});
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
          statuses: Record<string, number>;
        };
        for (const [key, count] of Object.entries(parsed.statuses)) {
          expect(cli.stdout).toContain(`${key} = ${String(count)}`);
        }
      } finally {
        await client.close();
      }
    });
  });
});

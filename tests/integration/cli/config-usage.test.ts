import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/** Adds a number custom field to the tracker's workflow.yaml. */
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

/**
 * Writes a numeric value into a task's `fields` frontmatter directly.
 * `loctt set` takes strings and a number field rejects "5", so — as the
 * web flow spec does through the API — this stores the number itself.
 */
async function setNumberFieldOnTask(
  root: string, taskKey: string, field: string, value: number,
): Promise<void> {
  const taskDir = path.join(root, ".loctt", "tasks");
  for (const dir of await readdir(taskDir)) {
    const file = path.join(taskDir, dir, "task.md");
    const md = await readFile(file, "utf8");
    if (!new RegExp(`^key: ${taskKey}$`, "m").test(md)) continue;
    // Insert into the frontmatter block (between the two `---` fences).
    const fm = md.replace(
      /\n---\n/,
      `\nfields:\n  ${field}: ${String(value)}\n---\n`,
    );
    await writeFile(file, fm, "utf8");
    return;
  }
  throw new Error(`task ${taskKey} not found`);
}

/**
 * `loctt config usage` — the CLI half of core's
 * `computeWorkflowKeyCounts`, which the web settings panels reach
 * through `GET /api/workflow/usage` and MCP through
 * `get_workflow_key_usage`.
 *
 * The question it answers is the one a user asks immediately before
 * editing `workflow.yaml`: deleting a status that nine tasks hold is a
 * different decision from deleting one nothing references.
 */
describe("CLI config usage (spawned binary)", () => {
  it("reports task counts per workflow key, not merely which keys exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "c"], { cwd: root });

      const result = await runCli(["config", "usage"], { cwd: root });

      expect(result.exitCode).toBe(0);
      // The number, which is the whole point — a presence-only report
      // would say "in_progress" with no count and leave the user to
      // grep the tasks themselves.
      expect(result.stdout).toMatch(/in_progress = 2/);
      expect(result.stdout).toMatch(/backlog = 1/);
      // Every collection is reported, so an empty one is visibly empty
      // rather than absent.
      for (const section of ["statuses", "priorities", "task_types", "relationships", "custom_fields"]) {
        expect(result.stdout).toContain(section);
      }
    });
  });

  it("reports the whole-field blast radius for a number field, not 0", async () => {
    // A number/boolean field has no enum values, so a per-value report
    // drops it entirely — the delete-confirm "affects nothing" lie. The
    // field total must surface the real count of tasks holding it.
    await withTmpLoctt(async ({ root }) => {
      await addNumberField(root);
      const a = await runCli(["create", "a"], { cwd: root });
      const b = await runCli(["create", "b"], { cwd: root });
      const keyA = /T-\d+/.exec(a.stdout + a.stderr)?.[0] as string;
      const keyB = /T-\d+/.exec(b.stdout + b.stderr)?.[0] as string;
      await setNumberFieldOnTask(root, keyA, "story_points", 5);
      await setNumberFieldOnTask(root, keyB, "story_points", 8);

      const result = await runCli(["config", "usage"], { cwd: root });
      expect(result.exitCode).toBe(0);
      // The field total — two tasks hold it. Absent this, a number field
      // in use printed nothing under custom_fields.
      expect(result.stdout).toMatch(/story_points = 2/);
    });
  });

  it("says a collection is unreferenced rather than printing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      const result = await runCli(["config", "usage"], { cwd: root });

      expect(result.exitCode).toBe(0);
      // A blank section reads as truncated output; "(none referenced)"
      // is an answer.
      expect(result.stdout).toContain("(none referenced)");
    });
  });

  it("is listed in --help, so it is discoverable", async () => {
    await withTmpLoctt(async ({ root }) => {
      const help = await runCli(["--help"], { cwd: root });
      expect(help.stdout + help.stderr).toContain("config usage");
    });
  });
});

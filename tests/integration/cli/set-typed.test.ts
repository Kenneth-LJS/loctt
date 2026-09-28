import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * G2, G3: `loctt set` converts its text value by the field's type. The
 * runthrough pins the stored values on the seed; this pins the surface
 * mechanics it can't: the `fields.<key>` spelling, the refusals' text
 * and exit code, bulk, and label names vs IDs.
 */
async function frontmatter(root: string): Promise<string> {
  const dir = path.join(root, ".loctt/tasks");
  const [id] = await readdir(dir);
  return readFile(path.join(dir, String(id), "task.md"), "utf-8");
}

async function withFields(fn: (root: string) => Promise<void>): Promise<void> {
  await withTmpLoctt(async ({ root }) => {
    await runCli(["custom-field", "add", "risk", "--label", "Risk", "--type", "number"], { cwd: root });
    await runCli(["custom-field", "add", "signed_off", "--label", "Signed off", "--type", "boolean"], { cwd: root });
    await runCli(["custom-field", "add", "tags", "--label", "Tags", "--type", "string", "--multi"], { cwd: root });
    await runCli(["create", "one"], { cwd: root });
    await fn(root);
  });
}

// @verifies TSK-C10
describe("loctt set converts values by field type (G2)", () => {
  it("stores a number, a boolean and a multi field as typed values", async () => {
    await withFields(async root => {
      expect((await runCli(["set", "T-1", "risk", "2.5"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["set", "T-1", "signed_off", "yes"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["set", "T-1", "tags", "a, b,,c"], { cwd: root })).exitCode).toBe(0);
      const fm = await frontmatter(root);
      expect(fm).toMatch(/^ {2}risk: 2\.5$/m);
      expect(fm).toMatch(/^ {2}signed_off: true$/m);
      expect(fm).toMatch(/^ {2}tags:\n {4}- a\n {4}- b\n {4}- c$/m);
    });
  });

  it("accepts the fields.<key> spelling", async () => {
    await withFields(async root => {
      const res = await runCli(["set", "T-1", "fields.risk", "5"], { cwd: root });
      expect(res.exitCode, res.stderr).toBe(0);
      expect(await frontmatter(root)).toMatch(/^ {2}risk: 5$/m);
    });
  });

  it("refuses a value that isn't a number or a boolean, and changes nothing", async () => {
    await withFields(async root => {
      const before = await frontmatter(root);
      const num = await runCli(["set", "T-1", "risk", "high"], { cwd: root });
      expect(num.exitCode).toBe(1);
      expect(num.stderr).toContain(`risk takes a number, not "high".`);
      const bool = await runCli(["set", "T-1", "signed_off", "maybe"], { cwd: root });
      expect(bool.exitCode).toBe(1);
      expect(bool.stderr).toContain(`signed_off takes true or false, not "maybe".`);
      expect(await frontmatter(root)).toBe(before);
    });
  });

  it("converts once for a bulk set", async () => {
    await withFields(async root => {
      await runCli(["create", "two"], { cwd: root });
      const res = await runCli(["set", "T-1,T-2", "risk", "3"], { cwd: root });
      expect(res.exitCode, res.stderr).toBe(0);
      const dir = path.join(root, ".loctt/tasks");
      for (const id of await readdir(dir)) {
        expect(await readFile(path.join(dir, id, "task.md"), "utf-8")).toMatch(/^ {2}risk: 3$/m);
      }
    });
  });
});

// @verifies TSK-C11
describe("loctt set changes a task's labels (G3)", () => {
  it("replaces the labels with a comma list of names or IDs", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["label", "create", "frontend"], { cwd: root });
      await runCli(["label", "create", "infra"], { cwd: root });
      await runCli(["create", "one", "--label", "frontend"], { cwd: root });
      const labels = await readFile(path.join(root, ".loctt/config/labels.yaml"), "utf-8");
      const infraId = /id: (\S+)\n\s+name: infra/.exec(labels)?.[1];
      expect(infraId, labels).toBeDefined();

      const res = await runCli(["set", "T-1", "labels", `frontend,${String(infraId)}`], { cwd: root });
      expect(res.exitCode, res.stderr).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toMatch(/^Labels: frontend, infra$/m);

      // Replace, not add: the list given is the list stored.
      await runCli(["set", "T-1", "labels", "infra"], { cwd: root });
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toMatch(/^Labels: infra$/m);
    });
  });
});

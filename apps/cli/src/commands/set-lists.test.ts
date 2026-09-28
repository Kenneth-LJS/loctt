/**
 * K150 / B45: `loctt set <task> <field> --add … --remove … [--create]`,
 * and `custom-field add|edit --allow-new-values`.
 *
 * @verifies TSK-C14 TSK-C15 CFG-C6
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadLabelsConfig, loadWorkflowConfig, lookupByKey, resolveLocttDir } from "@loctt/core";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../index.js";
import { parseSetListFlags } from "../runtime/set-value.js";

describe("parseSetListFlags", () => {
  it("collects every word after --add/--remove up to the next flag, splitting commas", () => {
    const f = parseSetListFlags(["set", "T-1", "labels", "--add", "a", "b,c", "--remove", "d", "--create", "--add=e"]);
    expect(f.add).toEqual(["a", "b", "c", "e"]);
    expect(f.remove).toEqual(["d"]);
    expect(f.value).toBeUndefined();
  });

  it("reads the replace-form value as the third positional", () => {
    expect(parseSetListFlags(["set", "T-1", "labels", "a,b", "--create"]).value).toBe("a,b");
    expect(parseSetListFlags(["set", "T-1", "risk", "-5"]).value).toBe("-5");
  });
});

describe("loctt set --add/--remove/--create", () => {
  let root: string;
  let log: MockInstance;
  let err: MockInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-lists-"));
    vi.spyOn(process, "cwd").mockImplementation(() => root);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await initLoctt(root, { docs: false, timezone: "UTC" });
    for (const argv of [
      ["label", "create", "bug"],
      ["label", "create", "infra"],
      ["custom-field", "add", "platforms", "--label", "Platforms", "--type", "enum", "--multi",
        "--enum-value", "ios=iOS", "--enum-value", "android=Android"],
      ["create", "one"],
    ]) await run(argv);
    process.exitCode = undefined;
    log.mockClear();
    err.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function run(argv: string[]): Promise<void> {
    process.argv = ["node", "loctt", ...argv];
    await main();
  }
  const out = (): string => log.mock.calls.map(c => String(c[0] ?? "")).join("\n");
  const errOut = (): string => err.mock.calls.map(c => String(c[0] ?? "")).join("\n");
  const locttDir = (): string => resolveLocttDir(root);
  const labelId = async (name: string): Promise<string> =>
    (await loadLabelsConfig(locttDir())).labels.find(l => l.name === name)?.id as string;

  it("adds labels by name to the current list, then removes one", async () => {
    await run(["set", "T-1", "labels", "--add", "bug", "infra"]);
    expect(process.exitCode).toBeUndefined();
    expect(out()).toContain("Updated labels on T-1: added bug, infra");
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels)
      .toEqual([await labelId("bug"), await labelId("infra")]);
    await run(["set", "T-1", "labels", "--remove", "bug"]);
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toEqual([await labelId("infra")]);
  });

  it("says so, and writes nothing, when the edit changes nothing", async () => {
    await run(["set", "T-1", "labels", "--add", "bug"]);
    const path = join(locttDir(), "tasks", (await lookupByKey(locttDir(), "T-1")).frontmatter.id, "task.md");
    const before = await readFile(path, "utf-8");
    log.mockClear();
    await run(["set", "T-1", "labels", "--add", "bug", "--remove", "infra"]);
    expect(process.exitCode).toBeUndefined();
    expect(out()).toContain("No change to labels on T-1");
    expect(await readFile(path, "utf-8")).toBe(before);
  });

  it("refuses an unknown label, pointing at --create, exit 1", async () => {
    await run(["set", "T-1", "labels", "--add", "urgent"]);
    expect(process.exitCode).toBe(1);
    expect(errOut()).toContain("No label named 'urgent'. Pass --create to create it.");
    expect(await labelId("urgent")).toBeUndefined();
  });

  it("creates an unknown label with --create", async () => {
    await run(["set", "T-1", "labels", "--add", "urgent", "--create"]);
    expect(process.exitCode).toBeUndefined();
    expect(out()).toContain("Created label urgent");
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toEqual([await labelId("urgent")]);
  });

  it("edits a multi choice field by value label, and grows it only when the field allows new values", async () => {
    await run(["set", "T-1", "fields.platforms", "--add", "iOS"]);
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.fields?.["platforms"]).toEqual(["ios"]);

    await run(["set", "T-1", "platforms", "--add", "Windows", "--create"]);
    expect(process.exitCode).toBe(1);
    expect(errOut()).toContain("platforms does not allow new values");
    process.exitCode = undefined;

    await run(["custom-field", "edit", "platforms", "--allow-new-values"]);
    expect((await loadWorkflowConfig(locttDir())).custom_fields.find(f => f.key === "platforms")?.allow_new_values)
      .toBe(true);
    await run(["set", "T-1", "platforms", "--add", "Windows"]);
    expect(errOut()).toContain("No platforms value named 'Windows'. Pass --create to create it.");
    process.exitCode = undefined;
    log.mockClear();

    await run(["set", "T-1", "platforms", "--add", "Windows", "--create"]);
    expect(process.exitCode).toBeUndefined();
    expect(out()).toContain("Created platforms value Windows (key windows)");
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.fields?.["platforms"]).toEqual(["ios", "windows"]);
  });

  it("the replace form still works, and takes --create", async () => {
    await run(["set", "T-1", "labels", "bug,infra"]);
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toHaveLength(2);
    await run(["set", "T-1", "labels", "bug,brand-new", "--create"]);
    expect(process.exitCode).toBeUndefined();
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels)
      .toEqual([await labelId("bug"), await labelId("brand-new")]);
  });

  // K152 superseded half of this test: it also asserted that `--add` on
  // several tasks was a usage error (exit 2). That is now a bulk edit
  // (TSK-C16, below). A replace value with --create on several tasks is
  // still refused.
  it("refuses a value together with --add, and --create with a value on several tasks, as usage (exit 2)", async () => {
    await run(["set", "T-1", "labels", "bug", "--add", "infra"]);
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
    await run(["create", "two"]);
    await run(["set", "T-1,T-2", "labels", "bug", "--create"]);
    expect(process.exitCode).toBe(2);
  });

  // @verifies TSK-C16
  describe("on several tasks (K152)", () => {
    beforeEach(async () => {
      await run(["create", "two"]);
      await run(["set", "T-1", "labels", "bug"]);
      process.exitCode = undefined;
      log.mockClear();
      err.mockClear();
    });

    it("adds to each task's own list in one operation and names the no-op", async () => {
      await run(["set", "T-1,T-2", "labels", "--add", "bug"]);
      expect(process.exitCode).toBeUndefined();
      const bug = await labelId("bug");
      expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toEqual([bug]);
      expect((await lookupByKey(locttDir(), "T-2")).frontmatter.labels).toEqual([bug]);
      expect(out()).toContain("Updated labels (added bug) on 2 task(s) (1 already in that state)");
    });

    // K153 superseded this test's K152 form, which asserted that one
    // missing ref left every task unchanged. Like bulk set, the others
    // change and the failure is listed (exit 1).
    it("changes the tasks it can and lists the missing ref, exit 1", async () => {
      await run(["set", "T-1,T-2,T-99", "labels", "--add", "infra"]);
      expect(process.exitCode).toBe(1);
      expect(out()).toContain("Updated labels (added infra) on 2 task(s)");
      expect(errOut()).toContain("1 failed:");
      expect(errOut()).toContain("T-99: task not found");
      expect((await lookupByKey(locttDir(), "T-2")).frontmatter.labels).toEqual([await labelId("infra")]);
    });

    it("refuses an unknown label once with the --create hint, and creates it with --create", async () => {
      await run(["set", "T-1,T-2", "labels", "--add", "brand-new"]);
      expect(process.exitCode).toBe(1);
      expect(errOut()).toContain("Pass --create to create it.");
      process.exitCode = undefined;
      await run(["set", "T-1,T-2", "labels", "--add", "brand-new", "--create"]);
      expect(process.exitCode).toBeUndefined();
      const id = await labelId("brand-new");
      expect((await lookupByKey(locttDir(), "T-2")).frontmatter.labels).toEqual([id]);
    });
  });

  it("custom-field add --allow-new-values makes an open field; refused on a non-enum type", async () => {
    await run(["custom-field", "add", "area", "--label", "Area", "--type", "enum",
      "--enum-value", "ui=UI", "--allow-new-values"]);
    expect((await loadWorkflowConfig(locttDir())).custom_fields.find(f => f.key === "area")?.allow_new_values)
      .toBe(true);
    await run(["custom-field", "add", "team", "--label", "Team", "--type", "string", "--allow-new-values"]);
    expect(process.exitCode).toBe(1);
    expect(errOut()).toContain("Only a choice (enum) field can allow new values");
  });
});

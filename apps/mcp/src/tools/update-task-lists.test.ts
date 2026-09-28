/**
 * K150 / B45: MCP `update_task` `add` / `remove` / `create_missing`, and
 * `edit_workflow_entity` `allow_new_values`.
 *
 * @verifies TSK-C14 TSK-C15 CFG-C6
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadLabelsConfig, loadWorkflowConfig, lookupByKey, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../index.js";

describe("update_task add/remove/create_missing (K150)", () => {
  let root: string;
  const locttDir = (): string => resolveLocttDir(root);
  const text = (r: { content: { text?: string }[] }): string => r.content[0]?.text ?? "";
  const labelId = async (name: string): Promise<string | undefined> =>
    (await loadLabelsConfig(locttDir())).labels.find(l => l.name === name)?.id;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-lists-"));
    await initLoctt(root, { docs: false, timezone: "UTC" });
    await executeTool(root, "create_label", { name: "bug" });
    await executeTool(root, "create_label", { name: "infra" });
    await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "create", key: "platforms",
      fields: { label: "Platforms", type: "enum", multi: true, values: [{ key: "ios", label: "iOS" }] },
    });
    await executeTool(root, "create_task", { title: "one" });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("adds and removes labels on the current list, by name", async () => {
    const r = await executeTool(root, "update_task", { ref: "T-1", add: { labels: ["bug", "infra"] } });
    expect(r.isError).toBeUndefined();
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels)
      .toEqual([await labelId("bug"), await labelId("infra")]);
    await executeTool(root, "update_task", { ref: "T-1", remove: { labels: ["bug"] } });
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toEqual([await labelId("infra")]);
  });

  it("reports a no-op as such", async () => {
    const r = await executeTool(root, "update_task", { ref: "T-1", remove: { labels: ["bug"] } });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toMatch(/^No change to T-1/);
  });

  it("refuses an unknown label, naming create_missing; creates it with create_missing: true", async () => {
    const refused = await executeTool(root, "update_task", { ref: "T-1", add: { labels: ["urgent"] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("No label named 'urgent'. Pass create_missing: true to create it.");
    expect(await labelId("urgent")).toBeUndefined();

    const created = await executeTool(root, "update_task", {
      ref: "T-1", add: { labels: ["urgent"] }, create_missing: true,
    });
    expect(created.isError).toBeUndefined();
    expect(text(created)).toContain("Created label urgent");
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.labels).toEqual([await labelId("urgent")]);
  });

  it("grows a choice field only once allow_new_values is on", async () => {
    const closed = await executeTool(root, "update_task", {
      ref: "T-1", add: { platforms: ["Windows"] }, create_missing: true,
    });
    expect(closed.isError).toBe(true);
    expect(text(closed)).toContain("platforms does not allow new values");

    await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "edit", key: "platforms", fields: { allow_new_values: true },
    });
    const def = (await loadWorkflowConfig(locttDir())).custom_fields.find(f => f.key === "platforms");
    expect(def?.allow_new_values).toBe(true);

    const open = await executeTool(root, "update_task", {
      ref: "T-1", add: { platforms: ["Windows", "iOS"] }, create_missing: true,
    });
    expect(open.isError).toBeUndefined();
    expect((await lookupByKey(locttDir(), "T-1")).frontmatter.fields?.["platforms"]).toEqual(["windows", "ios"]);
  });

  it("combines a replace of one field with an edit of another in one write", async () => {
    const r = await executeTool(root, "update_task", {
      ref: "T-1", field: "priority", value: "high", add: { labels: ["bug"] },
    });
    expect(r.isError).toBeUndefined();
    const t = await lookupByKey(locttDir(), "T-1");
    expect(t.frontmatter.priority).toBe("high");
    expect(t.frontmatter.labels).toEqual([await labelId("bug")]);
  });

  it("refuses a call with neither field nor add/remove, and an immutable list field", async () => {
    const none = await executeTool(root, "update_task", { ref: "T-1" });
    expect(none.isError).toBe(true);
    expect(text(none)).toContain("Pass `field` and `value`");
    const bad = await executeTool(root, "update_task", { ref: "T-1", add: { relationships: ["x"] } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("immutable field \"relationships\"");
  });
});

// @verifies TSK-C16
describe("bulk_update_tasks add/remove/create_missing (K152, K153)", () => {
  let root: string;
  const locttDir = (): string => resolveLocttDir(root);
  const text = (r: { content: { text?: string }[] }): string => r.content[0]?.text ?? "";
  const labelId = async (name: string): Promise<string | undefined> =>
    (await loadLabelsConfig(locttDir())).labels.find(l => l.name === name)?.id;
  const labelsOf = async (key: string): Promise<unknown> => (await lookupByKey(locttDir(), key)).frontmatter.labels;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-bulk-lists-"));
    await initLoctt(root, { docs: false, timezone: "UTC" });
    await executeTool(root, "create_label", { name: "bug" });
    await executeTool(root, "create_task", { title: "one" });
    await executeTool(root, "create_task", { title: "two" });
    await executeTool(root, "update_task", { ref: "T-1", add: { labels: ["bug"] } });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("adds to each task's own list, reporting the no-op and one bulk_op_id", async () => {
    const r = await executeTool(root, "bulk_update_tasks", { refs: ["T-1", "T-2"], add: { labels: ["bug"] } });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toMatch(/^1 updated, 1 unchanged, 0 failed \(bulk_op_id \S+\)$/);
    const bug = await labelId("bug");
    expect(await labelsOf("T-1")).toEqual([bug]);
    expect(await labelsOf("T-2")).toEqual([bug]);
  });

  // K153 superseded this test's K152 form, which asserted one bad ref
  // left every task unchanged. Like the set form, the rest change and the
  // failure is listed.
  it("changes the tasks it can and lists the ref that failed", async () => {
    const r = await executeTool(root, "bulk_update_tasks", { refs: ["T-1", "T-2", "T-9"], remove: { labels: ["bug"] } });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toMatch(/^1 updated, 1 unchanged, 1 failed \(bulk_op_id \S+\)\n  T-9: task not found$/);
    expect(await labelsOf("T-1")).toEqual([]);
  });

  it("refuses an unknown label naming create_missing, and creates it once with it", async () => {
    const refused = await executeTool(root, "bulk_update_tasks", { refs: ["T-1", "T-2"], add: { labels: ["urgent"] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("Pass create_missing: true to create it.");
    const ok = await executeTool(root, "bulk_update_tasks", {
      refs: ["T-1", "T-2"], add: { labels: ["urgent"] }, create_missing: true,
    });
    expect(ok.isError).toBeUndefined();
    const urgent = await labelId("urgent");
    expect(await labelsOf("T-2")).toEqual([urgent]);
    expect((await loadLabelsConfig(locttDir())).labels.filter(l => l.name === "urgent")).toHaveLength(1);
  });

  it("refuses field together with add/remove, and neither", async () => {
    const both = await executeTool(root, "bulk_update_tasks", {
      refs: ["T-1"], field: "priority", value: "high", add: { labels: ["bug"] },
    });
    expect(both.isError).toBe(true);
    const none = await executeTool(root, "bulk_update_tasks", { refs: ["T-1"] });
    expect(none.isError).toBe(true);
  });
});

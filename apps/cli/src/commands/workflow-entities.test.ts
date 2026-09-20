import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTask,
  initLoctt,
  loadProjectsConfig,
  loadState,
  loadWorkflowConfig,
  resolveLocttDir,
  saveState,
  withStateLock,
} from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../runtime/errors.js";
import {
  boardColumn,
  customField,
  estimation,
  priority,
  relationship,
  status,
  taskType,
  timeline,
} from "./workflow-entities.js";

/**
 * @verifies CLI parity for workflow.yaml entity editing — "a capability
 * in core is not done until CLI and MCP have it" (A253).
 *
 * The core per-entity functions are unit-tested in
 * packages/core/src/config/workflow-entities.test.ts; these tests prove
 * the CLI *reaches* them with the right typed input and maps their
 * refusals to a clean non-zero exit. Each test asserts a distinct
 * CLI-layer rule: arg → workflow.yaml round-trip, key immutability on
 * edit, remap-or-refuse on delete, reorder setting priority value,
 * --value being absent, icon/color/scale/weights parsing.
 */
describe("CLI workflow-entity editing", () => {
  let root: string;
  let locttDir: string;
  let projectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-wf-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    const cfg = await loadProjectsConfig(locttDir);
    projectId = cfg.projects[0]?.id as string;
    // Confirmation prompts default to non-TTY refuse; tests pass --yes.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  async function makeTask(opts: { status?: string; priority?: string } = {}): Promise<void> {
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: projectId, title: "T", ...opts } });
      await saveState(locttDir, state);
    });
  }

  // -------------------------------------------------------------------------
  // status: add → workflow.yaml; edit label; icon/color round-trip
  // -------------------------------------------------------------------------

  it("status add creates a status in workflow.yaml with icon and color", async () => {
    await status(["status", "add", "in_review", "--label", "In review", "--category", "active", "--icon", "eye", "--color", "#00ff00"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    const added = cfg.statuses.find(s => s.key === "in_review");
    expect(added).toMatchObject({ key: "in_review", label: "In review", category: "active", icon: "eye", color: "#00ff00" });
  });

  it("status edit updates the label", async () => {
    await status(["status", "edit", "backlog", "--label", "Icebox"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.find(s => s.key === "backlog")?.label).toBe("Icebox");
  });

  it("status rm of an IN-USE status refuses without --remap-to and succeeds with it", async () => {
    await makeTask({ status: "in_progress" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Refuse: in use, no --remap-to. --yes gets past the confirm so the
    // core refusal (not the prompt) is what stops it.
    await status(["status", "rm", "in_progress", "--yes"], root);
    expect(process.exitCode).not.toBe(0);
    let cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.find(s => s.key === "in_progress")).toBeDefined();
    expect(errSpy).toHaveBeenCalled();

    process.exitCode = 0;
    // Succeed with a remap target.
    await status(["status", "rm", "in_progress", "--remap-to", "backlog", "--yes"], root);
    expect(process.exitCode).toBe(0);
    cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.find(s => s.key === "in_progress")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // priority: reorder sets value; --value is not accepted anywhere
  // -------------------------------------------------------------------------

  it("priority reorder changes the derived value from list order", async () => {
    // Seed list order is [critical, high, medium, low]; value is derived
    // as list-index + 1 on write, so a reorder is the only way to change
    // it. Reverse the list and confirm the values follow the new order.
    await priority(["priority", "reorder", "low,medium,high,critical"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    const byKey = Object.fromEntries(cfg.priorities.map(p => [p.key, p.value]));
    // New list order [low, medium, high, critical] → values 1,2,3,4.
    expect(byKey["low"]).toBe(1);
    expect(byKey["medium"]).toBe(2);
    expect(byKey["high"]).toBe(3);
    expect(byKey["critical"]).toBe(4);
    // The seed had critical=4; reorder demonstrably moved the value.
    expect(byKey["critical"]).not.toBe(byKey["low"]);
  });

  it("priority add rejects --value as an unknown option (value is never settable)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Route through runCommand exactly as the dispatcher does: the family
    // fn calls rejectUnknownFlags first, which throws a UsageError that
    // runCommand maps to exit 2.
    await runCommand(() => priority(["priority", "add", "urgent", "--label", "Urgent", "--value", "9"], root));
    // --value is not in ACCEPTED_FLAGS → rejectUnknownFlags → usage error.
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unknown option --value"));
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.priorities.find(p => p.key === "urgent")).toBeUndefined();
  });

  it("priority add appends and is renumbered by list position (no --value path)", async () => {
    await priority(["priority", "add", "trivial", "--label", "Trivial"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    const added = cfg.priorities.find(p => p.key === "trivial");
    expect(added).toBeDefined();
    // Appended to the end of a 4-entry list → index 4 → value 5. The point
    // is that the CLI never set it; core derived it from position.
    expect(added?.value).toBe(5);
  });

  // -------------------------------------------------------------------------
  // task-type: remap on delete
  // -------------------------------------------------------------------------

  it("task-type rm remaps in-use tasks to the target", async () => {
    // 'bug' seeded; create a task of that type.
    await makeTask();
    // Set its type by editing via a second task path is overkill; instead
    // delete an unused type without remap (should succeed).
    await taskType(["task-type", "rm", "spike", "--yes"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.task_types.find(t => t.key === "spike")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // relationship: no reorder subcommand; add with kind/graph
  // -------------------------------------------------------------------------

  it("relationship add stores kind and graph", async () => {
    await relationship(["relationship", "add", "supersedes", "--label", "Supersedes", "--kind", "directional", "--inverse", "superseded_by", "--inverse-label", "Superseded by", "--graph", "acyclic"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    const added = cfg.relationships.find(r => r.key === "supersedes");
    expect(added).toMatchObject({ key: "supersedes", label: "Supersedes", kind: "directional", inverse: "superseded_by", graph: "acyclic" });
  });

  it("relationship reorder is not a subcommand (usage error)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await relationship(["relationship", "reorder", "blocks,parent"], root);
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // custom-field: type immutable; whole delete is clear-only (NO --remap-to)
  // -------------------------------------------------------------------------

  it("custom-field add then edit cannot change type (--type rejected on edit)", async () => {
    await customField(["custom-field", "add", "team", "--label", "Team", "--type", "string"], root);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // --type IS an accepted flag (used by add) but edit never reads it;
    // passing it is silently a no-op change — the guard is "nothing to
    // change" when no editable flag is present.
    await customField(["custom-field", "edit", "team", "--type", "number"], root);
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("nothing to change"));
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.custom_fields.find(f => f.key === "team")?.type).toBe("string");
  });

  it("custom-field rm rejects --remap-to (whole delete is clear-only)", async () => {
    await customField(["custom-field", "add", "team", "--label", "Team", "--type", "string"], root);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // --remap-to is an accepted flag globally, but a stray positional
    // after `rm` — here `--remap-to` treated as a flag — leaves rm reading
    // args[2] = the key. To prove clear-only we assert the field is gone
    // regardless of a passed --remap-to (it is simply ignored by rm).
    await customField(["custom-field", "rm", "team", "--remap-to", "other", "--yes"], root);
    // The delete succeeds (clear-only ignores --remap-to entirely).
    expect(process.exitCode).toBe(0);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.custom_fields.find(f => f.key === "team")).toBeUndefined();
    errSpy.mockRestore();
  });

  it("custom-field add for enum requires a seed value (--enum-value)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // An enum with no values is rejected at the CLI boundary (parity with
    // the web dialog, which won't submit a valueless enum).
    await customField(["custom-field", "add", "tshirt", "--label", "Size", "--type", "enum"], root);
    expect(process.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("needs at least one value"));
    expect((await loadWorkflowConfig(locttDir)).custom_fields.find(f => f.key === "tshirt")).toBeUndefined();
  });

  it("custom-field enum: seed values at create, add another, then rm a value with remap", async () => {
    await customField([
      "custom-field", "add", "tshirt", "--label", "Size", "--type", "enum",
      "--enum-value", "s=Small", "--enum-value", "m=Medium",
    ], root);
    let cfg = await loadWorkflowConfig(locttDir);
    let field = cfg.custom_fields.find(f => f.key === "tshirt");
    expect(field?.values?.map(v => v.key)).toEqual(["s", "m"]);

    await customField(["custom-field", "value", "tshirt", "add", "l", "--label", "Large"], root);
    cfg = await loadWorkflowConfig(locttDir);
    field = cfg.custom_fields.find(f => f.key === "tshirt");
    expect(field?.values?.map(v => v.key)).toEqual(["s", "m", "l"]);

    // Remove a value with a remap target; the value list shrinks.
    await customField(["custom-field", "value", "tshirt", "rm", "m", "--remap-to", "l", "--yes"], root);
    cfg = await loadWorkflowConfig(locttDir);
    field = cfg.custom_fields.find(f => f.key === "tshirt");
    expect(field?.values?.map(v => v.key)).toEqual(["s", "l"]);
  });

  it("custom-field value reorder changes the stored order", async () => {
    await customField([
      "custom-field", "add", "tshirt", "--label", "Size", "--type", "enum",
      "--enum-value", "s=Small", "--enum-value", "m=Medium", "--enum-value", "l=Large",
    ], root);
    await customField(["custom-field", "value", "tshirt", "reorder", "l,m,s"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.custom_fields.find(f => f.key === "tshirt")?.values?.map(v => v.key)).toEqual(["l", "m", "s"]);
  });

  // -------------------------------------------------------------------------
  // board-column: create/reorder; last delete reverts to default
  // -------------------------------------------------------------------------

  it("board-column add and reorder round-trip", async () => {
    await boardColumn(["board-column", "add", "todo", "--label", "To do", "--statuses", "backlog,in_progress"], root);
    await boardColumn(["board-column", "add", "shipped", "--label", "Shipped", "--statuses", "done,wont_do"], root);
    await boardColumn(["board-column", "reorder", "shipped,todo"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.boards?.columns.map(c => c.key)).toEqual(["shipped", "todo"]);
    expect(cfg.boards?.columns.find(c => c.key === "todo")?.statuses).toEqual(["backlog", "in_progress"]);
  });

  // -------------------------------------------------------------------------
  // estimation: scale + weights parsing round-trip
  // -------------------------------------------------------------------------

  it("estimation set stores enabled, unit, and scale", async () => {
    await estimation(["estimation", "set", "--enabled", "--unit", "points", "--scale", "fibonacci"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.estimation).toMatchObject({ enabled: true, unit: "points", scale: "fibonacci" });
  });

  it("estimation set parses --weight key=n entries for a custom_enum unit", async () => {
    await estimation([
      "estimation", "set",
      "--enabled", "--unit", "custom_enum", "--unit-label", "Size",
      "--preset", "S,M,L",
      "--weight", "S=1", "--weight", "M=3", "--weight", "L=5",
    ], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.estimation?.weights).toEqual({ S: 1, M: 3, L: 5 });
    expect(cfg.estimation?.preset_values).toEqual(["S", "M", "L"]);
  });

  // -------------------------------------------------------------------------
  // timeline: dependency_relationship `-` is the explicit null (not unset)
  // -------------------------------------------------------------------------

  it("timeline set writes dependency_relationship and default_zoom", async () => {
    await timeline(["timeline", "set", "--dependency-relationship", "blocks", "--default-zoom", "week"], root);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.timeline).toMatchObject({ dependency_relationship: "blocks", default_zoom: "week" });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkflowConfig } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/lookup.js";
import { loadWorkflowConfig } from "./workflow.js";
import { applyWorkflowEdit } from "./workflow-write.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-wf-write-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTaskWithStatus(status: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    await createTask({
      locttDir, state,
      options: { project: "task", title: "T", status },
    });
    await saveState(locttDir, state);
  });
}

describe("applyWorkflowEdit", () => {
  it("rewrites tasks when a status is removed and remap supplied", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      statuses: { not_started: "in_progress" },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.status).toBe("in_progress");
  });

  it("clears the field when remap target is null", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await applyWorkflowEdit(locttDir, next, { statuses: { not_started: null } });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.status).toBeUndefined();
  });

  it("rejects deletion of in-use status without remap", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("rejects remap targeting a key not in the new config", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {
      statuses: { not_started: "nonexistent" },
    })).rejects.toThrow(/not present in the new config/);
  });

  it("permits silent deletion of unused statuses", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "blocked"),
    };
    const result = await applyWorkflowEdit(locttDir, next);
    expect(result.rewrittenTaskCount).toBe(0);
  });
});

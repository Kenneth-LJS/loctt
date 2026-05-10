import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSprintsConfig } from "../config/sprints.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/lookup.js";
import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  SprintError,
  unarchiveSprint,
} from "./manage.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-sprints-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function createSampleSprint(key = "s1"): Promise<void> {
  await createSprint(locttDir, {
    key,
    label: `Sprint ${key}`,
    start_date: "2026-01-01",
    end_date: "2026-01-14",
    state: "future",
  });
}

describe("createSprint validation", () => {
  it("rejects malformed start_date at the manage layer", async () => {
    await expect(
      createSprint(locttDir, {
        key: "s1",
        label: "Sprint",
        start_date: "01/01/2026",
        end_date: "2026-01-14",
        state: "future",
      }),
    ).rejects.toThrow(SprintError);
  });

  it("rejects end_date before start_date", async () => {
    await expect(
      createSprint(locttDir, {
        key: "s1",
        label: "Sprint",
        start_date: "2026-01-14",
        end_date: "2026-01-01",
        state: "future",
      }),
    ).rejects.toThrow(SprintError);
  });

  it("rejects an unknown state", async () => {
    await expect(
      createSprint(locttDir, {
        key: "s1",
        label: "Sprint",
        start_date: "2026-01-01",
        end_date: "2026-01-14",
        state: "in_progress" as never,
      }),
    ).rejects.toThrow(SprintError);
  });

  it("rejects duplicate keys", async () => {
    await createSampleSprint("s1");
    await expect(createSampleSprint("s1")).rejects.toThrow(/already exists/);
  });
});

describe("editSprint state transitions", () => {
  it("allows future -> active without force", async () => {
    await createSampleSprint("s1");
    await editSprint(locttDir, "s1", { state: "active" });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("active");
  });

  it("blocks completed -> active without force", async () => {
    await createSampleSprint("s1");
    await editSprint(locttDir, "s1", { state: "completed" });
    await expect(
      editSprint(locttDir, "s1", { state: "active" }),
    ).rejects.toThrow(/not allowed/);
  });

  it("allows completed -> active with force: true", async () => {
    await createSampleSprint("s1");
    await editSprint(locttDir, "s1", { state: "completed" });
    await editSprint(locttDir, "s1", { state: "active", force: true });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("active");
  });

  it("treats no-op state changes as fine even when completed", async () => {
    await createSampleSprint("s1");
    await editSprint(locttDir, "s1", { state: "completed" });
    // Re-applying the same state is a no-op, not a transition.
    await editSprint(locttDir, "s1", { state: "completed" });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("completed");
  });

  it("rejects an edit that would put end_date before start_date", async () => {
    await createSampleSprint("s1");
    await expect(
      editSprint(locttDir, "s1", { end_date: "2025-12-31" }),
    ).rejects.toThrow(SprintError);
  });
});

describe("archiveSprint / unarchiveSprint", () => {
  it("sets archived: true and is reversible", async () => {
    await createSampleSprint("s1");
    await archiveSprint(locttDir, "s1");
    let cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);

    await unarchiveSprint(locttDir, "s1");
    cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBeUndefined();
  });

  it("is a no-op when already in the target state", async () => {
    await createSampleSprint("s1");
    await archiveSprint(locttDir, "s1");
    await archiveSprint(locttDir, "s1");
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);
  });

  it("throws on unknown sprint", async () => {
    await expect(archiveSprint(locttDir, "nope")).rejects.toThrow(SprintError);
    await expect(unarchiveSprint(locttDir, "nope")).rejects.toThrow(SprintError);
  });
});

describe("deleteSprint (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    await createSampleSprint("s1");
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", sprint: "s1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, "s1");
    expect(result.affectedTaskCount).toBe(0);

    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);

    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBe("s1");
  });

  it("rejects --remap-to without --hard", async () => {
    await createSampleSprint("s1");
    await createSampleSprint("s2");
    await expect(
      deleteSprint(locttDir, "s1", { remapTo: "s2" }),
    ).rejects.toThrow(/only applies to --hard/);
  });
});

describe("deleteSprint (hard)", () => {
  it("removes the sprint from sprints.yaml", async () => {
    await createSampleSprint("s1");
    const result = await deleteSprint(locttDir, "s1", { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints).toHaveLength(0);
  });

  it("clears sprint from affected tasks when no remap target", async () => {
    await createSampleSprint("s1");
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", sprint: "s1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, "s1", { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBeUndefined();
  });

  it("remaps sprint to remap target on affected tasks", async () => {
    await createSampleSprint("s1");
    await createSampleSprint("s2");
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", sprint: "s1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, "s1", { hard: true, remapTo: "s2" });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBe("s2");
  });

  it("rejects remap to self", async () => {
    await createSampleSprint("s1");
    await expect(
      deleteSprint(locttDir, "s1", { hard: true, remapTo: "s1" }),
    ).rejects.toThrow(SprintError);
  });
});

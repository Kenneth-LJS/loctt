import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLabelsConfig } from "../config/labels.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { PartialRemapError } from "../projects/manage.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import {
  assertLabelIdsRegistered,
  createLabel,
  deleteLabel,
  editLabel,
  LabelError,
  resolveLabelByName,
  resolveLabelIdFromInput,
} from "./manage.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-labels-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createLabel", () => {
  it("appends to labels.yaml with a generated id", async () => {
    const def = await createLabel(locttDir, { name: "Backend", color: "#1e6fcb" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.labels[0]).toEqual({ id: def.id, name: "Backend", color: "#1e6fcb" });
  });

  // K103: a label was the one entity that could READ all three colour
  // shapes but only WRITE a bare hex — `CreateLabelInput.color` and
  // `editLabel`'s `changes.color` were typed `string`, so anything the
  // swatch picker produced was silently narrowed. These pin the write
  // path for the two non-hex shapes; without them the narrowing is
  // invisible, because a hex-only write still passes every other test.
  it("stores a palette reference, not a resolved hex", async () => {
    const def = await createLabel(locttDir, {
      name: "Palette", color: { palette: "teal" },
    });
    const cfg = await loadLabelsConfig(locttDir);
    // The REFERENCE round-trips. A snapshot of teal's current hex here
    // would break Ken's live-reference ruling: re-theming teal must move
    // this label with it.
    expect(cfg.labels[0]).toEqual({
      id: def.id, name: "Palette", color: { palette: "teal" },
    });
  });

  it("stores an explicit per-mode pair", async () => {
    const def = await createLabel(locttDir, {
      name: "Dual", color: { light: "#1e6fcb", dark: "#8ab4f8" },
    });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]).toEqual({
      id: def.id, name: "Dual", color: { light: "#1e6fcb", dark: "#8ab4f8" },
    });
  });

  it("allows duplicate names (disambiguated by id)", async () => {
    const a = await createLabel(locttDir, { name: "Twin" });
    const b = await createLabel(locttDir, { name: "Twin" });
    expect(a.id).not.toBe(b.id);
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels.filter(l => l.name === "Twin")).toHaveLength(2);
  });
});

describe("editLabel", () => {
  it("changes name and color", async () => {
    const def = await createLabel(locttDir, { name: "X" });
    await editLabel(locttDir, def.id, { name: "Renamed", color: "#abc" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]).toEqual({ id: def.id, name: "Renamed", color: "#abc" });
  });

  it("clears color with null", async () => {
    const def = await createLabel(locttDir, { name: "X", color: "#aaa" });
    await editLabel(locttDir, def.id, { color: null });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]?.color).toBeUndefined();
  });
});

describe("deleteLabel (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    const def = await createLabel(locttDir, { name: "X" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", labels: [def.id] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, def.id);
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]).toEqual({ id: def.id, name: "X", archived: true });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toEqual([def.id]);
  });

  it("rejects --remap-to without --hard", async () => {
    const a = await createLabel(locttDir, { name: "X" });
    const b = await createLabel(locttDir, { name: "Y" });
    await expect(deleteLabel(locttDir, a.id, { remapTo: b.id })).rejects.toThrow(LabelError);
  });
});

describe("deleteLabel (hard)", () => {
  it("removes from labels.yaml when no tasks reference it", async () => {
    const def = await createLabel(locttDir, { name: "Extra" });
    const result = await deleteLabel(locttDir, def.id, { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels.find(l => l.id === def.id)).toBeUndefined();
  });

  it("walks tasks and removes the id from labels", async () => {
    const def = await createLabel(locttDir, { name: "X" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", labels: [def.id] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, def.id, { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toBeUndefined();
  });

  it("remaps to another label when remapTo is supplied", async () => {
    const old = await createLabel(locttDir, { name: "Old" });
    const fresh = await createLabel(locttDir, { name: "New" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", labels: [old.id] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, old.id, { hard: true, remapTo: fresh.id });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toEqual([fresh.id]);
  });

  it("rejects remap to self", async () => {
    const def = await createLabel(locttDir, { name: "X" });
    await expect(deleteLabel(locttDir, def.id, { hard: true, remapTo: def.id })).rejects.toThrow(LabelError);
  });

  it("rejects remap onto an archived label", async () => {
    const { archiveLabel } = await import("./manage.js");
    const old = await createLabel(locttDir, { name: "Old" });
    const dest = await createLabel(locttDir, { name: "Dest" });
    await archiveLabel(locttDir, dest.id);
    await expect(
      deleteLabel(locttDir, old.id, { hard: true, remapTo: dest.id }),
    ).rejects.toThrow(/archived/);
  });

  /**
   * MSL-33: a label remap where some task writes fail must report the
   * split honestly — how many moved, which failed by key, that the
   * label was NOT removed — and offer a retry, rather than throwing a
   * blanket abort or reporting success.
   *
   * This is deliberately the OPPOSITE contract from the sibling deletes
   * (sprints/users/milestones), which stay on `replayTaskRemapStrict`
   * and abort on any failure. Only labels route back to the reporting
   * path, mirroring the project delete (PRU-34). The guard test
   * `aborts and keeps the sprint when a task rewrite fails partway`
   * proves the siblings did not move with it.
   *
   * Real write failure via `chmod 0o500`, not a mock: the behaviour is
   * what the remap loop does when `writeTask` throws. Four tasks so
   * "some moved, some did not" (remapped 3, failed 1) is distinguishable
   * from both none-moved and all-moved.
   */
  // @verifies MSL-33
  it("MSL-33: a partial remap reports the split and does not remove the label", async () => {
    const old = await createLabel(locttDir, { name: "Old" });
    const fresh = await createLabel(locttDir, { name: "New" });

    const made: { key: string; id: string }[] = [];
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      for (const title of ["a", "b", "c", "d"]) {
        const t = await createTask({
          locttDir, state,
          options: { project: taskProjectId, title, labels: [old.id] },
        });
        made.push({ key: t.frontmatter.key, id: t.frontmatter.id });
      }
      await saveState(locttDir, state);
    });

    // Make exactly one task's dir unwritable so its rewrite fails.
    const victim = made[1] as { key: string; id: string };
    const victimDir = join(locttDir, "tasks", victim.id);
    await chmod(victimDir, 0o500);

    let err: unknown;
    try {
      await deleteLabel(locttDir, old.id, { hard: true, remapTo: fresh.id });
    } catch (e) {
      err = e;
    } finally {
      await chmod(victimDir, 0o700);
    }

    // Reports the split by key, names the label as NOT deleted, and is
    // retryable — not a blanket failure and not silent success.
    expect(err).toBeInstanceOf(PartialRemapError);
    const partial = err as PartialRemapError;
    expect(partial.remapped).toBe(3);
    expect(partial.failedKeys).toEqual([victim.key]);
    expect(partial.message).toContain(victim.key);
    expect(partial.message).toMatch(/label has NOT been deleted/i);
    expect(partial.recovery).toEqual({ kind: "retry" });

    // The label is STILL in labels.yaml — removing it would strand the
    // task that did not move.
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels.some(l => l.id === old.id)).toBe(true);
  });
});

describe("resolveLabelByName / resolveLabelIdFromInput", () => {
  it("resolves a single match by name", async () => {
    const def = await createLabel(locttDir, { name: "Frontend" });
    const cfg = await loadLabelsConfig(locttDir);
    const result = resolveLabelByName(cfg, "Frontend");
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.label.id).toBe(def.id);
    expect(resolveLabelIdFromInput(cfg, "Frontend")).toBe(def.id);
    expect(resolveLabelIdFromInput(cfg, def.id)).toBe(def.id);
  });

  it("returns ambiguous for duplicate names", async () => {
    await createLabel(locttDir, { name: "Twin" });
    await createLabel(locttDir, { name: "Twin" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(resolveLabelByName(cfg, "Twin").kind).toBe("ambiguous");
    expect(() => resolveLabelIdFromInput(cfg, "Twin")).toThrow(/ambiguous/);
  });
});

describe("assertLabelIdsRegistered", () => {
  it("passes when all ids are known", async () => {
    const def = await createLabel(locttDir, { name: "A" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(() => assertLabelIdsRegistered(cfg, [def.id])).not.toThrow();
  });

  it("throws on unknown ids", async () => {
    const cfg = await loadLabelsConfig(locttDir);
    expect(() => assertLabelIdsRegistered(cfg, ["01HX0NOTHERE"])).toThrow(/unknown label/);
  });
});

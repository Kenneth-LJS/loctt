import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLabelsConfig } from "../config/labels.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/lookup.js";
import {
  assertLabelKeysRegistered,
  createLabel,
  deleteLabel,
  editLabel,
  LabelError,
} from "./manage.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-labels-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createLabel", () => {
  it("appends to labels.yaml", async () => {
    await createLabel(locttDir, { key: "backend", label: "Backend", color: "#1e6fcb" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.labels[0]).toEqual({ key: "backend", label: "Backend", color: "#1e6fcb" });
  });

  it("rejects duplicates", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await expect(createLabel(locttDir, { key: "x", label: "Y" })).rejects.toThrow(/already exists/);
  });
});

describe("editLabel", () => {
  it("changes label-name and color", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await editLabel(locttDir, "x", { label: "Renamed", color: "#abc" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]).toEqual({ key: "x", label: "Renamed", color: "#abc" });
  });

  it("clears color with null", async () => {
    await createLabel(locttDir, { key: "x", label: "X", color: "#aaa" });
    await editLabel(locttDir, "x", { color: null });
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]?.color).toBeUndefined();
  });
});

describe("deleteLabel (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", labels: ["x"] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, "x");
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels[0]).toEqual({ key: "x", label: "X", archived: true });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toEqual(["x"]);
  });

  it("rejects --remap-to without --hard", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await createLabel(locttDir, { key: "y", label: "Y" });
    await expect(deleteLabel(locttDir, "x", { remapTo: "y" })).rejects.toThrow(LabelError);
  });
});

describe("deleteLabel (hard)", () => {
  it("removes from labels.yaml when no tasks reference it", async () => {
    await createLabel(locttDir, { key: "extra", label: "Extra" });
    const result = await deleteLabel(locttDir, "extra", { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadLabelsConfig(locttDir);
    expect(cfg.labels.find(l => l.key === "extra")).toBeUndefined();
  });

  it("walks tasks and removes the key from labels", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", labels: ["x"] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, "x", { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toBeUndefined();
  });

  it("remaps to another label when remapTo is supplied", async () => {
    await createLabel(locttDir, { key: "old", label: "Old" });
    await createLabel(locttDir, { key: "new", label: "New" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "t", labels: ["old"] },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteLabel(locttDir, "old", { hard: true, remapTo: "new" });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.labels).toEqual(["new"]);
  });

  it("rejects remap to self", async () => {
    await createLabel(locttDir, { key: "x", label: "X" });
    await expect(deleteLabel(locttDir, "x", { hard: true, remapTo: "x" })).rejects.toThrow(LabelError);
  });
});

describe("assertLabelKeysRegistered", () => {
  it("passes when all keys are known", async () => {
    await createLabel(locttDir, { key: "a", label: "A" });
    const cfg = await loadLabelsConfig(locttDir);
    expect(() => assertLabelKeysRegistered(cfg, ["a"])).not.toThrow();
  });

  it("throws on unknown keys with guidance", async () => {
    const cfg = await loadLabelsConfig(locttDir);
    expect(() => assertLabelKeysRegistered(cfg, ["nope"])).toThrow(/loctt label create/);
  });
});

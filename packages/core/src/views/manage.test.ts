import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadQueriesConfig } from "../config/queries.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import {
  archiveView,
  createView,
  deleteView,
  editView,
  findView,
  unarchiveView,
  ViewError,
} from "./manage.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-views-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createView", () => {
  it("generates a stable id", async () => {
    const view = await createView(locttDir, {
      name: "open",
      query: "status != done",
    });
    expect(view.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(view.name).toBe("open");
  });
});

describe("findView", () => {
  it("resolves by id", async () => {
    const created = await createView(locttDir, { name: "open", query: "status != done" });
    const cfg = await loadQueriesConfig(locttDir);
    expect(findView(cfg, created.id).name).toBe("open");
  });

  it("resolves by unique name", async () => {
    await createView(locttDir, { name: "open", query: "status != done" });
    const cfg = await loadQueriesConfig(locttDir);
    expect(findView(cfg, "open").name).toBe("open");
  });

  it("throws on ambiguous name", async () => {
    const a = await createView(locttDir, { name: "dup", query: "status != done" });
    await createView(locttDir, { name: "dup", query: "status = done" });
    const cfg = await loadQueriesConfig(locttDir);
    expect(() => findView(cfg, "dup")).toThrow(ViewError);
    // ID still resolves cleanly.
    expect(findView(cfg, a.id).name).toBe("dup");
  });
});

describe("editView", () => {
  it("updates name and query", async () => {
    const created = await createView(locttDir, { name: "open", query: "status != done" });
    const updated = await editView(locttDir, created.id, {
      name: "still-open",
      query: "status = in_progress",
    });
    expect(updated.name).toBe("still-open");
    expect(updated.query).toBe("status = in_progress");
  });
});

describe("archiveView / unarchiveView", () => {
  it("flips archived: true and back", async () => {
    const created = await createView(locttDir, { name: "test-view", query: "status != done" });
    await archiveView(locttDir, created.id);
    let cfg = await loadQueriesConfig(locttDir);
    let target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBe(true);

    await unarchiveView(locttDir, created.id);
    cfg = await loadQueriesConfig(locttDir);
    target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBeUndefined();
  });

  it("throws on unknown view", async () => {
    await expect(archiveView(locttDir, "nope")).rejects.toThrow(ViewError);
  });
});

describe("deleteView (soft, default)", () => {
  it("sets archived: true and keeps the entry runnable by id", async () => {
    const created = await createView(locttDir, { name: "test-view", query: "status != done" });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await deleteView(locttDir, created.id);

    const cfg = await loadQueriesConfig(locttDir);
    // Soft-delete: count unchanged; entry is just marked archived.
    expect(cfg.queries).toHaveLength(before);
    const target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBe(true);
  });
});

describe("deleteView (hard)", () => {
  it("removes the entry from queries.yaml", async () => {
    const created = await createView(locttDir, { name: "test-view", query: "status != done" });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await deleteView(locttDir, created.id, { hard: true });

    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries).toHaveLength(before - 1);
    expect(cfg.queries.find(q => q.id === created.id)).toBeUndefined();
  });

  it("can delete an already-archived view", async () => {
    const created = await createView(locttDir, { name: "test-view", query: "status != done" });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await archiveView(locttDir, created.id);
    await deleteView(locttDir, created.id, { hard: true });

    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries).toHaveLength(before - 1);
    expect(cfg.queries.find(q => q.id === created.id)).toBeUndefined();
  });
});

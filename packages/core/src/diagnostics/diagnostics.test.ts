import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { runDoctor } from "./doctor.js";
import { getTrackerInfo } from "./info.js";

describe("getTrackerInfo", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-info-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports non-existent tracker", async () => {
    const info = await getTrackerInfo(root);
    expect(info.exists).toBe(false);
    expect(info.taskCount).toBe(0);
  });

  it("reports initialized tracker info", async () => {
    await initLoctt(root);
    const info = await getTrackerInfo(root);
    expect(info.exists).toBe(true);
    expect(info.workflowConfig).not.toBeNull();
    expect(info.workflowConfig?.key.prefix).toBe("T-");
    expect(info.queriesConfig).not.toBeNull();
    expect(info.state).not.toBeNull();
    expect(info.taskCount).toBe(0);
  });
});

describe("runDoctor", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-doctor-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports error for missing .loctt directory", async () => {
    const checks = await runDoctor(root);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("error");
    expect(checks[0]?.message).toContain("not found");
  });

  it("reports all ok for fresh init", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    const errors = checks.filter(c => c.status === "error");
    expect(errors).toHaveLength(0);
    const okChecks = checks.filter(c => c.status === "ok");
    expect(okChecks.length).toBeGreaterThanOrEqual(5);
  });

  it("includes task and relationship checks", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    const taskCheck = checks.find(c => c.name === "tasks");
    expect(taskCheck?.status).toBe("ok");
    expect(taskCheck?.message).toContain("0 task(s)");
  });

  it("warns when list-view.yaml references an unknown field", async () => {
    await initLoctt(root);
    const { resolveLocttDir } = await import("../paths/index.js");
    const { saveListViewConfig } = await import("../config/list-view.js");
    const locttDir = resolveLocttDir(root);
    // Built-in `status` is fine; `severity` does not match any
    // declared custom field, so doctor should flag it.
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "severity"] },
    });
    const checks = await runDoctor(root);
    const warn = checks.find(c => c.name === "list-view.yaml references");
    expect(warn?.status).toBe("warn");
    expect(warn?.message).toContain("severity");
  });

  it("does not warn when list-view.yaml references only built-in fields", async () => {
    await initLoctt(root);
    const { resolveLocttDir } = await import("../paths/index.js");
    const { saveListViewConfig } = await import("../config/list-view.js");
    const locttDir = resolveLocttDir(root);
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "priority", "type"] },
    });
    const checks = await runDoctor(root);
    expect(checks.find(c => c.name === "list-view.yaml references")).toBeUndefined();
  });

  it("warns on key-index drift after an out-of-band frontmatter edit", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { writeTask } = await import("../task/io.js");
    const { rebuildKeyIndex } = await import("../state/key-index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    await writeTask(locttDir, "01XYZ", {
      frontmatter: {
        id: "01XYZ",
        key: "T-1",
        title: "first",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    });
    await rebuildKeyIndex(locttDir);

    // Hand-edit the task's key — the kind of change LocTT cannot
    // auto-detect because the indexed task id still resolves.
    const taskMd = join(locttDir, "tasks", "01XYZ", "task.md");
    const original = await readFile(taskMd, "utf-8");
    const rewritten = original.replace("key: T-1", "key: T-RENAMED");
    await writeFile(taskMd, rewritten, "utf-8");

    const checks = await runDoctor(root);
    const idx = checks.find(c => c.name === "key index");
    expect(idx?.status).toBe("warn");
    expect(idx?.message).toContain("--rebuild-index");
  });

  it("rebuild-index option rebuilds the index in place", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { writeTask } = await import("../task/io.js");
    const { rebuildKeyIndex, loadKeyIndex } = await import("../state/key-index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    await writeTask(locttDir, "01XYZ", {
      frontmatter: {
        id: "01XYZ",
        key: "T-1",
        title: "first",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    });
    await rebuildKeyIndex(locttDir);

    const taskMd = join(locttDir, "tasks", "01XYZ", "task.md");
    const original = await readFile(taskMd, "utf-8");
    const rewritten = original.replace("key: T-1", "key: T-RENAMED");
    await writeFile(taskMd, rewritten, "utf-8");

    const checks = await runDoctor(root, { rebuildIndex: true });
    const rebuild = checks.find(c => c.name === "key index rebuild");
    expect(rebuild?.status).toBe("ok");

    const idx = await loadKeyIndex(locttDir);
    expect(idx?.entries["T-RENAMED"]).toBe("01XYZ");
    expect(idx?.entries["T-1"]).toBeUndefined();
  });
});

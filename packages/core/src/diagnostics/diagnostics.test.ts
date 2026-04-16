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
});

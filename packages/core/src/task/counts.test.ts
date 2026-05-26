import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { countTasksByReference, countTasksByReferences } from "./counts.js";
import { createTask } from "./create.js";
import { archiveTask } from "./lifecycle.js";

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-counts-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const cfg = await loadProjectsConfig(locttDir);
  projectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(opts: Parameters<typeof createTask>[0]["options"]): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: opts });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

describe("countTasksByReference", () => {
  it("counts tasks by milestone id", async () => {
    await seed({ project: projectId, title: "A", milestone: "m1" });
    await seed({ project: projectId, title: "B", milestone: "m1" });
    await seed({ project: projectId, title: "C", milestone: "m2" });
    expect(await countTasksByReference(locttDir, "milestone", "m1")).toBe(2);
    expect(await countTasksByReference(locttDir, "milestone", "m2")).toBe(1);
    expect(await countTasksByReference(locttDir, "milestone", "absent")).toBe(0);
  });

  it("counts tasks by label membership", async () => {
    await seed({ project: projectId, title: "A", labels: ["l1", "l2"] });
    await seed({ project: projectId, title: "B", labels: ["l1"] });
    await seed({ project: projectId, title: "C" });
    expect(await countTasksByReference(locttDir, "label", "l1")).toBe(2);
    expect(await countTasksByReference(locttDir, "label", "l2")).toBe(1);
  });

  it("excludes archived tasks by default", async () => {
    const a = await seed({ project: projectId, title: "A", milestone: "m1" });
    await seed({ project: projectId, title: "B", milestone: "m1" });
    await archiveTask(locttDir, a);
    expect(await countTasksByReference(locttDir, "milestone", "m1")).toBe(1);
    expect(await countTasksByReference(locttDir, "milestone", "m1", { includeArchived: true })).toBe(2);
  });

  it("counts by project, sprint, assignee, reporter", async () => {
    await seed({ project: projectId, title: "A", sprint: "sp1", assignee: "u1", reporter: "u2" });
    expect(await countTasksByReference(locttDir, "project", projectId)).toBe(1);
    expect(await countTasksByReference(locttDir, "sprint", "sp1")).toBe(1);
    expect(await countTasksByReference(locttDir, "assignee", "u1")).toBe(1);
    expect(await countTasksByReference(locttDir, "reporter", "u2")).toBe(1);
  });
});

describe("countTasksByReferences (batch)", () => {
  it("returns a record keyed by id with zeros for missing", async () => {
    await seed({ project: projectId, title: "A", labels: ["l1"] });
    await seed({ project: projectId, title: "B", labels: ["l1", "l2"] });
    const counts = await countTasksByReferences(locttDir, "label", ["l1", "l2", "l3"]);
    expect(counts).toEqual({ l1: 2, l2: 1, l3: 0 });
  });

  it("empty ids yields empty record", async () => {
    const counts = await countTasksByReferences(locttDir, "label", []);
    expect(counts).toEqual({});
  });
});

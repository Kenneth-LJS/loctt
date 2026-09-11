import { access,mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { detectMachineTimezone, loadCalendarConfig } from "../config/calendar.js";
import { parseQueriesConfig } from "../config/queries.js";
import { parseWorkflowConfig } from "../config/workflow.js";
import { resolveLocttDir } from "../paths/index.js";
import { parseState } from "../state/state.js";
import { initLoctt } from "./init.js";

describe("initLoctt", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-init-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates .loctt directory structure", async () => {
    const result = await initLoctt(root);
    expect(result.locttDir).toBe(join(root, ".loctt"));

    // Verify directories exist
    await expect(access(join(result.locttDir, "config"))).resolves.toBeUndefined();
    await expect(access(join(result.locttDir, "tasks"))).resolves.toBeUndefined();
    await expect(access(join(result.locttDir, "local"))).resolves.toBeUndefined();
  });

  it("creates valid workflow.yaml with default prefix", async () => {
    const result = await initLoctt(root);
    const content = await readFile(join(result.locttDir, "config", "workflow.yaml"), "utf-8");
    const config = parseWorkflowConfig(content);
    expect(config.key.prefix).toBe("T");
    expect(config.statuses).toHaveLength(4);
    expect(config.priorities).toHaveLength(4);
    expect(config.task_types).toHaveLength(5);
    expect(config.relationships).toHaveLength(6);
    expect(config.estimation?.enabled).toBe(true);
    expect(config.timeline?.dependency_relationship).toBe("blocks");
  });

  it("creates valid queries.yaml", async () => {
    const result = await initLoctt(root);
    const content = await readFile(join(result.locttDir, "config", "queries.yaml"), "utf-8");
    const config = parseQueriesConfig(content);
    expect(config.queries.length).toBeGreaterThan(0);
  });

  it("creates valid state.yaml keyed by the project id", async () => {
    const result = await initLoctt(root);
    const projectsRaw = await readFile(join(result.locttDir, "config", "projects.yaml"), "utf-8");
    const stateContent = await readFile(join(result.locttDir, "state.yaml"), "utf-8");
    const state = parseState(stateContent);
    // state.keys is keyed by the project id (ULID), and matches the
    // id in projects.yaml. Sanity-check by extracting the id directly.
    const idMatch = projectsRaw.match(/\bid:\s+([A-Z0-9]+)/);
    expect(idMatch).not.toBeNull();
    const projectId = idMatch?.[1] ?? "";
    expect(state.keys[projectId]).toEqual({ prefix: "T", next_number: 1 });
  });

  it("uses custom prefix", async () => {
    const result = await initLoctt(root, { prefix: "BUG" });
    const content = await readFile(join(result.locttDir, "config", "workflow.yaml"), "utf-8");
    const config = parseWorkflowConfig(content);
    expect(config.key.prefix).toBe("BUG");

    const stateContent = await readFile(join(result.locttDir, "state.yaml"), "utf-8");
    const state = parseState(stateContent);
    const ids = Object.keys(state.keys);
    expect(ids).toHaveLength(1);
    expect(state.keys[ids[0] as string]?.prefix).toBe("BUG");
  });

  it("uses custom project name", async () => {
    const result = await initLoctt(root, { projectName: "Backend", prefix: "BACKEND" });
    const projectsRaw = await readFile(join(result.locttDir, "config", "projects.yaml"), "utf-8");
    const stateContent = await readFile(join(result.locttDir, "state.yaml"), "utf-8");
    const state = parseState(stateContent);
    expect(projectsRaw).toMatch(/name:\s+"Backend"/);
    const ids = Object.keys(state.keys);
    expect(ids).toHaveLength(1);
    expect(state.keys[ids[0] as string]).toEqual({ prefix: "BACKEND", next_number: 1 });
  });

  it("creates projects.yaml", async () => {
    const result = await initLoctt(root);
    const content = await readFile(join(result.locttDir, "config", "projects.yaml"), "utf-8");
    expect(content).toContain("projects:");
    // id is a generated ULID; check shape, plus name + prefix.
    expect(content).toMatch(/id: [0-9A-Z]{26}/);
    expect(content).toMatch(/name: "Tasks"/);
    expect(content).toContain('prefix: "T"');
    // default references the same id; cross-check by extracting it.
    const idMatch = content.match(/\bid: ([0-9A-Z]{26})/);
    expect(idMatch).not.toBeNull();
    expect(content).toContain(`default: ${idMatch?.[1] as string}`);
  });

  it("generates docs by default", async () => {
    const result = await initLoctt(root);
    await expect(access(join(result.locttDir, "docs", "README.md"))).resolves.toBeUndefined();
    await expect(access(join(result.locttDir, "docs", "workflow.md"))).resolves.toBeUndefined();
    await expect(access(join(result.locttDir, "docs", "git-sync.md"))).resolves.toBeUndefined();
    await expect(access(join(result.locttDir, "docs", "agents.md"))).resolves.toBeUndefined();
  });

  it("skips docs when docs=false", async () => {
    const result = await initLoctt(root, { docs: false });
    const docsDir = join(result.locttDir, "docs");
    await expect(access(docsDir)).rejects.toThrow();
  });

  it("throws if .loctt already exists", async () => {
    await initLoctt(root);
    await expect(initLoctt(root)).rejects.toThrow("already exists");
  });

  it("returns list of created files", async () => {
    const result = await initLoctt(root);
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.some(f => f.includes("workflow.yaml"))).toBe(true);
    expect(result.created.some(f => f.includes("state.yaml"))).toBe(true);
  });

  it("stamps the schema version at .loctt/.schema-version", async () => {
    const result = await initLoctt(root);
    const versionPath = join(result.locttDir, ".schema-version");
    const raw = (await readFile(versionPath, "utf-8")).trim();
    // Should be a positive integer matching CURRENT_SCHEMA_VERSION (≥ 1).
    const n = Number(raw);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(result.created.some(f => f.endsWith(".schema-version"))).toBe(true);
  });
});

describe("initLoctt — calendar.yaml", () => {
  // The timezone decides what "today" means for `due_date < today`,
  // so it's recorded at init as an explicit committed value rather
  // than re-detected per machine on every read.
  it("writes calendar.yaml with the machine timezone by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-init-tz-"));
    try {
      await initLoctt(root, { docs: false });
      const cfg = await loadCalendarConfig(resolveLocttDir(root));
      expect(cfg.timezone).toBe(detectMachineTimezone());
      expect(cfg.working_days).toEqual([1, 2, 3, 4, 5]);
      expect(cfg.holidays).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honours an explicit --timezone", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-init-tz-"));
    try {
      await initLoctt(root, { docs: false, timezone: "Asia/Singapore" });
      const cfg = await loadCalendarConfig(resolveLocttDir(root));
      expect(cfg.timezone).toBe("Asia/Singapore");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // serializeCalendarConfig doesn't validate, so without this check
  // init would write a calendar.yaml that every later load rejects.
  it("rejects an unknown timezone before creating anything", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-init-tz-"));
    try {
      await expect(
        initLoctt(root, { docs: false, timezone: "Not/AZone" }),
      ).rejects.toThrow(/invalid timezone/);
      // Staging is atomic — a rejected init leaves no .loctt behind.
      await expect(stat(resolveLocttDir(root))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports calendar.yaml among the created files", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-init-tz-"));
    try {
      const result = await initLoctt(root, { docs: false });
      expect(result.created.some(p => p.endsWith("calendar.yaml"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loadCalendarConfig — absent file", () => {
  // calendar.yaml is workspace-shared and committed, so the fallback
  // must not vary by machine: two people on one tracker have to get
  // the same answer from the same saved view.
  it("defaults to UTC rather than the machine timezone", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-cal-absent-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      await rm(join(locttDir, "config", "calendar.yaml"), { force: true });
      const cfg = await loadCalendarConfig(locttDir);
      expect(cfg.timezone).toBe("UTC");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

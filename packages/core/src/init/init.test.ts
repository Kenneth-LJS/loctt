import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { detectMachineTimezone, loadCalendarConfig } from "../config/calendar.js";
import { parseQueriesConfig } from "../config/queries.js";
import { parseWorkflowConfig } from "../config/workflow.js";
import { resolveLocttDir } from "../paths/index.js";
import { filtersToNode } from "../query/filters.js";
import { validateQuery } from "../query/validate.js";
import { CURRENT_SCHEMA_VERSION } from "../schema/index.js";
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

  // The seeded queries must be valid against the workflow that ships in
  // the SAME init — not merely well-formed YAML. A shipped default that
  // references a status/relationship the seeded workflow does not declare
  // (e.g. the old `status = blocked`, a status no default workflow has)
  // is broken for 100% of new users on every surface. parseQueriesConfig
  // only checks syntax; validateQuery(..., { workflow }) is what catches
  // an enum value or relationship kind the workflow never defined.
  it("seeds queries that validate against the seeded workflow", async () => {
    const result = await initLoctt(root);
    const workflow = parseWorkflowConfig(
      await readFile(join(result.locttDir, "config", "workflow.yaml"), "utf-8"),
    );
    const queries = parseQueriesConfig(
      await readFile(join(result.locttDir, "config", "queries.yaml"), "utf-8"),
    );
    // Self-contained guard against vacuity: if the seed shipped zero
    // queries (or parseQueriesConfig silently dropped a broken one), the
    // loop below would assert nothing and pass green. Pin the count here
    // so this test alone catches an empty/degraded seed.
    expect(queries.queries.length).toBeGreaterThan(0);
    for (const q of queries.queries) {
      const node = filtersToNode(q.filters);
      if (node === undefined) continue; // no filters: matches everything, nothing to validate
      expect(
        () => validateQuery(node, { workflow }),
        `seeded query "${q.name}" is invalid against the seeded workflow`,
      ).not.toThrow();
    }
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

  // B22 (K129): "just ignore, proceed with steps." An empty `.loctt/`
  // is set up like a missing one: no repair flag, no refusal, and the
  // full fresh set of files, not the repair subset.
  // @verifies ONB-16
  it("sets up an empty .loctt straight through, like a missing one", async () => {
    await mkdir(join(root, ".loctt"));
    const result = await initLoctt(root, { prefix: "WEB", projectName: "Website" });
    const dir = result.locttDir;
    await expect(access(join(dir, "state.yaml"))).resolves.toBeUndefined();
    await expect(access(join(dir, ".schema-version"))).resolves.toBeUndefined();
    await expect(access(join(dir, ".gitignore"))).resolves.toBeUndefined();
    await expect(access(join(dir, "docs", "README.md"))).resolves.toBeUndefined();
    // The default user a fresh init creates.
    expect((await readdir(join(dir, "users"))).length).toBe(1);
    const projects = await readFile(join(dir, "config", "projects.yaml"), "utf-8");
    expect(projects).toContain("WEB");
    expect(projects).toContain("Website");
    // No staging directory is left beside it.
    expect((await readdir(root)).filter(n => n.endsWith(".tmp"))).toEqual([]);
  });

  // @verifies ONB-16
  it("keeps what an empty .loctt already held when filling it in", async () => {
    await mkdir(join(root, ".loctt", "tasks"), { recursive: true });
    await writeFile(join(root, ".loctt", "notes.txt"), "left over", "utf-8");
    const result = await initLoctt(root);
    expect(await readFile(join(result.locttDir, "notes.txt"), "utf-8")).toBe("left over");
    await expect(access(join(result.locttDir, "config", "workflow.yaml"))).resolves.toBeUndefined();
  });

  /**
   * A346 (review m1): `rm -rf .loctt/*` leaves dotfiles behind, so an
   * "empty" tracker can still hold an old `.schema-version`. It describes
   * nothing (there is no config, state or task), and keeping it stamped
   * the fresh tracker with a version it was not written at. `created`
   * listed files that were never written, too.
   */
  // @verifies ONB-16
  it("over an empty .loctt, overwrites a stale .schema-version and lists only what it wrote", async () => {
    const dir = join(root, ".loctt");
    await mkdir(dir);
    await writeFile(join(dir, ".schema-version"), `${String(CURRENT_SCHEMA_VERSION + 6)}\n`, "utf-8");
    await writeFile(join(dir, ".gitignore"), "# the user's own\n", "utf-8");

    const result = await initLoctt(root);

    expect((await readFile(join(dir, ".schema-version"), "utf-8")).trim())
      .toBe(String(CURRENT_SCHEMA_VERSION));
    expect(result.created).toContain(join(dir, ".schema-version"));
    // The user's .gitignore is kept, so it is not reported as created.
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toBe("# the user's own\n");
    expect(result.created).not.toContain(join(dir, ".gitignore"));
    expect(result.created).toContain(join(dir, "state.yaml"));
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

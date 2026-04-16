import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLoctt } from "./init.js";
import { parseWorkflowConfig } from "../config/workflow.js";
import { parseQueriesConfig } from "../config/queries.js";
import { parseState } from "../state/state.js";

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
    expect(config.key.prefix).toBe("T-");
    expect(config.statuses).toHaveLength(4);
    expect(config.priorities).toHaveLength(3);
    expect(config.relationships).toHaveLength(3);
  });

  it("creates valid queries.yaml", async () => {
    const result = await initLoctt(root);
    const content = await readFile(join(result.locttDir, "config", "queries.yaml"), "utf-8");
    const config = parseQueriesConfig(content);
    expect(config.queries.length).toBeGreaterThan(0);
  });

  it("creates valid state.yaml", async () => {
    const result = await initLoctt(root);
    const content = await readFile(join(result.locttDir, "state.yaml"), "utf-8");
    const state = parseState(content);
    expect(state.keys["task"]).toEqual({ prefix: "T-", next_number: 1 });
  });

  it("uses custom prefix", async () => {
    const result = await initLoctt(root, { prefix: "BUG-" });
    const content = await readFile(join(result.locttDir, "config", "workflow.yaml"), "utf-8");
    const config = parseWorkflowConfig(content);
    expect(config.key.prefix).toBe("BUG-");

    const stateContent = await readFile(join(result.locttDir, "state.yaml"), "utf-8");
    const state = parseState(stateContent);
    expect(state.keys["task"]?.prefix).toBe("BUG-");
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
});

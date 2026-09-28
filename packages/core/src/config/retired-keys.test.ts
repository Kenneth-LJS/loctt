/**
 * K143: `ranked` is retired. A `ranked:` line left in a user's
 * workflow.yaml must not break loading; it is ignored, doctor reports it
 * as a `warn` naming the relationships, the 0.1.0 → 0.3.0 upgrade
 * removes it, and the next write of workflow.yaml drops it.
 *
 * @verifies REL-33
 * @verifies ONB-C15
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDoctor } from "../diagnostics/doctor.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { findRetiredRelationshipKeys, stripRetiredRelationshipKeys } from "./retired-keys.js";
import { loadWorkflowConfig } from "./workflow.js";
import { editRelationship } from "./workflow-entities.js";

let root: string;
let locttDir: string;
let wfPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-retired-"));
  await initLoctt(root, { docs: false, timezone: "UTC" });
  locttDir = resolveLocttDir(root);
  wfPath = join(locttDir, "config", "workflow.yaml");
  const text = await readFile(wfPath, "utf-8");
  // A comment, to show the strip keeps the rest of the file as it was.
  const withRanked = text
    .replace(/(- key: blocks\n)/, "$1    ranked: true\n")
    .replace(/(- key: relates_to\n)/, "# my note\n  $1    ranked: false\n");
  expect(withRanked).not.toBe(text);
  await writeFile(wfPath, withRanked, "utf-8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a retired `ranked` setting in workflow.yaml", () => {
  it("does not break loading: every relationship loads, none broken", async () => {
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.relationships.map(r => r.key)).toContain("blocks");
    expect(cfg.relationships.map(r => r.key)).toContain("relates_to");
    expect(cfg.broken?.relationships ?? []).toEqual([]);
    expect(cfg.relationships.every(r => !("ranked" in r))).toBe(true);
  });

  it("doctor warns, naming each relationship, and says to remove the lines", async () => {
    const checks = await runDoctor(root);
    const check = checks.find(c => c.name === "workflow.yaml retired settings");
    expect(check).toEqual({
      name: "workflow.yaml retired settings",
      status: "warn",
      message: "'ranked' on blocks, 'ranked' on relates_to no longer does anything: every link "
        + "is ordered since loctt 0.3.0. Remove those lines",
    });
  });

  it("the strip removes only those lines, keeping comments, and doctor is quiet after", async () => {
    expect(await findRetiredRelationshipKeys(locttDir)).toHaveLength(2);
    expect(await stripRetiredRelationshipKeys(locttDir)).toBe(2);
    const text = await readFile(wfPath, "utf-8");
    expect(text).not.toMatch(/ranked:/);
    expect(text).toContain("# my note");
    expect(await stripRetiredRelationshipKeys(locttDir)).toBe(0);
    const checks = await runDoctor(root);
    expect(checks.find(c => c.name === "workflow.yaml retired settings")).toBeUndefined();
  });

  it("the next write of workflow.yaml drops it", async () => {
    await editRelationship(locttDir, "blocks", { label: "Blocks!" });
    expect(await readFile(wfPath, "utf-8")).not.toMatch(/ranked:/);
  });
});

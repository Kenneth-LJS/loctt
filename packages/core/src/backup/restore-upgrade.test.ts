/**
 * Restoring a backup taken at an older format upgrades it (K161, B55).
 *
 * The backups here are genuine: `exportBackup` over the frozen 0.1.0 and
 * 0.3.0 seeds (`tests/fixtures/trackers/seed-0.1.0`, `seed-0.3.0`),
 * which record their own `.schema-version` in the header. The expected
 * link order is computed from the source files with the 0.1.0 rule
 * written out independently (as `upgrade-0.3.0.test.ts` does), so the
 * step cannot vouch for itself.
 *
 * @verifies BAK-C21
 * @verifies BAK-C25
 */
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { requireSupportedSchema } from "../schema/migrate.js";
import { isProvablyRanked } from "../schema/steps/rank-every-link.js";
import { CURRENT_SCHEMA_VERSION, readSchemaVersion } from "../schema/version.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { exportBackup } from "./export.js";
import { BackupFormatError } from "./read.js";
import { restoreBackup, RestoreUpgradeError } from "./restore.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "../../../../tests/fixtures/trackers");

interface Edge { type: string; target: string; rank?: string }

let root: string;
let srcDir: string;
let dst: string;
let dstDir: string;
let out: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-restore-older-"));
  srcDir = join(root, "src", ".loctt");
  dst = join(root, "dst");
  await initLoctt(dst, { docs: false });
  dstDir = resolveLocttDir(dst);
  out = join(root, "backup.jsonl");
});

afterEach(async () => {
  vi.doUnmock("../schema/steps/rank-every-link.js");
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

/** A genuine backup of a frozen seed, recording the seed's format. */
async function backupOf(seed: "seed-0.1.0" | "seed-0.3.0"): Promise<void> {
  await cp(join(FIXTURES, seed, ".loctt"), srcDir, { recursive: true });
  if (seed === "seed-0.1.0") {
    // Stale ranks on a kind 0.1.0 did not rank (REL-33 kept them when a
    // kind was switched to `ranked: false`): 0.1.0 showed stored order,
    // and the ranks say the reverse. Only the upgrade step re-ranks
    // such a group, so without it the order below comes out reversed.
    const path = join(srcDir, "tasks", "01M3JSJPNEP4W08EEACNVFJ7B4", "task.md");
    const raw = await readFile(path, "utf-8");
    const next = raw
      .replace("target: 01M3JSJQACBF264WF638ZK9AS7\n", "target: 01M3JSJQACBF264WF638ZK9AS7\n    rank: t\n")
      .replace("target: 01M3JSJW6XHV058Y2T07D4JH63\n", "target: 01M3JSJW6XHV058Y2T07D4JH63\n    rank: h\n");
    expect(next).not.toBe(raw);
    await writeFile(path, next, "utf-8");
  }
  const report = await exportBackup(srcDir, { outputPath: out });
  expect(report.schemaVersion).toBe(seed === "seed-0.1.0" ? "0.1.0" : "0.3.0");
}

async function taskFrontmatter(dir: string, id: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dir, "tasks", id, "task.md"), "utf-8");
  return parseYaml(raw.split("---")[1] ?? "") as Record<string, unknown>;
}

async function taskBody(dir: string, id: string): Promise<string> {
  const raw = await readFile(join(dir, "tasks", id, "task.md"), "utf-8");
  return raw.split("---").slice(2).join("---").trim();
}

async function edgesByTask(dir: string): Promise<Map<string, Edge[]>> {
  const out = new Map<string, Edge[]>();
  for (const id of await readdir(join(dir, "tasks"))) {
    const fm = await taskFrontmatter(dir, id);
    out.set(id, (fm["relationships"] as Edge[] | undefined) ?? []);
  }
  return out;
}

/** The kinds a workflow.yaml sets `ranked: true`, both sides. */
async function rankedTypes(dir: string): Promise<Set<string>> {
  const wf = parseYaml(await readFile(join(dir, "config", "workflow.yaml"), "utf-8")) as {
    relationships: { key: string; inverse?: string; kind?: string; ranked?: boolean }[];
  };
  const ranked = new Set<string>();
  for (const d of wf.relationships) {
    if (d.ranked !== true) continue;
    ranked.add(d.key);
    if (d.kind !== "symmetric" && d.inverse !== undefined) ranked.add(d.inverse);
  }
  return ranked;
}

/** 0.1.0's shown order: a ranked kind by rank then unranked in stored order, else stored order. */
async function shownOrder010(dir: string): Promise<Map<string, string[]>> {
  const ranked = await rankedTypes(dir);
  const out = new Map<string, string[]>();
  for (const [id, edges] of await edgesByTask(dir)) {
    for (const type of new Set(edges.map(e => e.type))) {
      const group = edges.map((e, index) => ({ ...e, index })).filter(e => e.type === type);
      if (ranked.has(type)) {
        group.sort((a, b) => {
          if ((a.rank === undefined) !== (b.rank === undefined)) return a.rank === undefined ? 1 : -1;
          if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
          return a.index - b.index;
        });
      }
      out.set(`${id} ${type}`, group.map(e => e.target));
    }
  }
  return out;
}

/** 0.3.0 and later: every group listed by rank, ties by stored position. */
async function listedByRank(dir: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const [id, edges] of await edgesByTask(dir)) {
    for (const type of new Set(edges.map(e => e.type))) {
      const group = edges.map((e, index) => ({ ...e, index })).filter(e => e.type === type);
      group.sort((a, b) => ((a.rank ?? "") === (b.rank ?? "") ? a.index - b.index : (a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
      out.set(`${id} ${type}`, group.map(e => e.target));
    }
  }
  return out;
}

/** Every file under `dir`, path → content, for "nothing changed". */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(p.slice(dir.length), await readFile(p, "utf-8"));
    }
  };
  await walk(dir);
  return out;
}

/** Tasks, titles, bodies and comment counts, for "data intact". */
async function content(dir: string): Promise<Map<string, { title: unknown; body: string; comments: string }>> {
  const out = new Map<string, { title: unknown; body: string; comments: string }>();
  for (const id of await readdir(join(dir, "tasks"))) {
    const comments = await readFile(join(dir, "tasks", id, "_comments.yaml"), "utf-8").catch(() => "");
    const parsed = parseYaml(comments) as { comments?: { id: string; body: string }[] } | null;
    out.set(id, {
      title: (await taskFrontmatter(dir, id))["title"],
      body: await taskBody(dir, id),
      comments: JSON.stringify((parsed?.comments ?? []).map(c => [c.id, c.body])),
    });
  }
  return out;
}

describe("an older backup is restored and upgraded (K161)", () => {
  it("a 0.1.0 backup ends at 0.4.0: data intact, every link ranked in the order 0.1.0 showed", async () => {
    await backupOf("seed-0.1.0");
    const shown = await shownOrder010(srcDir);
    const expected = await content(srcDir);

    const report = await restoreBackup(dstDir, [out], { mode: "bare" });

    expect(report.upgrade).toEqual({
      from: "0.1.0",
      to: "0.4.0",
      steps: [
        expect.objectContaining({ from: "0.1.0", to: "0.3.0", description: "Save the order of every task's links" }),
        expect.objectContaining({ from: "0.3.0", to: "0.4.0", description: "Move sidebar settings to the Views layout" }),
      ],
    });
    expect(report.created).toBe(expected.size);
    expect(report.badLines).toEqual([]);
    // The tracker keeps its own format and opens without an upgrade.
    expect(await readSchemaVersion(dstDir)).toBe(CURRENT_SCHEMA_VERSION);
    await expect(requireSupportedSchema(dstDir)).resolves.toBeUndefined();
    // Data intact.
    expect(await content(dstDir)).toEqual(expected);
    // Links ranked, each group listed as 0.1.0 showed it.
    for (const edges of (await edgesByTask(dstDir)).values()) {
      for (const e of edges) expect(e.rank, JSON.stringify(e)).toBeDefined();
    }
    expect(await listedByRank(dstDir)).toEqual(shown);
    // The retired `ranked:` setting went with the step.
    expect(await readFile(join(dstDir, "config", "workflow.yaml"), "utf-8")).not.toMatch(/ranked:/);
    expect(await isProvablyRanked(dstDir)).toBe(true);
  });

  it("a 0.3.0 backup ends at 0.4.0 with its data and link order unchanged", async () => {
    await backupOf("seed-0.3.0");
    const listed = await listedByRank(srcDir);
    const expected = await content(srcDir);

    const report = await restoreBackup(dstDir, [out], { mode: "bare" });

    expect(report.upgrade?.from).toBe("0.3.0");
    expect(report.upgrade?.to).toBe("0.4.0");
    expect(report.upgrade?.steps.map(s => `${s.from}>${s.to}`)).toEqual(["0.3.0>0.4.0"]);
    expect(await readSchemaVersion(dstDir)).toBe(CURRENT_SCHEMA_VERSION);
    await expect(requireSupportedSchema(dstDir)).resolves.toBeUndefined();
    expect(await content(dstDir)).toEqual(expected);
    expect(await listedByRank(dstDir)).toEqual(listed);
    expect(await isProvablyRanked(dstDir)).toBe(true);
  });

  it("a current backup reports no upgrade", async () => {
    await exportBackup(dstDir, { outputPath: out });
    const report = await restoreBackup(dstDir, [out], { mode: "merge" });
    expect(report.upgrade).toBeUndefined();
  });

  it("merged into a tracker with tasks, the backup's own ranked kinds decide its order and the tracker's tasks are not touched", async () => {
    await backupOf("seed-0.1.0");
    const shown = await shownOrder010(srcDir);
    // Precondition: the tracker's workflow.yaml sets no `ranked`, and at
    // least one group in the backup lists differently under the
    // backup's settings than in stored order. Without it this test
    // could not tell whose settings were used.
    expect(await rankedTypes(dstDir)).toEqual(new Set());
    const stored = new Map<string, string[]>();
    for (const [id, edges] of await edgesByTask(srcDir)) {
      for (const type of new Set(edges.map(e => e.type))) {
        stored.set(`${id} ${type}`, edges.filter(e => e.type === type).map(e => e.target));
      }
    }
    expect([...shown].some(([k, v]) => JSON.stringify(stored.get(k)) !== JSON.stringify(v))).toBe(true);

    // A task of the tracker's own, whose links were reordered: ranks
    // that disagree with stored order. Re-ranking the whole tracker
    // after the restore would put them back in stored order.
    const own = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
    const other = "01ZZZZZZZZZZZZZZZZZZZZZZZY";
    const project = ((parseYaml(await readFile(join(dstDir, "config", "projects.yaml"), "utf-8")) as {
      projects: { id: string; prefix: string }[];
    }).projects[0]) as { id: string; prefix: string };
    const taskMd = (id: string, key: string, rels: string): string => `---
id: ${id}
key: ${key}
project: ${project.id}
title: Own ${key}
status: todo
task_type: task
priority: medium
created_at: 2026-09-01T00:00:00.000Z
updated_at: 2026-09-01T00:00:00.000Z
${rels}---

Own body.
`;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dstDir, "tasks", own), { recursive: true });
    await mkdir(join(dstDir, "tasks", other), { recursive: true });
    await writeFile(join(dstDir, "tasks", own, "task.md"), taskMd(own, `${project.prefix}-900`,
      `relationships:\n  - type: relates_to\n    target: ${other}\n    rank: "0|t"\n  - type: relates_to\n    target: ${other}x\n    rank: "0|h"\n`));
    await writeFile(join(dstDir, "tasks", other, "task.md"), taskMd(other, `${project.prefix}-901`, ""));
    const ownBefore = await readFile(join(dstDir, "tasks", own, "task.md"), "utf-8");

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    expect(report.upgrade?.from).toBe("0.1.0");
    expect(await readFile(join(dstDir, "tasks", own, "task.md"), "utf-8")).toBe(ownBefore);
    const listed = await listedByRank(dstDir);
    for (const [k, v] of shown) expect(listed.get(k), k).toEqual(v);
  });
});

describe("the preview (dry run)", () => {
  it("names the upgrade and its steps, and writes nothing", async () => {
    await backupOf("seed-0.1.0");
    const before = await snapshot(dstDir);

    const report = await restoreBackup(dstDir, [out], { mode: "bare", dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.upgrade?.from).toBe("0.1.0");
    expect(report.upgrade?.to).toBe("0.4.0");
    expect(report.upgrade?.steps.map(s => s.description)).toEqual([
      "Save the order of every task's links",
      "Move sidebar settings to the Views layout",
    ]);
    // Each step says what it changes, as `loctt migrate` shows it.
    for (const s of report.upgrade?.steps ?? []) expect(s.changes).toMatch(/\w/);
    expect(report.created).toBeGreaterThan(0);
    expect(await snapshot(dstDir)).toEqual(before);
  });
});

describe("what stays refused", () => {
  it("a newer backup, naming the release, writing nothing", async () => {
    await exportBackup(dstDir, { outputPath: out });
    const lines = (await readFile(out, "utf-8")).split("\n");
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
    header["schema_version"] = "0.5.0";
    lines[0] = JSON.stringify(header);
    await writeFile(out, lines.join("\n"), "utf-8");
    const before = await snapshot(dstDir);

    await expect(restoreBackup(dstDir, [out], { mode: "merge" }))
      .rejects.toThrow("This tracker needs loctt 0.5.0 or newer.");
    expect(await snapshot(dstDir)).toEqual(before);
  });

  it("a format below every LocTT format, writing nothing", async () => {
    await backupOf("seed-0.1.0");
    const lines = (await readFile(out, "utf-8")).split("\n");
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
    header["schema_version"] = "0.0.9";
    lines[0] = JSON.stringify(header);
    await writeFile(out, lines.join("\n"), "utf-8");
    const before = await snapshot(dstDir);

    const err = await restoreBackup(dstDir, [out], { mode: "bare" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupFormatError);
    expect((err as Error).message).toBe(
      "this backup records format 0.0.9, which isn't a LocTT format. Nothing has been restored.",
    );
    expect(await snapshot(dstDir)).toEqual(before);
  });
});

describe("an upgrade step that fails (K161)", () => {
  it("leaves the tracker exactly as it was and says nothing was restored", async () => {
    vi.doMock("../schema/steps/rank-every-link.js", async (orig) => ({
      ...(await orig<typeof import("../schema/steps/rank-every-link.js")>()),
      rankEveryLink: () => Promise.reject(new Error("disk full")),
    }));
    vi.resetModules();
    const mod = await import("./restore.js");
    const { exportBackup: exportFresh } = await import("./export.js");

    await cp(join(FIXTURES, "seed-0.1.0", ".loctt"), srcDir, { recursive: true });
    await exportFresh(srcDir, { outputPath: out });
    // A tracker with work in it, restored into with --merge: the mode
    // where a half-applied restore would mix the two.
    await withStateLock(dstDir, async () => {
      const state = await loadState(dstDir);
      const cfg = await loadProjectsConfig(dstDir);
      await createTask({ locttDir: dstDir, state, options: { project: cfg.projects[0]?.id as string, title: "Mine" } });
      await saveState(dstDir, state);
    });
    const before = await snapshot(dstDir);

    const err = await mod.restoreBackup(dstDir, [out], { mode: "merge" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mod.RestoreUpgradeError);
    expect((err as Error).message).toBe(
      "this backup's data couldn't be upgraded from format 0.1.0 to 0.4.0 (disk full). Nothing has been restored.",
    );
    expect(await snapshot(dstDir)).toEqual(before);
    expect(await readSchemaVersion(dstDir)).toBe(CURRENT_SCHEMA_VERSION);
    // The error class the surfaces map is the one core exports.
    expect(RestoreUpgradeError.name).toBe("RestoreUpgradeError");
  });
});

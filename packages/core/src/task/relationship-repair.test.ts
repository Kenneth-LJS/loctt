/**
 * The relationship repair (K140, K141): detection by doctor, the repair,
 * what it refuses, and that a second run changes nothing.
 *
 * The fixture is what a tracker built by `loctt create --parent KEY`
 * before the fix looks like (key-valued targets, no inverse on the
 * parent), plus the hand-edit shapes K141 makes the repair cover.
 *
 * @verifies REL-C7
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkflowConfig } from "../config/workflow.js";
import { runDoctor } from "../diagnostics/doctor.js";
import { checkDataIntegrity } from "../diagnostics/integrity.js";
import { initLoctt } from "../init/init.js";
import { getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { rebuildKeyIndex } from "../state/key-index.js";
import { readHistory } from "./history.js";
import { readTask } from "./io.js";
import { planRelationshipRepairOnDisk, repairActionCount, repairRelationships } from "./relationship-repair.js";
import { validateRelationships } from "./traversal.js";

let seq = 0;
/** A 26-char Crockford id, sortable in creation order. */
function nextId(): string {
  seq += 1;
  return `01J0000000000000000000${String(seq).padStart(4, "0")}`;
}

describe("repairRelationships (K141)", () => {
  let root: string;
  let locttDir: string;
  let project: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-rel-repair-"));
    await initLoctt(root, { prefix: "GAME", docs: false, timezone: "UTC" });
    locttDir = resolveLocttDir(root);
    const projects = await readFile(join(locttDir, "config", "projects.yaml"), "utf-8");
    project = /id: (\S+)/.exec(projects)?.[1] ?? "";
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Writes a task file by hand, the way a hand-edit or the old bug left it. */
  async function writeRaw(key: string, relationships: string, extra = ""): Promise<string> {
    const id = nextId();
    await mkdir(join(locttDir, "tasks", id), { recursive: true });
    await writeFile(getTaskFilePath(locttDir, id), [
      "---",
      `id: ${id}`,
      `key: ${key}`,
      `title: ${key} title`,
      "created_at: 2026-09-01T00:00:00.000Z",
      "updated_at: 2026-09-01T00:00:00.000Z",
      `project: ${project}`,
      "status: backlog",
      ...(extra === "" ? [] : [extra]),
      ...(relationships === "" ? [] : [relationships]),
      "---",
      "",
    ].join("\n"), "utf-8");
    return id;
  }

  /**
   * A `relationships` block. Every link carries a rank since K143 (a
   * 0.2.x tracker gets them from the 0.1.0 → 0.3.0 upgrade before any
   * repair runs), so a link given without one gets "u"; pass `null` for
   * a hand-edited link that has none.
   */
  const rels = (...edges: [string, string, (string | null)?][]): string =>
    ["relationships:", ...edges.flatMap(([type, target, rank]) => [
      `  - type: ${type}`,
      `    target: ${target}`,
      ...(rank === null ? [] : [`    rank: ${rank ?? "u"}`]),
    ])].join("\n");

  /** The ranks of `type` links on a task, in stored order. */
  async function ranksOf(id: string, type: string): Promise<(string | undefined)[]> {
    return ((await readTask(locttDir, id)).frontmatter.relationships ?? [])
      .filter(r => r.type === type).map(r => r.rank);
  }

  async function fileOf(id: string): Promise<string> {
    return readFile(getTaskFilePath(locttDir, id), "utf-8");
  }

  describe("the reported tracker: create --parent KEY, before the fix", () => {
    let parent: string;
    let children: string[];

    beforeEach(async () => {
      parent = await writeRaw("GAME-4", "");
      children = [];
      for (let i = 5; i <= 7; i += 1) {
        children.push(await writeRaw(`GAME-${String(i)}`, rels(["parent", "GAME-4"])));
      }
      await rebuildKeyIndex(locttDir);
    });

    it("doctor names each key-valued target and offers the repair", async () => {
      const findings = await checkDataIntegrity(locttDir);
      expect(findings).toHaveLength(3);
      for (const [i, f] of findings.entries()) {
        expect(f.severity).toBe("inconsistent");
        expect(f.path).toBe(getTaskFilePath(locttDir, children[i] as string));
        expect(f.message).toBe(
          `relationships[0].target: target "GAME-4" is a task key, not a task id. `
          + `The relationship repair rewrites it to GAME-4's id.`,
        );
      }
      const checks = await runDoctor(root);
      const rel = checks.find(c => c.name === "relationships");
      expect(rel?.status).toBe("warn");
      expect(rel?.fix).toBe("repair-relationships");
      // 3 rewrites + 3 missing sides on the parent.
      expect(rel?.message).toBe(
        "3 issue(s) found. 6 can be fixed with loctt doctor --repair-relationships",
      );
    });

    it("rewrites each target to the id, adds the child links, and leaves doctor clean", async () => {
      const plan = await repairRelationships(locttDir);
      expect(plan.rewrites).toHaveLength(3);
      expect(plan.inverses).toHaveLength(3);

      for (const c of children) {
        expect((await readTask(locttDir, c)).frontmatter.relationships).toEqual([
          { type: "parent", target: parent, rank: "u" },
        ]);
        // The rewrite writes no history (A357): no existing kind says
        // "the same link, stored correctly".
        expect(await readHistory(locttDir, c)).toEqual([]);
      }
      // The added sides carry ranks (K143), ascending in the order added.
      const added = (await readTask(locttDir, parent)).frontmatter.relationships ?? [];
      expect(added.map(r => ({ type: r.type, target: r.target }))).toEqual(
        children.map(c => ({ type: "child", target: c })),
      );
      const addedRanks = added.map(r => r.rank ?? "");
      expect(addedRanks.every(r => r !== "")).toBe(true);
      expect([...addedRanks].sort()).toEqual(addedRanks);
      expect(new Set(addedRanks).size).toBe(addedRanks.length);
      // The added side gets the `link_added` entry `link` writes.
      const history = await readHistory(locttDir, parent);
      expect(history.map(h => [h.kind, h.meta?.["type"], h.meta?.["target"]])).toEqual(
        children.map(c => ["link_added", "child", c]),
      );

      expect(await checkDataIntegrity(locttDir)).toEqual([]);
      const checks = await runDoctor(root);
      expect(checks.find(c => c.name === "relationships")).toBeUndefined();
      expect(checks.filter(c => c.status !== "ok")).toEqual([]);
    });

    it("is a no-op the second time: nothing planned, no file changes", async () => {
      await repairRelationships(locttDir);
      const before = await Promise.all([parent, ...children].map(fileOf));
      const again = await repairRelationships(locttDir);
      expect(repairActionCount(again)).toBe(0);
      expect(again.changes.size).toBe(0);
      expect(await Promise.all([parent, ...children].map(fileOf))).toEqual(before);
    });

    it("doctor --repair-relationships repairs first, then reports what is left", async () => {
      const checks = await runDoctor(root, { repairRelationships: true });
      expect(checks.find(c => c.name === "relationship repair")).toEqual({
        name: "relationship repair",
        status: "ok",
        message: "repaired: 3 key(s) rewritten to ids, 3 missing side(s) added",
      });
      expect(checks.filter(c => c.status !== "ok")).toEqual([]);
    });

    it("doctor --fix runs the index rebuild and the relationship repair", async () => {
      const checks = await runDoctor(root, { fix: true });
      expect(checks.find(c => c.name === "key index rebuild")?.status).toBe("ok");
      expect(checks.find(c => c.name === "relationship repair")?.message)
        .toBe("repaired: 3 key(s) rewritten to ids, 3 missing side(s) added");
      expect(checks.filter(c => c.status !== "ok")).toEqual([]);
    });
  });

  it("resolves a former key through key_history, and keeps the edge's rank", async () => {
    const parent = await writeRaw("GAME-50", "", "key_history:\n  - GAME-4");
    const child = await writeRaw("GAME-51", rels(["parent", "GAME-4", "m"]));
    await repairRelationships(locttDir);
    expect((await readTask(locttDir, child)).frontmatter.relationships).toEqual([
      { type: "parent", target: parent, rank: "m" },
    ]);
    // The added side is ranked at the end of its group (K143).
    expect((await readTask(locttDir, parent)).frontmatter.relationships).toEqual([
      { type: "child", target: child, rank: "u" },
    ]);
  });

  it("merges identical links into one, keeping the first position and a rank", async () => {
    const a = await writeRaw("GAME-1", "");
    const b = await writeRaw("GAME-2", "");
    // One link stored as a key and again as the id: identical once the
    // key is rewritten. Plus a plain duplicate.
    const c = await writeRaw("GAME-3", rels(
      ["blocks", "GAME-1", null],
      ["relates_to", b, "p"],
      ["blocks", a, "k"],
      ["relates_to", b],
    ));
    const plan = await repairRelationships(locttDir);
    expect(plan.merges).toEqual([
      { taskId: c, taskKey: "GAME-3", type: "blocks", target: a, removed: 1 },
      { taskId: c, taskKey: "GAME-3", type: "relates_to", target: b, removed: 1 },
    ]);
    expect((await readTask(locttDir, c)).frontmatter.relationships).toEqual([
      { type: "blocks", target: a, rank: "k" },
      { type: "relates_to", target: b, rank: "p" },
    ]);
    expect(await checkDataIntegrity(locttDir)).toEqual([]);
  });

  it("completes a one-sided link from either side, including a symmetric one", async () => {
    const a = await writeRaw("GAME-1", "");
    const b = await writeRaw("GAME-2", rels(["child", a]));   // only the parent's side
    const c = await writeRaw("GAME-3", rels(["relates_to", a]));
    await repairRelationships(locttDir);
    expect((await readTask(locttDir, a)).frontmatter.relationships).toEqual([
      { type: "parent", target: b, rank: "u" },
      { type: "relates_to", target: c, rank: "u" },
    ]);
    expect(await checkDataIntegrity(locttDir)).toEqual([]);
  });

  // K143: a link stored without a rank (a hand-edit, a merge from a
  // branch written before 0.3.0) is ranked at the end of its group, in
  // the order it is listed; ranked links keep their rank.
  // @verifies REL-C10
  it("ranks links that have none after the ranked ones, in stored order, and counts them", async () => {
    const a = await writeRaw("GAME-1", "");
    const b = await writeRaw("GAME-2", "");
    const c = await writeRaw("GAME-3", "");
    const holder = await writeRaw("GAME-4", rels(
      ["relates_to", c, null],
      ["relates_to", a, "k"],
      ["relates_to", b, null],
    ));
    for (const [id, other] of [[a, holder], [b, holder], [c, holder]] as const) {
      await writeFile(getTaskFilePath(locttDir, id), (await fileOf(id)).replace(
        "status: backlog\n", `status: backlog\nrelationships:\n  - type: relates_to\n    target: ${other}\n    rank: u\n`,
      ), "utf-8");
    }
    const findings = await checkDataIntegrity(locttDir);
    expect(findings.map(f => f.message.split(":")[0])).toEqual(["relationships[0].rank", "relationships[2].rank"]);

    const plan = await repairRelationships(locttDir);
    expect(plan.ranked).toEqual([{ taskId: holder, taskKey: "GAME-4", count: 2 }]);
    expect(repairActionCount(plan)).toBe(2);
    const ranks = await ranksOf(holder, "relates_to");
    // Positions unchanged; the ranked one keeps "k"; the two unranked
    // ones sort after it, first-stored first.
    expect(ranks[1]).toBe("k");
    expect((ranks[0] ?? "") > "k").toBe(true);
    expect((ranks[2] ?? "") > (ranks[0] ?? "")).toBe(true);
    expect(await checkDataIntegrity(locttDir)).toEqual([]);
  });

  it("refuses a missing side that would create a loop, and reports it", async () => {
    // A is B's child, both sides present. A also lists B as its own
    // child, one-sided. Completing that would make B A's child as well:
    // a loop on a tree.
    const aId = nextId();
    const bId = nextId();
    seq -= 2;
    const a = await writeRaw("GAME-1", rels(["parent", bId], ["child", bId]));
    const b = await writeRaw("GAME-2", rels(["child", aId]));
    expect([a, b]).toEqual([aId, bId]);
    const before = await fileOf(b);

    const plan = await repairRelationships(locttDir);
    expect(plan.refused).toEqual([{
      taskId: a, taskKey: "GAME-1", type: "child", target: b, targetKey: "GAME-2",
      missingType: "parent", reason: "loop",
    }]);
    expect(await fileOf(b)).toBe(before);
    const findings = await checkDataIntegrity(locttDir);
    expect(findings.map(f => f.message)).toEqual([
      `relationships[1]: "child" points at "${b}", but that task has no matching `
      + `"parent" back to this one. Adding it would create a loop, so the relationship `
      + `repair leaves it. Remove one of the links in the loop.`,
    ]);
  });

  it("never deletes a target it cannot resolve: missing, ambiguous, or its own key", async () => {
    const holder = await writeRaw("GAME-9", "");
    // Reconciliation left GAME-9 current on one task and former on another.
    await writeRaw("GAME-10", "", "key_history:\n  - GAME-9");
    const x = await writeRaw("GAME-11", rels(["blocks", "NOPE-7"], ["relates_to", "GAME-9"], ["relates_to", "GAME-11"]));
    const before = await fileOf(x);

    const plan = await repairRelationships(locttDir);
    expect(plan.unresolved.map(u => [u.target, u.reason])).toEqual([
      ["NOPE-7", "missing"],
      ["GAME-9", "ambiguous"],
      ["GAME-11", "self"],
    ]);
    expect(await fileOf(x)).toBe(before);
    expect((await readTask(locttDir, holder)).frontmatter.relationships).toBeUndefined();
    const messages = (await checkDataIntegrity(locttDir)).map(f => f.message);
    expect(messages).toEqual([
      `relationships[0].target: target task "NOPE-7" does not exist`,
      `relationships[1].target: target "GAME-9" is a key more than one task has had, so it `
      + `can't be matched to one task. Remove this link, then link the right task.`,
      `relationships[2].target: target "GAME-11" is this task's own key. A task can't link `
      + `to itself. Remove this link.`,
    ]);
    // Nothing repairable, so doctor does not offer the repair.
    const rel = (await runDoctor(root)).find(c => c.name === "relationships");
    expect(rel?.fix).toBeUndefined();
  });

  it("leaves a task whose links can't be read untouched, and says so", async () => {
    const broken = await writeRaw("GAME-1", "relationships: not-a-list");
    const a = await writeRaw("GAME-2", rels(["blocks", broken]));
    const before = await fileOf(broken);
    const plan = await repairRelationships(locttDir);
    expect(plan.refused.map(r => [r.taskId, r.reason])).toEqual([[a, "target_unreadable"]]);
    expect(plan.unreadable.map(u => u.taskId)).toEqual([broken]);
    expect(await fileOf(broken)).toBe(before);
  });

  it("doctor plans exactly what the repair then does", async () => {
    const p = await writeRaw("GAME-1", "");
    await writeRaw("GAME-2", rels(["parent", "GAME-1"]));
    await writeRaw("GAME-3", rels(["child", p]));
    const config = await loadWorkflowConfig(locttDir);
    const planned = await planRelationshipRepairOnDisk(locttDir, config);
    const done = await repairRelationships(locttDir, config);
    expect(done.rewrites).toEqual(planned.rewrites);
    expect(done.inverses).toEqual(planned.inverses);
    expect(await validateRelationships(locttDir, config)).toEqual([]);
  });
});

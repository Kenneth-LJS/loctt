import { readFile } from "node:fs/promises";

import type { Task, TaskRelationship } from "@loctt/contracts";
import { parse as parseYaml, parseDocument } from "yaml";

import { findRetiredRelationshipKeys, stripRetiredRelationshipKeys } from "../../config/retired-keys.js";
import { getWorkflowConfigPath } from "../../paths/index.js";
import { evenlySpacedRanks } from "../../rank/lexorank.js";
import { fillMissingRanks } from "../../task/edge-rank.js";
import { readTask, writeTask } from "../../task/io.js";
import { listTaskIds } from "../../task/list-ids.js";
import { compareRankedEdges } from "../../task/relationship-order.js";

/**
 * The 0.1.0 → 0.3.0 upgrade step (K142, K143): every link gets a rank,
 * in the order it is shown today, and the retired `ranked` setting is
 * removed from workflow.yaml.
 *
 * ## The order shown today (format 0.1.0)
 *
 * Per task, per link type (A357's `orderRelationships` before K143):
 *
 * - a kind with `ranked: true` in workflow.yaml (both its sides): ranked
 *   links by rank, then unranked links in stored order;
 * - any other kind, and a type workflow.yaml does not declare: stored
 *   order, ignoring any rank a link carries (REL-33 kept the ranks of a
 *   kind switched to `ranked: false`, and the page stopped using them).
 *
 * ## What it writes
 *
 * For each group, the unranked links are ranked after the group's
 * highest rank, in stored order (`fillMissingRanks`), which reproduces
 * the order above whenever the ranks the group already has agree with
 * it. When they do not (an unranked kind whose stale ranks disagree
 * with stored order, or a rank outside the lexorank alphabet that sorts
 * where it wasn't shown), the whole group is re-ranked evenly in the
 * order shown today. Either way, after the step the listing (ranked by
 * rank, K143) is exactly the listing before it.
 *
 * Within each type, the links are also stored in that order (each type
 * keeps the array positions it had; only its own links swap among
 * them). Stored order then agrees with rank order, which is what makes
 * the step idempotent without knowing whether it ran: a second run
 * reads no `ranked` setting (the first removed it), takes stored order
 * as the order shown, and finds it already ranked that way.
 *
 * Only `relationships` changes. `updated_at` and history are not touched:
 * this is a change of format, not an edit anyone made. A task that can't
 * be read, or whose `relationships` can't be, is left as it is; doctor
 * reports it, and the relationship repair ranks its links once it is
 * fixed.
 *
 * Idempotent: a second run finds every link ranked in listed order and
 * writes nothing.
 */
export async function rankEveryLink(locttDir: string): Promise<void> {
  const rankedTypes = await legacyRankedTypes(locttDir);
  for (const id of await listTaskIds(locttDir)) {
    let task: Task;
    try {
      task = await readTask(locttDir, id);
    } catch {
      continue;
    }
    if ((task.health ?? []).some(h => h.field === "relationships" || h.field.startsWith("relationships["))) continue;
    const rels = task.frontmatter.relationships;
    if (rels === undefined || rels.length === 0) continue;
    const next = rankInShownOrder(rels, rankedTypes);
    if (next === rels) continue;
    await writeTask(locttDir, id, {
      ...task,
      frontmatter: { ...task.frontmatter, relationships: [...next] },
    }, new Set(["relationships"]));
  }
  await stripRetiredRelationshipKeys(locttDir);
}

/**
 * Ranks the unranked links on the given tasks, the way the upgrade step
 * ranks them: after the highest rank already in the link's group, in
 * stored order (`fillMissingRanks`, the first half of
 * {@link rankInShownOrder}). Git sync runs it over the tasks it applied,
 * so links published by a loctt that did not rank them arrive ranked and
 * doctor has nothing left over (K151, B46).
 *
 * Only the fill, not the step's even re-rank: that re-rank reproduces
 * the order 0.1.0 *showed* for a group whose ranks disagree with stored
 * order, and on a 0.3.0 tracker such a group is simply one someone
 * reordered (a reorder rewrites the moved link's rank, not its array
 * position). Re-ranking it by stored order would undo that reorder.
 *
 * Like the step, it changes only `relationships` and leaves `updated_at`
 * and history alone, and it skips a task that cannot be read or whose
 * `relationships` cannot. Returns how many tasks it wrote.
 */
export async function rankUnrankedLinks(locttDir: string, taskIds: Iterable<string>): Promise<number> {
  let written = 0;
  for (const id of new Set(taskIds)) {
    let task: Task;
    try {
      task = await readTask(locttDir, id);
    } catch {
      continue;
    }
    if ((task.health ?? []).some(h => h.field === "relationships" || h.field.startsWith("relationships["))) continue;
    const rels = task.frontmatter.relationships;
    if (rels === undefined || rels.length === 0) continue;
    const next = fillMissingRanks(rels);
    if (next === rels) continue;
    await writeTask(locttDir, id, {
      ...task,
      frontmatter: { ...task.frontmatter, relationships: [...next] },
    }, new Set(["relationships"]));
    written += 1;
  }
  return written;
}

/**
 * The upgrade step's full ranking ({@link rankInShownOrder}) on the given
 * tasks: every link ranked so each group lists as format 0.1.0 showed it
 * under `rankedTypes`. Git sync runs it over the tasks it applied from a
 * branch whose `.schema-version` is below 0.3.0, with that branch's own
 * workflow.yaml, because such a branch's stored order is its shown order
 * (K151, A366). Changes only `relationships`, like the step. Returns how
 * many tasks it wrote.
 */
export async function rankLinksInShownOrder(
  locttDir: string,
  taskIds: Iterable<string>,
  rankedTypes: ReadonlySet<string>,
): Promise<number> {
  let written = 0;
  for (const id of new Set(taskIds)) {
    let task: Task;
    try {
      task = await readTask(locttDir, id);
    } catch {
      continue;
    }
    if ((task.health ?? []).some(h => h.field === "relationships" || h.field.startsWith("relationships["))) continue;
    const rels = task.frontmatter.relationships;
    if (rels === undefined || rels.length === 0) continue;
    const next = rankInShownOrder(rels, rankedTypes);
    if (next === rels) continue;
    await writeTask(locttDir, id, {
      ...task,
      frontmatter: { ...task.frontmatter, relationships: [...next] },
    }, new Set(["relationships"]));
    written += 1;
  }
  return written;
}

/**
 * Whether the tracker's data is provably already in format 0.3.0, for a
 * repair that must stamp a `.schema-version` it lost: workflow.yaml sets
 * no retired `ranked` key, and every link on every task carries a rank.
 * A tracker with no links passes. Anything that can't be read (a task,
 * its `relationships`, a workflow.yaml that doesn't parse) fails: then
 * the caller stamps 0.1.0 and the upgrade step ranks the links, which is
 * harmless on data that turns out to be 0.3.0 already except that a
 * group whose ranks disagree with stored order is re-ranked in stored
 * order.
 */
export async function isProvablyRanked(locttDir: string): Promise<boolean> {
  let raw: string | undefined;
  try {
    raw = await readFile(getWorkflowConfigPath(locttDir), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  if (raw !== undefined) {
    if (parseDocument(raw).errors.length > 0) return false;
    if ((await findRetiredRelationshipKeys(locttDir)).length > 0) return false;
  }
  for (const id of await listTaskIds(locttDir)) {
    let task: Task;
    try {
      task = await readTask(locttDir, id);
    } catch {
      return false;
    }
    if ((task.health ?? []).some(h => h.field === "relationships" || h.field.startsWith("relationships["))) return false;
    if ((task.frontmatter.relationships ?? []).some(r => r.rank === undefined)) return false;
  }
  return true;
}

/**
 * The stored types (forward and inverse keys) of every kind set
 * `ranked: true` in workflow.yaml, read from the raw file: the schema no
 * longer carries the setting. An unreadable file reads as none ranked,
 * so every group keeps its stored order.
 */
async function legacyRankedTypes(locttDir: string): Promise<ReadonlySet<string>> {
  let raw: string;
  try {
    raw = await readFile(getWorkflowConfigPath(locttDir), "utf-8");
  } catch {
    return new Set();
  }
  return legacyRankedTypesIn(raw);
}

/**
 * {@link legacyRankedTypes} over a workflow.yaml's text (git sync reads
 * the branch's). Text that doesn't parse reads as none ranked.
 */
export function legacyRankedTypesIn(raw: string): ReadonlySet<string> {
  const out = new Set<string>();
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return out;
  }
  const rels = (parsed as { relationships?: unknown } | null)?.relationships;
  if (!Array.isArray(rels)) return out;
  for (const def of rels as unknown[]) {
    if (typeof def !== "object" || def === null) continue;
    const d = def as Record<string, unknown>;
    if (d["ranked"] !== true || typeof d["key"] !== "string") continue;
    out.add(d["key"]);
    if (d["kind"] !== "symmetric" && typeof d["inverse"] === "string") out.add(d["inverse"]);
  }
  return out;
}

/** Stored positions of one type's links, in the order 0.1.0 showed them. */
function shownOrder(
  rels: readonly TaskRelationship[],
  type: string,
  ranked: boolean,
): number[] {
  const rows = rels.flatMap((r, index) => (r.type === type ? [{ rank: r.rank, index }] : []));
  if (ranked) rows.sort(compareRankedEdges);
  return rows.map(r => r.index);
}

/** The same group's positions in the order 0.3.0 lists them (by rank). */
function listedOrder(rels: readonly TaskRelationship[], type: string): number[] {
  return rels
    .flatMap((r, index) => (r.type === type ? [{ rank: r.rank, index }] : []))
    .sort(compareRankedEdges)
    .map(r => r.index);
}

/**
 * `rels` with every link ranked so that 0.3.0 lists each group as 0.1.0
 * showed it, and each type's links stored in that order. Returns `rels`
 * itself when nothing needs to change.
 */
export function rankInShownOrder(
  rels: readonly TaskRelationship[],
  rankedTypes: ReadonlySet<string>,
): readonly TaskRelationship[] {
  let ranked = fillMissingRanks(rels);
  const types = [...new Set(rels.map(r => r.type))];
  const shownByType = new Map<string, number[]>();
  for (const type of types) {
    const shown = shownOrder(rels, type, rankedTypes.has(type));
    shownByType.set(type, shown);
    const listed = listedOrder(ranked, type);
    if (shown.every((index, i) => listed[i] === index)) continue;
    const fresh = evenlySpacedRanks(shown.length);
    const copy = [...ranked];
    shown.forEach((index, i) => {
      const edge = copy[index] as TaskRelationship;
      copy[index] = { ...edge, rank: fresh[i] as string };
    });
    ranked = copy;
  }
  // Store each type's links in shown order, in the slots that type holds.
  const out: TaskRelationship[] = [...ranked];
  for (const type of types) {
    const shown = shownByType.get(type) ?? [];
    const slots = [...shown].sort((a, b) => a - b);
    slots.forEach((slot, i) => { out[slot] = ranked[shown[i] as number] as TaskRelationship; });
  }
  const same = out.every((e, i) => {
    const r = rels[i];
    return r !== undefined && r.type === e.type && r.target === e.target && r.rank === e.rank
      && JSON.stringify(r) === JSON.stringify(e);
  });
  return same ? rels : out;
}

/**
 * check_script for upgrade-intentional (K142, K154): after the upgrade the user ran, every link has a
 * rank, and every group lists (by rank) exactly as 0.1.0 showed it —
 * computed from the frozen 0.1.0 seed with the 0.1.0 rule written out
 * here (a kind set `ranked: true` lists ranked links by rank, then
 * unranked in stored order; any other kind lists stored order), so the
 * upgrade step cannot vouch for itself.
 */

import { frozenSeedLoctt } from "../../lib/paths.ts";
import type { Relationship, TrackerView } from "../../lib/tracker.ts";
import { TrackerView as View } from "../../lib/tracker.ts";

function shownOrder(rels: readonly Relationship[], type: string, ranked: boolean): string[] {
  const group = rels.map((r, index) => ({ ...r, index })).filter(r => r.type === type);
  if (ranked) {
    group.sort((a, b) => {
      if ((a.rank === undefined) !== (b.rank === undefined)) return a.rank === undefined ? 1 : -1;
      if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
      return a.index - b.index;
    });
  }
  return group.map(r => r.target);
}

function listedOrder(rels: readonly Relationship[], type: string): string[] {
  return rels.map((r, index) => ({ ...r, index })).filter(r => r.type === type)
    .sort((a, b) => ((a.rank ?? "") === (b.rank ?? "") ? a.index - b.index : (a.rank ?? "") < (b.rank ?? "") ? -1 : 1))
    .map(r => r.target);
}

export default function check(tracker: TrackerView): void {
  // The frozen seed, read as the upgraded tracker's past.
  const before = new View(frozenSeedLoctt.replace(/\/\.loctt$/, ""));
  const wf = before.readYaml("config/workflow.yaml") as { relationships: Array<{ key: string; inverse?: string; kind?: string; ranked?: boolean }> };
  const ranked = new Set<string>();
  for (const d of wf.relationships) {
    if (d.ranked !== true) continue;
    ranked.add(d.key);
    if (d.kind !== "symmetric" && d.inverse !== undefined) ranked.add(d.inverse);
  }
  const problems: string[] = [];
  let groups = 0;
  for (const old of before.tasks()) {
    const now = tracker.task(old.id);
    const was = before.relationships(old);
    const is = tracker.relationships(now);
    for (const r of is) if (r.rank === undefined) problems.push(`${now.key}: ${r.type} → ${r.target} has no rank`);
    for (const type of new Set(was.map(r => r.type))) {
      groups += 1;
      const want = shownOrder(was, type, ranked.has(type));
      const got = listedOrder(is, type);
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        problems.push(`${now.key} ${type}: shown before ${JSON.stringify(want)}, listed now ${JSON.stringify(got)}`);
      }
    }
  }
  if (groups === 0) problems.push("the frozen seed has no links to compare");
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

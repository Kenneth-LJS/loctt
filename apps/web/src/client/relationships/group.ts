import type {
  RelationshipDef,
  ResolvedRelationshipResponse,
  TaskRelationship,
  WorkflowConfig,
} from "@loctt/contracts";
import {
  effectiveInverseKey,
  effectiveInverseLabel,
  isSymmetricRelationship,
} from "@loctt/contracts";

/**
 * Turning a task's flat relationship array into the grouped, ordered
 * shape the panel renders (REL-1..6, REL-25, REL-26, REL-34, XS-25).
 *
 * ## One group per *side*, not per definition
 *
 * REL-2. `blocks` / `is_blocked_by` is one definition in
 * `workflow.yaml` and two headings in the UI: a task holding a
 * `blocks` edge shows "Blocks", and the task on the other end of the
 * same edge shows "Is blocked by". Grouping by the definition would
 * put both under one heading and tell each side something false about
 * which way the edge points.
 *
 * REL-3 is the exception `kind: symmetric` exists for: there the
 * forward key and the inverse key are the same string, so the two
 * sides collapse to one group by construction rather than by a special
 * case here.
 *
 * ## Group order is declaration order
 *
 * REL-1's second bullet. `workflow.yaml`'s array order is the user's
 * stated priority, so it is walked in order and each definition
 * contributes its forward side then its inverse side. A kind with no
 * edges contributes nothing — REL-1's third bullet forbids padding
 * empty headings.
 *
 * Unknown types (REL-25, XS-25) come last, in first-seen order, each
 * as its own group keyed by the raw type string. Sorting them among
 * the configured ones would imply `workflow.yaml` has an opinion about
 * where a type it does not declare belongs.
 *
 * ## Row order inside a ranked group
 *
 * REL-6's third bullet and REL-34. Ranked edges sort by `rank`
 * ascending; unranked edges sort **below** all ranked ones, matching
 * core's ordering. Among unranked edges the tiebreak is the edge's
 * index in the task's own `relationships` array — REL-34's "documented
 * fallback (creation order in the array)".
 *
 * That tiebreak is written explicitly rather than left to
 * `Array.prototype.sort`'s stability, and the distinction is the
 * point: a stable sort over an already-ordered input is
 * indistinguishable from no sort at all, so a test asserting order
 * would stay green with the comparator deleted. Compared explicitly,
 * the comparator has an observable effect on an input that is *not*
 * already in output order — which is what a test can drive it with.
 *
 * An unranked group is not sorted at all: array order is what the file
 * says, and inventing an order for a kind the user never asked to rank
 * would be the UI having an opinion the data does not.
 */

/** One rendered relationship row. */
export interface RelationshipRow {
  /** The stored edge type — the side this task holds. */
  readonly type: string;
  /** The stored target ULID. Present even when the target is gone. */
  readonly target: string;
  readonly resolvedKey: string | undefined;
  readonly resolvedTitle: string | undefined;
  readonly resolvedStatus: string | undefined;
  /** True when the target ULID resolves to no task on disk (REL-24). */
  readonly missing: boolean;
  /**
   * True when the target is corrupt as opposed to merely missing (S4 /
   * corruption sweep). Two shapes:
   *   - `missing:false` + `targetCorrupt:true` — the target loaded via
   *     the tolerant read but carries health findings; the row links and
   *     keeps its key/title, marked as needing attention.
   *   - `missing:true` + `targetCorrupt:true` — the target is on disk but
   *     object-fatally unreadable: corrupt, not deleted.
   * A missing row with `targetCorrupt` falsy is a genuine dangling link.
   * Optional so the many test fixtures and the TreeRows synthetic-parent
   * row (never corrupt by construction) need not spell out `false`.
   */
  readonly targetCorrupt?: boolean;
  /** The edge's lexorank, when it carries one. */
  readonly rank: string | undefined;
  /** Index in the task's own `relationships` array — REL-34's fallback. */
  readonly index: number;
  /**
   * How many stored edges collapsed into this row (REL-26). Normally
   * 1; greater when the same type/target pair appears more than once
   * in the frontmatter, which is drift worth flagging rather than
   * hiding.
   */
  readonly duplicates: number;
}

/** One rendered group — a heading and its rows. */
export interface RelationshipGroup {
  /** The stored type key this group holds. */
  readonly key: string;
  /** The heading text: the configured label, or the raw key if unknown. */
  readonly label: string;
  /** True when no `workflow.yaml` definition claims this type. */
  readonly unknown: boolean;
  /** True when the kind is `ranked: true` — drives drag handles (REL-6). */
  readonly ranked: boolean;
  /** True when the kind's `graph` is `tree` — drives the nested render (REL-5). */
  readonly tree: boolean;
  readonly rows: readonly RelationshipRow[];
}

/**
 * Every offerable side of every configured relationship (REL-7).
 * Symmetric kinds contribute one entry; directional kinds contribute
 * their forward and inverse sides as separate, separately-labelled
 * options, because the user may want to state either direction.
 */
export interface LinkKindOption {
  /** The type key the link request carries. */
  readonly key: string;
  /** The label shown in the picker — never the key (REL-7). */
  readonly label: string;
}

/** Each configured side, in declaration order. */
export function linkKindOptions(
  workflow: WorkflowConfig | undefined,
): readonly LinkKindOption[] {
  const out: LinkKindOption[] = [];
  for (const def of workflow?.relationships ?? []) {
    out.push({ key: def.key, label: def.label });
    // REL-7's second bullet: a symmetric kind's inverse *is* its
    // forward side, so offering both would list one option twice under
    // one label.
    if (isSymmetricRelationship(def)) continue;
    out.push({ key: effectiveInverseKey(def), label: effectiveInverseLabel(def) });
  }
  return out;
}

/** The side descriptors a task's stored edges are grouped into. */
interface Side {
  readonly key: string;
  readonly label: string;
  readonly ranked: boolean;
  readonly tree: boolean;
}

/**
 * Every side a configured definition produces, in the order its groups
 * should appear.
 */
function sidesOf(def: RelationshipDef): readonly Side[] {
  const ranked = def.ranked === true;
  const tree = def.graph === "tree";
  const forward: Side = { key: def.key, label: def.label, ranked, tree };
  if (isSymmetricRelationship(def)) return [forward];
  return [
    forward,
    { key: effectiveInverseKey(def), label: effectiveInverseLabel(def), ranked, tree },
  ];
}

/**
 * Merges the resolved read shape with the stored edges.
 *
 * `GET /api/tasks/:ref` returns `relationships` resolved (key, title,
 * status, missing) but **without** `rank`, and returns the raw edges
 * under `frontmatter.relationships` **with** `rank` but unresolved.
 * The panel needs both, so they are zipped here by position: both
 * arrays are built from the same `frontmatter.relationships` in the
 * same order server-side (`resolveRelationships` maps over it).
 *
 * Position rather than (type, target) because that pair is not unique
 * — REL-26's duplicate case is exactly a file where it repeats.
 */
export function buildRows(
  resolved: readonly ResolvedRelationshipResponse[],
  stored: readonly TaskRelationship[] | undefined,
): readonly RelationshipRow[] {
  return resolved.map((r, i) => ({
    type: r.type,
    target: r.target,
    resolvedKey: r.resolvedKey,
    resolvedTitle: r.resolvedTitle,
    resolvedStatus: r.resolvedStatus,
    missing: r.missing,
    targetCorrupt: r.targetCorrupt === true,
    rank: stored?.[i]?.rank,
    index: i,
    duplicates: 1,
  }));
}

/**
 * Collapses rows naming the same (type, target) pair.
 *
 * REL-26: a hand-edited file can carry the same edge twice. The panel
 * lists the target once — but says so, via `duplicates`, rather than
 * quietly dropping the second copy. The first occurrence wins for rank
 * and index so the collapse does not move the row.
 */
function collapseDuplicates(
  rows: readonly RelationshipRow[],
): readonly RelationshipRow[] {
  const byPair = new Map<string, RelationshipRow>();
  const order: string[] = [];
  for (const row of rows) {
    const pair = `${row.type} ${row.target}`;
    const seen = byPair.get(pair);
    if (seen === undefined) {
      byPair.set(pair, row);
      order.push(pair);
      continue;
    }
    byPair.set(pair, { ...seen, duplicates: seen.duplicates + 1 });
  }
  return order.flatMap(pair => {
    const row = byPair.get(pair);
    return row === undefined ? [] : [row];
  });
}

/**
 * Orders the rows of one group. See the module docstring.
 */
export function orderRows(
  rows: readonly RelationshipRow[],
  ranked: boolean,
): readonly RelationshipRow[] {
  if (!ranked) return rows;
  return [...rows].sort((a, b) => {
    const aHas = a.rank !== undefined;
    const bHas = b.rank !== undefined;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) {
      return a.rank < b.rank ? -1 : 1;
    }
    // REL-34. Explicit, not `sort`'s stability: see the module
    // docstring for why the difference is the whole point.
    return a.index - b.index;
  });
}

/**
 * The panel's groups, in render order.
 *
 * @param resolved the response's `relationships`
 * @param stored the response's `frontmatter.relationships`
 * @param workflow the loaded workflow config, or undefined while it loads
 */
export function groupRelationships(
  resolved: readonly ResolvedRelationshipResponse[],
  stored: readonly TaskRelationship[] | undefined,
  workflow: WorkflowConfig | undefined,
): readonly RelationshipGroup[] {
  const rows = collapseDuplicates(buildRows(resolved, stored));

  const byType = new Map<string, RelationshipRow[]>();
  for (const row of rows) {
    const bucket = byType.get(row.type);
    if (bucket === undefined) byType.set(row.type, [row]);
    else bucket.push(row);
  }

  const groups: RelationshipGroup[] = [];
  const claimed = new Set<string>();

  for (const def of workflow?.relationships ?? []) {
    for (const side of sidesOf(def)) {
      claimed.add(side.key);
      const bucket = byType.get(side.key);
      // REL-1: a kind with no edges on this task renders no heading.
      if (bucket === undefined || bucket.length === 0) continue;
      groups.push({
        key: side.key,
        label: side.label,
        unknown: false,
        ranked: side.ranked,
        tree: side.tree,
        rows: orderRows(bucket, side.ranked),
      });
    }
  }

  // REL-25 / XS-25. An edge whose type no configured definition claims
  // is surfaced under its raw key rather than dropped: a hidden edge is
  // worse than a labelled unknown, and the user cannot remove a row
  // they cannot see.
  for (const row of rows) {
    if (claimed.has(row.type)) continue;
    if (groups.some(g => g.key === row.type)) continue;
    groups.push({
      key: row.type,
      label: row.type,
      unknown: true,
      ranked: false,
      tree: false,
      rows: byType.get(row.type) ?? [],
    });
  }

  return groups;
}

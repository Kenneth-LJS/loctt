import type { WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey, isSymmetricRelationship } from "@loctt/contracts";

/**
 * The one order a task's relationships are listed in, on every surface
 * (K141 6a).
 *
 * The web's task page grouped and sorted its rows itself, while `loctt
 * show` and MCP `get_task` printed the stored array as written. A task
 * whose children had been reordered showed them in rank order on the
 * web and in insertion order everywhere else, so two surfaces answered
 * "what are this task's children, in order?" differently.
 *
 * Browser-safe on purpose (imports only `@loctt/contracts`): the web
 * client imports this module through the `@loctt/core/task/
 * relationship-order.js` subpath, so the rule below exists once.
 *
 * ## The rule
 *
 * - **Groups in declaration order.** `workflow.yaml`'s `relationships`
 *   array is walked in order; each definition contributes its forward
 *   side, then its inverse side (a symmetric kind has one side). This is
 *   the web panel's REL-1 group order.
 * - **Unknown types last**, in first-seen order (REL-25, XS-25).
 * - **Inside a ranked side** (`ranked: true`): ranked edges by `rank`
 *   ascending, then unranked edges in array order (REL-6, REL-34).
 * - **Inside an unranked side**: array order, untouched.
 * - **No workflow config:** array order, untouched.
 */

/** The fields the ordering reads. `index` is the edge's stored position. */
export interface OrderableEdge {
  readonly type: string;
  readonly rank?: string | undefined;
}

/**
 * The comparator for the rows of one *ranked* side.
 *
 * Ranked before unranked; ranks ascending; ties (and every unranked
 * pair) by stored index. The index tiebreak is explicit rather than
 * left to `Array.prototype.sort`'s stability: a stable sort over input
 * already in output order is indistinguishable from no sort, so a test
 * could not tell the comparator was there (REL-34).
 */
export function compareRankedEdges(
  a: { readonly rank?: string | undefined; readonly index: number },
  b: { readonly rank?: string | undefined; readonly index: number },
): number {
  const aHas = a.rank !== undefined;
  const bHas = b.rank !== undefined;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) {
    return a.rank < b.rank ? -1 : 1;
  }
  return a.index - b.index;
}

/** One configured side: its stored type key and whether it is ranked. */
export interface RelationshipSide {
  readonly key: string;
  readonly ranked: boolean;
}

/** Every configured side, in the order its group is listed. */
export function relationshipSides(
  workflow: WorkflowConfig | undefined,
): readonly RelationshipSide[] {
  const out: RelationshipSide[] = [];
  for (const def of workflow?.relationships ?? []) {
    const ranked = def.ranked === true;
    out.push({ key: def.key, ranked });
    if (!isSymmetricRelationship(def)) {
      out.push({ key: effectiveInverseKey(def), ranked });
    }
  }
  return out;
}

/**
 * Returns `edges` in display order (see the module docstring). The
 * input is not modified; every edge appears exactly once in the output.
 */
export function orderRelationships<T extends OrderableEdge>(
  edges: readonly T[],
  workflow: WorkflowConfig | undefined,
): T[] {
  if (workflow === undefined) return [...edges];
  const indexed = edges.map((edge, index) => ({ edge, index, rank: edge.rank }));

  const byType = new Map<string, typeof indexed>();
  for (const row of indexed) {
    const bucket = byType.get(row.edge.type);
    if (bucket === undefined) byType.set(row.edge.type, [row]);
    else bucket.push(row);
  }

  const out: T[] = [];
  const claimed = new Set<string>();
  for (const side of relationshipSides(workflow)) {
    // A side listed twice (a malformed config) is listed once.
    if (claimed.has(side.key)) continue;
    claimed.add(side.key);
    const bucket = byType.get(side.key);
    if (bucket === undefined) continue;
    const rows = side.ranked ? [...bucket].sort(compareRankedEdges) : bucket;
    for (const row of rows) out.push(row.edge);
  }
  // Unknown types, first-seen order, each type's edges together.
  const unknownSeen = new Set<string>();
  for (const row of indexed) {
    const type = row.edge.type;
    if (claimed.has(type) || unknownSeen.has(type)) continue;
    unknownSeen.add(type);
    for (const r of byType.get(type) ?? []) out.push(r.edge);
  }
  return out;
}

import type { TaskFrontmatterPublic } from "@loctt/contracts";

/**
 * Dependency arrows for the timeline (M3.3a: TML-14).
 *
 * ## Why filtering on the forward key is sufficient — and necessary
 *
 * A `blocks` link is stored on **both** tasks: the source carries
 * `{type: "blocks", target: <id>}` and the target carries the
 * materialized inverse `{type: "is_blocked_by", target: <id>}`.
 * (Measured: `loctt link T1 blocks T2` writes exactly that pair.)
 *
 * So collecting only edges whose `type` equals the configured key
 * gives one edge per link, pointing the right way, for free. That is
 * TML-14's third bullet — "arrow direction follows the forward edge
 * (source `blocks` target), not the inverse" — and it is also why no
 * de-duplication pass is needed: reading both directions and then
 * de-duplicating would be the version that can get the direction
 * wrong.
 *
 * The second bullet ("**No** arrows appear for `depends_on` or
 * `parent` links, even though those relationships exist on the same
 * tasks") falls out of the same filter: exactly one key is configured,
 * and every other type is skipped, including the inverse of the
 * configured one.
 */

/** An arrow between two rows, in task-id terms. */
export interface DependencyEdge {
  /** Source task id — the end the arrow leaves. */
  readonly from: string;
  /** Target task id — the end the arrow points at. */
  readonly to: string;
}

/**
 * Edges to draw, given the tasks in scope and the configured
 * relationship key.
 *
 * `undefined` key → no edges (TML-14: "with `dependency_relationship`
 * absent or null, no arrows are drawn at all"). A key that names a
 * relationship the workflow no longer defines also yields no edges,
 * because no stored link carries that type — which is exactly the
 * "no arrows" half of TML-34, with the notice left to M3.3b.
 *
 * Edges whose other end is not in scope are dropped: an arrow to a row
 * that is not on screen has nowhere to land. This is a filter on
 * *rendering*, not on data — the link still exists and the task detail
 * still shows it.
 */
export function dependencyEdges(
  tasks: readonly TaskFrontmatterPublic[],
  relationshipKey: string | undefined,
): readonly DependencyEdge[] {
  if (relationshipKey === undefined) return [];
  const inScope = new Set(tasks.map(t => t.id));
  const edges: DependencyEdge[] = [];
  for (const task of tasks) {
    for (const rel of task.relationships ?? []) {
      if (rel.type !== relationshipKey) continue;
      if (!inScope.has(rel.target)) continue;
      // A self-link would render as an arrow from a bar to itself:
      // visually meaningless, and the path math degenerates.
      if (rel.target === task.id) continue;
      edges.push({ from: task.id, to: rel.target });
    }
  }
  return edges;
}

/** Where an arrow attaches to a bar. */
export interface Anchor {
  readonly x: number;
  readonly y: number;
}

/**
 * SVG path for one arrow: out of the right edge of the source bar,
 * into the left edge of the target bar.
 *
 * An orthogonal three-segment route rather than a straight line. A
 * straight diagonal crosses whatever bars lie between the two rows and
 * becomes unreadable the moment more than a couple of arrows overlap;
 * the stepped route reads as a connector even when several share
 * vertical space.
 *
 * When the target starts at or before the source ends (a link that
 * runs backwards in time — legitimate, and common while dates are
 * being sorted out), the midpoint would fall behind the source's own
 * edge and the path would double back through the bar. `Math.max`
 * pushes the turn a fixed stub past the source instead, so the arrow
 * still leaves and arrives horizontally.
 */
export function arrowPath(from: Anchor, to: Anchor, stub = 12): string {
  const midX = Math.max(from.x + stub, to.x - stub);
  return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`;
}

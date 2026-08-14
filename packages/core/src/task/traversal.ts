import type { Task, WorkflowConfig } from "@loctt/contracts";
import { relationshipTypeKeys } from "@loctt/contracts";

import { loadAllTasks } from "./load-all.js";

/** Validates that all relationship targets exist and types are valid. */
export interface RelationshipValidationError {
  readonly taskId: string;
  readonly field: string;
  readonly message: string;
}

/**
 * Validates relationships across all tasks.
 * Checks that targets exist and types are defined in config.
 */
export async function validateRelationships(
  locttDir: string,
  config: WorkflowConfig,
): Promise<readonly RelationshipValidationError[]> {
  const tasks = await loadAllTasks(locttDir);
  const taskIds = new Set(tasks.map(t => t.frontmatter.id));
  const validTypes = new Set(
    config.relationships.flatMap(relationshipTypeKeys),
  );

  const errors: RelationshipValidationError[] = [];

  for (const task of tasks) {
    const rels = task.frontmatter.relationships ?? [];
    for (const [i, rel] of rels.entries()) {
      if (!validTypes.has(rel.type)) {
        errors.push({
          taskId: task.frontmatter.id,
          field: `relationships[${i}].type`,
          message: `unknown relationship type "${rel.type}"`,
        });
      }
      if (!taskIds.has(rel.target)) {
        errors.push({
          taskId: task.frontmatter.id,
          field: `relationships[${i}].target`,
          message: `target task "${rel.target}" does not exist`,
        });
      }
    }
  }

  return errors;
}

/**
 * Gets all tasks related to a given task by a specific relationship type.
 * Returns targets where the source task has the specified relationship type.
 */
export function getRelatedTasks(
  task: Task,
  relType: string,
): readonly string[] {
  return (task.frontmatter.relationships ?? [])
    .filter(r => r.type === relType)
    .map(r => r.target);
}

/**
 * The adjacency map plus whatever cycles it contains.
 *
 * `cycles` is empty for well-formed data. When it isn't, `edges` still
 * holds every edge — callers render the acyclic part and surface the
 * cycles rather than failing outright, since a cycle can arrive from a
 * git merge that no single operation performed.
 */
export interface TreeIndex {
  /** parent id → child ids. Roots are keyed under `""`. */
  readonly edges: Map<string, string[]>;
  /** Cycles along this axis; empty when the graph is a DAG. */
  readonly cycles: readonly StructuralCycle[];
}

/**
 * Builds the parent→children adjacency map along `axis`, and reports
 * any cycles in it.
 *
 * Tasks with no `axis` edge are roots (keyed under `""`). Tasks with
 * several appear under each parent — a DAG is permitted; only true
 * cycles are reported.
 *
 * **Why cycles are reported here rather than left to the caller.** The
 * link-time guard reads config as it stands at link time, so a cycle
 * still reaches this data three ways: flipping the kind to
 * `graph: none`, creating the cycle and flipping back; a direct edit of
 * `task.md`; or a git sync merging two halves that were each innocent.
 * On cyclic data this function used to return a map with an **empty
 * roots list** — so a renderer starting from roots drew an empty tree
 * with no explanation, and one starting anywhere else recursed
 * forever. Returning the cycles makes that state impossible to miss.
 *
 * Costs one extra O(V+E) pass over the map just built.
 */
export function buildTree(tasks: readonly Task[], axis: string): TreeIndex {
  const edges = new Map<string, string[]>();
  const roots: string[] = [];
  edges.set("", roots);

  // parent edges per task, kept for the cycle walk below.
  const parentsOf = new Map<string, readonly string[]>();

  for (const task of tasks) {
    const parentTargets = getRelatedTasks(task, axis);
    parentsOf.set(task.frontmatter.id, parentTargets);
    if (parentTargets.length === 0) {
      roots.push(task.frontmatter.id);
    } else {
      for (const parentId of parentTargets) {
        const children = edges.get(parentId) ?? [];
        children.push(task.frontmatter.id);
        edges.set(parentId, children);
      }
    }
  }

  return { edges, cycles: findCyclesIn(parentsOf, axis) };
}

/**
 * Iterative 3-colour DFS over a child→parents map. Mirrors
 * {@link findStructuralCycles}'s algorithm but walks an already-built
 * index rather than re-reading the corpus, so `buildTree` pays one
 * pass rather than two.
 *
 * Each cycle is canonicalized to start at its lowest id so repeated
 * runs report identical paths.
 */
function findCyclesIn(
  parentsOf: ReadonlyMap<string, readonly string[]>,
  axis: string,
): readonly StructuralCycle[] {
  const cycles: StructuralCycle[] = [];
  const seen = new Set<string>();
  const colour = new Map<string, "grey" | "black">();

  for (const start of parentsOf.keys()) {
    if (colour.get(start) === "black") continue;

    // path doubles as the grey set's ordering, so a back-edge can be
    // sliced straight out of it.
    const path: string[] = [];
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    colour.set(start, "grey");
    path.push(start);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const parents = parentsOf.get(frame.id) ?? [];

      if (frame.next >= parents.length) {
        colour.set(frame.id, "black");
        path.pop();
        stack.pop();
        continue;
      }

      const parent = parents[frame.next];
      frame.next += 1;
      if (parent === undefined) continue;
      // An edge to a task outside the corpus is a dangling reference,
      // not a cycle — resolveRelationships reports those separately.
      if (!parentsOf.has(parent)) continue;

      const state = colour.get(parent);
      if (state === "grey") {
        const at = path.indexOf(parent);
        if (at !== -1) {
          const loop = path.slice(at);
          const lowest = loop.reduce((a, b) => (a < b ? a : b));
          const pivot = loop.indexOf(lowest);
          const canonical = [...loop.slice(pivot), ...loop.slice(0, pivot)];
          const fingerprint = canonical.join(">");
          if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            cycles.push({
              relationshipKey: axis,
              path: [...canonical, lowest],
            });
          }
        }
        continue;
      }
      if (state === "black") continue;

      colour.set(parent, "grey");
      path.push(parent);
      stack.push({ id: parent, next: 0 });
    }
  }

  return cycles;
}

/**
 * Gets the children of a task along `axis` — tasks holding an `axis`
 * edge that targets `parentId`.
 *
 * `axis` is a required relationship key, not derived from config.
 * It used to be `config.relationships.find(r => r.structural)`, which
 * took the first structural kind and ignored the rest; the shipped
 * default marked both `blocks` and `parent` structural with `blocks`
 * first, so this returned blocked tasks rather than children. A view
 * that draws a tree knows which axis it is drawing, so it passes it.
 *
 * Callers should pass an axis whose def is `graph: tree`; this does
 * not check, because a caller may legitimately walk any relationship.
 */
export function getChildren(
  tasks: readonly Task[],
  parentId: string,
  axis: string,
): readonly Task[] {
  return tasks.filter(t =>
    (t.frontmatter.relationships ?? []).some(
      r => r.type === axis && r.target === parentId,
    ),
  );
}

/**
 * A cycle found along a cycle-constrained relationship. The path
 * lists task ids in walk order; the last id is the same as the
 * first (closing the loop). Reported by `findStructuralCycles`.
 */
export interface StructuralCycle {
  readonly relationshipKey: string;
  readonly path: readonly string[];
}

/**
 * Walks every cycle-constrained relationship (`graph: acyclic` or
 * `graph: tree`) in the workflow and returns
 * each cycle found in the in-memory task set. Used by `doctor` to
 * surface cycles that pre-date the link-time guard (which can be
 * bypassed by the inverse-key fix in earlier code, by direct
 * frontmatter edits, or by a sync that crossed paths).
 *
 * Each cycle is reported once per relationship — the canonical
 * path starts from the lowest-id node in the cycle so two runs
 * report the same edges in the same order.
 */
export function findStructuralCycles(
  tasks: readonly Task[],
  config: WorkflowConfig,
): readonly StructuralCycle[] {
  const cycles: StructuralCycle[] = [];
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.frontmatter.id, t);

  for (const rel of config.relationships) {
    // `graph: none` (or omitted) imposes no cycle constraint, so a
    // loop there is legitimate data rather than a defect.
    if (rel.graph !== "acyclic" && rel.graph !== "tree") continue;
    const seenCycles = new Set<string>();
    const colour = new Map<string, "white" | "grey" | "black">();
    const stack: { id: string; path: string[] }[] = [];

    function visit(start: string): void {
      stack.push({ id: start, path: [start] });
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (!frame) break;
        const status = colour.get(frame.id) ?? "white";
        if (status === "black") {
          stack.pop();
          continue;
        }
        if (status === "white") {
          colour.set(frame.id, "grey");
          const task = byId.get(frame.id);
          if (!task) {
            colour.set(frame.id, "black");
            stack.pop();
            continue;
          }
          const outgoing = (task.frontmatter.relationships ?? [])
            .filter(r => r.type === rel.key)
            .map(r => r.target);
          // Push children onto the stack as new frames; iterate by
          // marking which child index we've processed.
          (frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number }).outgoing = outgoing;
          (frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number }).cursor = 0;
        }
        const f = frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number };
        const outgoing = f.outgoing ?? [];
        const cursor = f.cursor ?? 0;
        if (cursor >= outgoing.length) {
          colour.set(frame.id, "black");
          stack.pop();
          continue;
        }
        const next = outgoing[cursor] as string;
        f.cursor = cursor + 1;
        const nextColour = colour.get(next) ?? "white";
        if (nextColour === "grey") {
          // Back-edge — close the cycle from where `next` first
          // entered the path.
          const idx = frame.path.indexOf(next);
          if (idx !== -1) {
            const cyclePath = [...frame.path.slice(idx), next];
            // Normalize: rotate so the lowest id starts the path.
            // Drop the trailing duplicate before rotating.
            const ring = cyclePath.slice(0, -1);
            let minIdx = 0;
            for (let i = 1; i < ring.length; i += 1) {
              const ringI = ring[i];
              const ringMin = ring[minIdx];
              if (ringI !== undefined && ringMin !== undefined && ringI < ringMin) minIdx = i;
            }
            const rotated = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
            rotated.push(rotated[0] as string);
            const key = rotated.join(",");
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              cycles.push({ relationshipKey: rel.key, path: rotated });
            }
          }
          continue;
        }
        if (nextColour === "black") continue;
        stack.push({ id: next, path: [...frame.path, next] });
      }
    }

    for (const t of tasks) {
      if ((colour.get(t.frontmatter.id) ?? "white") === "white") {
        visit(t.frontmatter.id);
      }
    }
  }

  return cycles;
}

/**
 * Gets the parent(s) of a task along `axis`. Returns several when the
 * task holds more than one `axis` edge — a DAG, which `buildTree`
 * also permits.
 *
 * `axis` is required for the same reason as in {@link getChildren}.
 */
export function getParents(
  tasks: readonly Task[],
  childId: string,
  axis: string,
): readonly Task[] {
  const child = tasks.find(t => t.frontmatter.id === childId);
  if (!child) return [];

  const parentRels = (child.frontmatter.relationships ?? []).filter(
    r => r.type === axis,
  );

  return parentRels
    .map(r => tasks.find(t => t.frontmatter.id === r.target))
    .filter((t): t is Task => t !== undefined);
}

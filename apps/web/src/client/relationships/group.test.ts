import type {
  ResolvedRelationshipResponse,
  TaskRelationship,
  WorkflowConfig,
} from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { buildRows, groupRelationships, linkKindOptions, orderRows } from "./group.ts";

/**
 * Grouping and ordering are where REL-1..7, REL-25, REL-26 and REL-34
 * actually live, and they are the part a UI spec proves least about: a
 * spec asserting "the Blocks group appears" passes on a grouper that
 * puts every kind under every heading, and a spec asserting an order
 * passes on a fixture already in that order.
 *
 * So the discriminating fixtures are here, built to *require* each
 * rule — a kind with no edges, a symmetric pair, a duplicate, an
 * unknown type, and — for REL-34 — an input deliberately **not** in
 * its output order.
 *
 * ## What REL-34's ordering test does and does not claim
 *
 * Measured, not assumed. `orderRows` sorts a *copy*, so a fixture
 * already in rank order cannot distinguish "the comparator ran" from
 * "the comparator was deleted" — that is M2.4b's lesson, and a test
 * built that way would be vacuous.
 *
 * The fixture below is therefore scrambled relative to its output on
 * every dimension the comparator uses: ranked rows arrive *after* an
 * unranked one, and the unranked ones arrive with a higher index
 * first. Deleting the whole comparator body (`return rows`) turns it
 * red; so does dropping only the unranked-below-ranked clause, and so
 * does replacing the index tiebreak with `0`. All three verified.
 */

const WORKFLOW: WorkflowConfig = {
  statuses: [],
  priorities: [],
  task_types: [],
  relationships: [
    {
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
      graph: "acyclic",
      ranked: true,
    },
    {
      key: "parent",
      label: "Parent",
      inverse: "child",
      inverse_label: "Child",
      graph: "tree",
      ranked: true,
    },
    { key: "relates_to", label: "Relates to", kind: "symmetric" },
  ],
  custom_fields: [],
} as unknown as WorkflowConfig;

function resolved(
  type: string,
  target: string,
  // Explicitly `| undefined` per member rather than `Partial<…>`:
  // under `exactOptionalPropertyTypes` a Partial of a type whose
  // members are `string` (optional, but not nullable) will not accept
  // an explicit `undefined` — which is exactly what the dangling-edge
  // fixture needs to express.
  extra: {
    resolvedKey?: string | undefined;
    resolvedTitle?: string | undefined;
    resolvedStatus?: string | undefined;
    missing?: boolean;
    targetCorrupt?: boolean;
  } = {},
): ResolvedRelationshipResponse {
  const key = "resolvedKey" in extra ? extra.resolvedKey : `K-${target}`;
  const title = "resolvedTitle" in extra ? extra.resolvedTitle : `Title ${target}`;
  const status = "resolvedStatus" in extra ? extra.resolvedStatus : "backlog";
  return {
    type,
    target,
    // `exactOptionalPropertyTypes` distinguishes "absent" from
    // "present and undefined", and the response shape means the first
    // — which is exactly what the server sends for a missing target.
    ...(key !== undefined ? { resolvedKey: key } : {}),
    ...(title !== undefined ? { resolvedTitle: title } : {}),
    ...(status !== undefined ? { resolvedStatus: status } : {}),
    missing: extra.missing ?? false,
    ...(extra.targetCorrupt === true ? { targetCorrupt: true } : {}),
  };
}

describe("groupRelationships", () => {
  // @verifies REL-1
  it("groups under the configured label, in declaration order, with no empty headings", () => {
    const rels = [
      // Deliberately out of declaration order in the input, so the
      // output order is the config's rather than the file's.
      resolved("relates_to", "c"),
      resolved("parent", "b"),
      resolved("blocks", "a"),
    ];
    const groups = groupRelationships(rels, undefined, WORKFLOW);

    expect(groups.map(g => g.label)).toEqual(["Blocks", "Parent", "Relates to"]);
    // No heading for a kind this task has no edges of. Five of the six
    // configured sides are unused here, so an implementation that
    // padded empty groups would return eight, not three.
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.key)).toEqual(["blocks", "parent", "relates_to"]);
  });

  // @verifies REL-2
  it("renders the forward and inverse sides as separate, differently-labelled groups", () => {
    const forward = groupRelationships([resolved("blocks", "t2")], undefined, WORKFLOW);
    const inverse = groupRelationships([resolved("is_blocked_by", "t1")], undefined, WORKFLOW);

    expect(forward.map(g => g.label)).toEqual(["Blocks"]);
    expect(inverse.map(g => g.label)).toEqual(["Is blocked by"]);
    // Neither side shows both headings for its single edge.
    expect(forward).toHaveLength(1);
    expect(inverse).toHaveLength(1);
  });

  // @verifies REL-51
  // Each group header names what the *listed* tasks are to the task on
  // screen — the label of the side shown under it, not its inverse.
  //
  // A task holding a `child` edge lists its children; that group must be
  // headed with the child-side label ("Child"). A task holding a `parent`
  // edge lists its parent; that group must be headed with the parent-side
  // label ("Parent"). The structural (`graph: tree`) pair must read the
  // same way `blocks` already does — a mapping that took the label from
  // the wrong side (children under "Parent", the parent under "Child")
  // is UX-8's reported symptom.
  //
  // Red-first: swapping the forward/inverse labels in `sidesOf` (the
  // fix UX-8's premise imagined was needed) turns both structural
  // expectations red while leaving the `blocks` control green — proving
  // the assertion is about the structural side specifically, not the
  // generic forward/inverse mapping REL-2 already covers.
  it("heads each structural group with the side it shows, consistent with a directional pair (REL-51)", () => {
    // The child-side edges (this task's children) → "Child".
    const onEpic = groupRelationships([resolved("child", "kid")], undefined, WORKFLOW);
    expect(onEpic.map(g => `${g.key}=${g.label}`)).toEqual(["child=Child"]);

    // The parent-side edge (this task's parent) → "Parent".
    const onChild = groupRelationships([resolved("parent", "epic")], undefined, WORKFLOW);
    expect(onChild.map(g => `${g.key}=${g.label}`)).toEqual(["parent=Parent"]);

    // No regression on the non-structural directional pair: `blocks`
    // reads "Blocks" and its inverse "Is blocked by", exactly as before.
    const blocking = groupRelationships(
      [resolved("blocks", "x"), resolved("is_blocked_by", "y")],
      undefined,
      WORKFLOW,
    );
    expect(blocking.map(g => `${g.key}=${g.label}`)).toEqual([
      "blocks=Blocks",
      "is_blocked_by=Is blocked by",
    ]);
  });

  // @verifies REL-3
  it("folds a symmetric kind under one heading with the target listed once", () => {
    const groups = groupRelationships([resolved("relates_to", "t2")], undefined, WORKFLOW);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Relates to");
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.rows[0]?.target).toBe("t2");
    // A symmetric kind contributes exactly one offerable side, so no
    // second heading can exist for it.
    expect(linkKindOptions(WORKFLOW).filter(o => o.key === "relates_to")).toHaveLength(1);
  });

  // @verifies REL-4
  it("counts each group's own edges, not the task's total", () => {
    const rels = [
      resolved("blocks", "a"),
      resolved("blocks", "b"),
      resolved("blocks", "c"),
      resolved("relates_to", "d"),
    ];
    const groups = groupRelationships(rels, undefined, WORKFLOW);

    const counts = Object.fromEntries(groups.map(g => [g.key, g.rows.length]));
    expect(counts).toEqual({ blocks: 3, relates_to: 1 });
    // The total is 4; neither group may report it.
    expect(counts["blocks"]).not.toBe(4);
    expect(counts["relates_to"]).not.toBe(4);
  });

  // @verifies REL-6
  it("marks only a ranked kind as ranked, and only a tree kind as a tree", () => {
    const groups = groupRelationships(
      [resolved("blocks", "a"), resolved("parent", "b"), resolved("relates_to", "c")],
      undefined,
      WORKFLOW,
    );
    const flags = Object.fromEntries(
      groups.map(g => [g.key, { ranked: g.ranked, tree: g.tree }]),
    );
    expect(flags).toEqual({
      blocks: { ranked: true, tree: false },
      parent: { ranked: true, tree: true },
      // `relates_to` declares neither, so both must be false —
      // defaulting `ranked` to true would put drag handles on a kind
      // that has no rank to write.
      relates_to: { ranked: false, tree: false },
    });
  });

  // @verifies REL-25
  // @verifies XS-25
  // @verifies DEG-16
  it("surfaces an edge whose type workflow.yaml does not declare, under its raw key", () => {
    const groups = groupRelationships(
      [resolved("blocks", "a"), resolved("blockz", "b")],
      undefined,
      WORKFLOW,
    );

    // Positive: the unknown edge is present, named by its raw key, and
    // flagged — not merely "not dropped".
    const unknown = groups.find(g => g.key === "blockz");
    expect(unknown).toBeDefined();
    expect(unknown?.label).toBe("blockz");
    expect(unknown?.unknown).toBe(true);
    expect(unknown?.rows.map(r => r.target)).toEqual(["b"]);
    // And it does not displace the configured one.
    expect(groups.find(g => g.key === "blocks")?.unknown).toBe(false);
    // Unknown groups come last, after every configured side.
    expect(groups.map(g => g.key)).toEqual(["blocks", "blockz"]);
  });

  // @verifies XS-25
  // @verifies DEG-16
  it("does not offer a removed kind in the picker while its links still render", () => {
    // The kind `blocks` deleted from workflow.yaml, tasks still using it.
    const without: WorkflowConfig = {
      ...WORKFLOW,
      relationships: WORKFLOW.relationships.filter(r => r.key !== "blocks"),
    };
    const groups = groupRelationships([resolved("blocks", "a")], undefined, without);

    // Still listed, under the raw key, marked unknown, and the target
    // still resolves so the row stays clickable.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("blocks");
    expect(groups[0]?.unknown).toBe(true);
    expect(groups[0]?.rows[0]?.resolvedKey).toBe("K-a");
    // But not offerable.
    expect(linkKindOptions(without).map(o => o.key)).not.toContain("blocks");
    expect(linkKindOptions(without).map(o => o.key)).not.toContain("is_blocked_by");
    // Positive pair for that absence: the kinds that remain *are*
    // offered, so "offers nothing at all" cannot pass this.
    expect(linkKindOptions(without).map(o => o.key))
      .toEqual(["parent", "child", "relates_to"]);
  });

  // @verifies REL-26
  // @verifies DEG-16
  it("lists a duplicated edge once and says how many copies the file holds", () => {
    const rels = [
      resolved("relates_to", "t2"),
      resolved("relates_to", "t2"),
      resolved("relates_to", "t3"),
    ];
    const groups = groupRelationships(rels, undefined, WORKFLOW);

    const rows = groups[0]?.rows ?? [];
    // Listed once, not twice.
    expect(rows.map(r => r.target)).toEqual(["t2", "t3"]);
    // Flagged rather than hidden: the count is the drift indicator.
    expect(rows[0]?.duplicates).toBe(2);
    expect(rows[1]?.duplicates).toBe(1);
  });

  // @verifies REL-24
  it("keeps a dangling edge as a row carrying its target id", () => {
    const rels = [
      resolved("blocks", "gone", {
        resolvedKey: undefined,
        resolvedTitle: undefined,
        resolvedStatus: undefined,
        missing: true,
      }),
      resolved("blocks", "alive"),
    ];
    const groups = groupRelationships(rels, undefined, WORKFLOW);
    const rows = groups[0]?.rows ?? [];

    // Both rows present — the broken one is not dropped, and its
    // neighbour is unaffected.
    expect(rows).toHaveLength(2);
    const broken = rows.find(r => r.target === "gone");
    expect(broken?.missing).toBe(true);
    // The id survives, because it is the only true thing about the row.
    expect(broken?.target).toBe("gone");
    expect(broken?.resolvedKey).toBeUndefined();
    expect(rows.find(r => r.target === "alive")?.missing).toBe(false);
  });
});

describe("buildRows", () => {
  /**
   * The two arrays come from different halves of the response —
   * `relationships` is resolved but rankless, `frontmatter.relationships`
   * carries the rank but no key — and the panel needs both. Nothing
   * else in this file exercises the merge, and a first mutation run
   * proved it: replacing `stored?.[i]?.rank` with `undefined` left
   * every other test green, because they all pass `undefined` for
   * `stored`. That is a fixture that cannot discriminate, so this is
   * the test that can.
   */
  // @verifies REL-6
  it("zips the stored rank onto the resolved edge, positionally", () => {
    const resolvedEdges = [
      resolved("blocks", "t2"),
      resolved("blocks", "t3"),
      resolved("blocks", "t4"),
    ];
    const stored: TaskRelationship[] = [
      { type: "blocks", target: "t2", rank: "m" },
      { type: "blocks", target: "t3" },
      { type: "blocks", target: "t4", rank: "c" },
    ];

    const rows = buildRows(resolvedEdges, stored);
    expect(rows.map(r => ({ target: r.target, rank: r.rank }))).toEqual([
      { target: "t2", rank: "m" },
      { target: "t3", rank: undefined },
      { target: "t4", rank: "c" },
    ]);

    // And that the rank actually reaches the ordering: with it, t4
    // sorts above t2 and the rankless t3 falls below both. Without the
    // merge every row is rankless and the order is the input's, which
    // is a different answer.
    const groups = groupRelationships(resolvedEdges, stored, WORKFLOW);
    expect(groups[0]?.rows.map(r => r.target)).toEqual(["t4", "t2", "t3"]);
  });

  /**
   * @verifies corruption sweep S4
   *
   * `targetCorrupt` must survive the response→row mapping, or the row
   * view has nothing to key its corrupt affordance off. A healthy edge
   * carries a falsy value; a corrupt one carries `true`. Without the
   * threading in `buildRows`, the second assertion goes red.
   */
  it("threads targetCorrupt from the response onto the row", () => {
    const rows = buildRows(
      [
        resolved("blocks", "t2"),
        resolved("blocks", "t3", { targetCorrupt: true }),
      ],
      undefined,
    );
    expect(rows[0]?.targetCorrupt).toBeFalsy();
    expect(rows[1]?.targetCorrupt).toBe(true);
  });
});

describe("linkKindOptions", () => {
  // @verifies REL-7
  it("offers every side of every kind, symmetric ones once, labelled not keyed", () => {
    expect(linkKindOptions(WORKFLOW)).toEqual([
      { key: "blocks", label: "Blocks" },
      { key: "is_blocked_by", label: "Is blocked by" },
      { key: "parent", label: "Parent" },
      { key: "child", label: "Child" },
      { key: "relates_to", label: "Relates to" },
    ]);
  });

  // @verifies REL-7
  it("shows one option for a one-relationship workspace and eight for four pairs", () => {
    const one: WorkflowConfig = {
      ...WORKFLOW,
      relationships: [{ key: "relates_to", label: "Relates to", kind: "symmetric" }],
    } as unknown as WorkflowConfig;
    expect(linkKindOptions(one)).toHaveLength(1);

    const four: WorkflowConfig = {
      ...WORKFLOW,
      relationships: [1, 2, 3, 4].map(n => ({
        key: `a${String(n)}`,
        label: `A${String(n)}`,
        inverse: `b${String(n)}`,
        inverse_label: `B${String(n)}`,
      })),
    } as unknown as WorkflowConfig;
    expect(linkKindOptions(four)).toHaveLength(8);
  });
});

describe("orderRows", () => {
  /**
   * The input is scrambled on every dimension the comparator uses, so
   * "the comparator ran" and "the comparator was deleted" produce
   * different answers. See the file docstring.
   */
  const scrambled = [
    // index 0: unranked, and it arrives *first* — so an implementation
    // that returns the input keeps it first, which the expectation
    // forbids.
    { rank: undefined, index: 0, target: "unranked-first" },
    { rank: "z", index: 1, target: "rank-z" },
    { rank: "a", index: 2, target: "rank-a" },
    // index 3: unranked, arriving after index 4 in creation terms is
    // impossible — but it arrives before it in the array, so the index
    // tiebreak must be what orders these two rather than array order.
    { rank: undefined, index: 5, target: "unranked-late" },
    { rank: undefined, index: 4, target: "unranked-early" },
  ].map(r => ({
    type: "blocks",
    target: r.target,
    resolvedKey: r.target,
    resolvedTitle: r.target,
    resolvedStatus: undefined,
    missing: false,
    rank: r.rank,
    index: r.index,
    duplicates: 1,
  }));

  // @verifies REL-6
  // @verifies REL-34
  it("sorts a ranked group by rank, unranked below, tiebroken on creation index", () => {
    expect(orderRows(scrambled, true).map(r => r.target)).toEqual([
      // Ranked first, in rank order — not input order.
      "rank-a",
      "rank-z",
      // Then the unranked, in creation-index order — not array order,
      // which would put "unranked-first" first and "unranked-late"
      // before "unranked-early".
      "unranked-first",
      "unranked-early",
      "unranked-late",
    ]);
  });

  // @verifies REL-34
  it("is deterministic across repeated calls on the same input", () => {
    const a = orderRows(scrambled, true).map(r => r.target);
    const b = orderRows(scrambled, true).map(r => r.target);
    expect(a).toEqual(b);
    // And the input was not mutated, so a second render sees the same
    // array a first one did — the reshuffle REL-34 rules out.
    expect(scrambled.map(r => r.target)).toEqual([
      "unranked-first", "rank-z", "rank-a", "unranked-late", "unranked-early",
    ]);
  });

  // @verifies REL-6
  it("leaves an unranked group in file order", () => {
    // The same scrambled input: an unranked kind must not be sorted at
    // all, so the output is the input, ranks and indices ignored.
    expect(orderRows(scrambled, false).map(r => r.target)).toEqual([
      "unranked-first", "rank-z", "rank-a", "unranked-late", "unranked-early",
    ]);
  });
});

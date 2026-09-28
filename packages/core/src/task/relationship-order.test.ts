import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { orderRelationships } from "./relationship-order.js";

/**
 * The one relationship order (K141 6a), shared by `loctt show`, MCP
 * `get_task` and the web panel's `orderRows`.
 *
 * @verifies REL-C6
 */
const workflow = {
  key: { prefix: "T" },
  statuses: [],
  priorities: [],
  task_types: [],
  relationships: [
    { key: "blocks", label: "Blocks", inverse: "is_blocked_by", inverse_label: "Is blocked by", graph: "acyclic" },
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
    { key: "relates_to", label: "Relates to", kind: "symmetric" },
  ],
  custom_fields: [],
} as WorkflowConfig;

describe("orderRelationships", () => {
  it("lists kinds in workflow order, each by rank then unranked in stored order", () => {
    const stored = [
      { type: "relates_to", target: "r2", rank: "q" },
      { type: "child", target: "c-unranked-1" },
      { type: "mystery", target: "m2", rank: "q" },
      { type: "mystery", target: "m1", rank: "d" },
      { type: "child", target: "c-rank-b", rank: "b" },
      { type: "relates_to", target: "r1", rank: "d" },
      { type: "child", target: "c-unranked-2" },
      { type: "blocks", target: "x" },
      { type: "child", target: "c-rank-a", rank: "a" },
    ];
    expect(orderRelationships(stored, workflow).map(e => e.target)).toEqual([
      "x",
      "c-rank-a", "c-rank-b", "c-unranked-1", "c-unranked-2",
      // K143: every kind is ordered, relates_to included (it had no
      // `ranked: true` and was listed in stored order before).
      "r1", "r2",
      // A type workflow.yaml does not define comes last, by rank too.
      "m1", "m2",
    ]);
  });

  it("keeps stored order when there is no workflow", () => {
    const stored = [{ type: "child", target: "b", rank: "z" }, { type: "child", target: "a", rank: "a" }];
    expect(orderRelationships(stored, undefined)).toEqual(stored);
  });
});

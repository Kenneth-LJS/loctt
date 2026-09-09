import type { TaskFrontmatterPublic, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { boardCardBadges, resolveBadgeKeys } from "./relationshipBadges.ts";

/**
 * BRD-50 (UX-5): a board card surfaces "blocked" and "epic".
 *
 * These tests pin the *derivation* — which relationship edges make a
 * card blocked, an epic (child count), or a subtask — from a task's own
 * frontmatter and the workflow config, since the card holds no other
 * relationship data.
 */

const DEFAULT_RELS: WorkflowConfig["relationships"] = [
  { key: "blocks", label: "Blocks", inverse: "is_blocked_by", inverse_label: "Is blocked by", graph: "acyclic" },
  { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
  { key: "relates_to", label: "Relates to", kind: "symmetric" },
];

function workflow(over: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    statuses: [],
    priorities: [],
    task_types: [],
    relationships: DEFAULT_RELS,
    ...over,
  } as WorkflowConfig;
}

function task(relationships: TaskFrontmatterPublic["relationships"]): TaskFrontmatterPublic {
  return { id: "01X", key: "T-1", ...(relationships !== undefined ? { relationships } : {}) };
}

describe("resolveBadgeKeys", () => {
  // @verifies BRD-50
  it("resolves the is-blocked-by key from the default blocks axis", () => {
    expect(resolveBadgeKeys(workflow()).blockedByKey).toBe("is_blocked_by");
  });

  // @verifies BRD-50
  it("resolves the tree relationship's own key and inverse (parent/child)", () => {
    const keys = resolveBadgeKeys(workflow());
    expect(keys.parentKey).toBe("parent");
    expect(keys.childKey).toBe("child");
  });

  // @verifies BRD-50
  it("follows timeline.dependency_relationship when it names a custom axis", () => {
    const wf = workflow({
      relationships: [
        { key: "needs", label: "Needs", inverse: "needed_by", inverse_label: "Needed by", graph: "acyclic" },
      ],
      timeline: { dependency_relationship: "needs" },
    });
    expect(resolveBadgeKeys(wf).blockedByKey).toBe("needed_by");
  });

  it("falls back to the shipped defaults when config is absent", () => {
    const keys = resolveBadgeKeys(undefined);
    expect(keys.blockedByKey).toBe("is_blocked_by");
    expect(keys.parentKey).toBe("parent");
    expect(keys.childKey).toBe("child");
  });
});

describe("boardCardBadges", () => {
  // @verifies BRD-50
  it("marks a task with an is_blocked_by edge as blocked", () => {
    const badges = boardCardBadges(task([{ type: "is_blocked_by", target: "01Y" }]), workflow());
    expect(badges.blocked).toBe(true);
    expect(badges.blockerCount).toBe(1);
  });

  // @verifies BRD-50
  it("counts multiple blockers", () => {
    const badges = boardCardBadges(
      task([
        { type: "is_blocked_by", target: "01Y" },
        { type: "is_blocked_by", target: "01Z" },
      ]),
      workflow(),
    );
    expect(badges.blockerCount).toBe(2);
  });

  // @verifies BRD-50
  it("does NOT mark a task that only blocks others (forward edge) as blocked", () => {
    const badges = boardCardBadges(task([{ type: "blocks", target: "01Y" }]), workflow());
    expect(badges.blocked).toBe(false);
    expect(badges.blockerCount).toBe(0);
  });

  // @verifies BRD-50
  it("reports the child count for an epic/parent (child edges it holds)", () => {
    const badges = boardCardBadges(
      task([
        { type: "child", target: "01A" },
        { type: "child", target: "01B" },
        { type: "child", target: "01C" },
      ]),
      workflow(),
    );
    expect(badges.childCount).toBe(3);
    expect(badges.isSubtask).toBe(false);
  });

  // @verifies BRD-50
  it("marks a subtask (holds the parent-side edge) with no child count", () => {
    const badges = boardCardBadges(task([{ type: "parent", target: "01A" }]), workflow());
    expect(badges.isSubtask).toBe(true);
    expect(badges.childCount).toBe(0);
  });

  it("a clean task with no relationships has no badges", () => {
    const badges = boardCardBadges(task(undefined), workflow());
    expect(badges).toEqual({ blocked: false, blockerCount: 0, childCount: 0, isSubtask: false });
  });
});

import type { LocttState,Task } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import { mergeKeyHistory, mergeRelationships, previewRekey, rekeyCollisions } from "./reconcile.js";

/** Stand-in project ids. Real ones are ULIDs; only identity matters here. */
const WEB = "01PROJECTWEB0000000000000";
const API = "01PROJECTAPI0000000000000";

function makeTask(id: string, key: string, createdAt: string, project = WEB): Task {
  return {
    frontmatter: {
      id,
      key,
      project,
      title: `Task ${key}`,
      created_at: createdAt,
      updated_at: createdAt,
    },
    body: "",
  };
}

/**
 * Key allocation is per project, indexed by project id — not by the
 * literal "task". These fixtures previously used `{ task: … }`, a shape
 * no tracker has had since the key→id migration, so every assertion
 * passed against a function that could never allocate anything.
 */
function stateFor(entries: Record<string, { prefix: string; next: number }>): LocttState {
  const keys: LocttState["keys"] = {};
  for (const [projectId, { prefix, next }] of Object.entries(entries)) {
    keys[projectId] = { prefix, next_number: next };
  }
  return { keys };
}

describe("rekeyCollisions — skipped collisions are reported (GIT-C2)", () => {
  /**
   * @verifies GIT-C2
   *
   * RekeyOutcome's own contract: a skip is "never silently dropped: a
   * task sharing a key with another is exactly the state the caller
   * invoked this to remove, so an unreported skip would leave a
   * duplicate key looking like a successful merge".
   *
   * Both reachable skip reasons produce an entry naming the task, the
   * key, and why — so the caller has something to surface.
   */

  it("reports a task with no project rather than dropping it", () => {
    const noProject = makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z");
    const tasks: Task[] = [
      makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z"),
      // No project: there is no counter to allocate a replacement from.
      { ...noProject, frontmatter: { ...noProject.frontmatter, project: undefined } },
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });

    const outcome = rekeyCollisions(tasks, state);

    expect(outcome.rekeyed).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]?.key).toBe("T-1");
    expect(outcome.skipped[0]?.reason).toMatch(/project/i);
  });

  it("reports a project with no key counter rather than dropping it", () => {
    const tasks = [
      makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z"),
      makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z", API),
    ];
    // Only WEB has a counter, so the API-side collision cannot allocate.
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });

    const outcome = rekeyCollisions(tasks, state);

    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]?.reason).toMatch(/no key allocation state/i);
  });
});

describe("rekeyCollisions", () => {
  it("does nothing when no collisions", () => {
    const tasks = [makeTask("a", "T-1", "2026-01-01"), makeTask("b", "T-2", "2026-01-02")];
    const state = stateFor({ [WEB]: { prefix: "T", next: 3 } });
    const outcome = rekeyCollisions(tasks, state);
    expect(outcome.rekeyed).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });

  it("rekeys the later-created task in a collision", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const { rekeyed } = rekeyCollisions(tasks, state);

    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]?.taskId).toBe("b");
    expect(rekeyed[0]?.oldKey).toBe("T-1");
    expect(rekeyed[0]?.newKey).toBe("T-5");
    expect(state.keys[WEB]?.next_number).toBe(6);
  });

  it("includes old key in key_history on the result", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const { rekeyed } = rekeyCollisions(tasks, state);

    expect(rekeyed[0]?.newKey).toBe("T-5");
    expect(rekeyed[0]?.keyHistory).toEqual(["T-1"]);
  });

  it("does not mutate input task objects", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    rekeyCollisions(tasks, state);

    // Input tasks should remain unchanged
    expect(tasks[1]?.frontmatter.key).toBe("T-1");
    expect(tasks[1]?.frontmatter.key_history).toBeUndefined();
  });

  it("allocates the replacement key from the task's own project", () => {
    // The regression this catches: allocating from a single shared
    // counter would rekey an API task into the WEB range, handing it a
    // key that belongs to another project and may already be in use.
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z", WEB),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z", API),
    ];
    const state = stateFor({
      [WEB]: { prefix: "T", next: 5 },
      [API]: { prefix: "API", next: 9 },
    });

    const { rekeyed } = rekeyCollisions(tasks, state);

    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]?.taskId).toBe("b");
    expect(rekeyed[0]?.newKey).toBe("API-9");
    // Only the colliding task's own project advances.
    expect(state.keys[API]?.next_number).toBe(10);
    expect(state.keys[WEB]?.next_number).toBe(5);
  });

  it("reports a collision it cannot resolve instead of dropping it", () => {
    // A task whose project has no counter — created in a clone whose
    // projects.yaml has not merged yet. Silently skipping would leave a
    // duplicate key behind while the merge reported success.
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z", WEB),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z", API),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });

    const { rekeyed, skipped } = rekeyCollisions(tasks, state);

    expect(rekeyed).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.taskId).toBe("b");
    expect(skipped[0]?.key).toBe("T-1");
    expect(skipped[0]?.reason).toContain(API);
  });

  it("breaks ties by id", () => {
    const tasks = [
      makeTask("b", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const { rekeyed } = rekeyCollisions(tasks, state);

    expect(rekeyed).toHaveLength(1);
    // "a" sorts before "b", so "b" gets rekeyed
    expect(rekeyed[0]?.taskId).toBe("b");
  });
});

describe("previewRekey — the pure preview the UI confirms (GIT-8/GIT-9)", () => {
  it("names keeper, loser, both timestamps, both ULIDs and the planned new key", () => {
    // @verifies GIT-8
    const tasks = [
      makeTask("01AAA", "T-1", "2026-01-01T00:00:00.000Z"),
      makeTask("01BBB", "T-1", "2026-01-02T00:00:00.000Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const plan = previewRekey(tasks, state);

    expect(plan.losers).toHaveLength(1);
    const l = plan.losers[0];
    expect(l?.key).toBe("T-1");
    expect(l?.loserId).toBe("01BBB");
    expect(l?.loserCreatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(l?.keeperId).toBe("01AAA");
    expect(l?.keeperCreatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(l?.tiebreak).toBe("created_at");
    expect(l?.newKey).toBe("T-5");
    expect(plan.skipped).toEqual([]);
  });

  it("applies nothing — state counter is untouched by a preview", () => {
    // @verifies GIT-8
    const tasks = [
      makeTask("01AAA", "T-1", "2026-01-01T00:00:00.000Z"),
      makeTask("01BBB", "T-1", "2026-01-02T00:00:00.000Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    previewRekey(tasks, state);
    // A preview must mutate nothing — the confirm gate depends on it.
    expect(state.keys[WEB]?.next_number).toBe(5);
    expect(tasks[1]?.frontmatter.key).toBe("T-1");
  });

  it("flags a created_at tie as decided by ULID and shows both ids (GIT-9)", () => {
    // @verifies GIT-9
    const tasks = [
      makeTask("01BBB", "T-1", "2026-01-01T00:00:00.000Z"),
      makeTask("01AAA", "T-1", "2026-01-01T00:00:00.000Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const plan = previewRekey(tasks, state);

    expect(plan.losers).toHaveLength(1);
    const l = plan.losers[0];
    // 01AAA sorts before 01BBB, so the lower ULID keeps the key.
    expect(l?.keeperId).toBe("01AAA");
    expect(l?.loserId).toBe("01BBB");
    expect(l?.tiebreak).toBe("ulid");
  });

  it("previews sequential new keys for several losers in one project", () => {
    // @verifies GIT-8
    const tasks = [
      makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z"),
      makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z"),
      makeTask("01C", "T-1", "2026-01-03T00:00:00.000Z"),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const plan = previewRekey(tasks, state);
    // Two losers, both drawing from the same counter — the preview must
    // show the same sequential keys the apply will hand out.
    expect(plan.losers.map(l => l.newKey)).toEqual(["T-5", "T-6"]);
  });

  it("reports an unallocatable collision in skipped, with no newKey loser", () => {
    // @verifies GIT-33
    const tasks = [
      makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z", WEB),
      makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z", API),
    ];
    const state = stateFor({ [WEB]: { prefix: "T", next: 5 } });
    const plan = previewRekey(tasks, state);
    expect(plan.losers).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.key).toBe("T-1");
  });
});

describe("previewRekey and rekeyCollisions agree (anti-drift invariant)", () => {
  /**
   * @verifies GIT-8
   * @verifies GIT-9
   *
   * The UI shows `previewRekey`; CLI/MCP apply `rekeyCollisions`. They are
   * derived from one plan, so for the same input they must agree on
   * keeper, loser, and new key — or the preview would promise one thing
   * and the apply do another. This proves it directly.
   */
  const scenarios: Array<{ name: string; tasks: Task[]; state: LocttState }> = [
    {
      name: "single collision, created_at decides",
      tasks: [
        makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z"),
        makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z"),
      ],
      state: stateFor({ [WEB]: { prefix: "T", next: 5 } }),
    },
    {
      name: "tie broken by ULID",
      tasks: [
        makeTask("01B", "T-1", "2026-01-01T00:00:00.000Z"),
        makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z"),
      ],
      state: stateFor({ [WEB]: { prefix: "T", next: 9 } }),
    },
    {
      name: "several losers across two projects",
      tasks: [
        makeTask("01A", "T-1", "2026-01-01T00:00:00.000Z", WEB),
        makeTask("01B", "T-1", "2026-01-02T00:00:00.000Z", WEB),
        makeTask("01C", "T-1", "2026-01-03T00:00:00.000Z", WEB),
        makeTask("01D", "API-1", "2026-01-01T00:00:00.000Z", API),
        makeTask("01E", "API-1", "2026-01-02T00:00:00.000Z", API),
      ],
      state: stateFor({
        [WEB]: { prefix: "T", next: 5 },
        [API]: { prefix: "API", next: 3 },
      }),
    },
  ];

  for (const s of scenarios) {
    it(`agree on keeper/loser/newKey — ${s.name}`, () => {
      // Preview from an untouched state clone; apply mutates its own clone.
      const previewState = structuredClone(s.state);
      const applyState = structuredClone(s.state);
      const plan = previewRekey(s.tasks, previewState);
      const outcome = rekeyCollisions(s.tasks, applyState);

      // Same set of tasks renumbered, same new key each — matched by id.
      const planByLoser = new Map(plan.losers.map(l => [l.loserId, l.newKey]));
      const appliedByLoser = new Map(outcome.rekeyed.map(r => [r.taskId, r.newKey]));
      expect([...appliedByLoser.keys()].sort()).toEqual([...planByLoser.keys()].sort());
      for (const [id, newKey] of appliedByLoser) {
        expect(newKey).toBe(planByLoser.get(id));
      }
      // Same skips.
      expect(outcome.skipped.map(x => x.taskId).sort())
        .toEqual(plan.skipped.map(x => x.taskId).sort());
    });
  }
});

describe("mergeRelationships", () => {
  it("unions by type+target", () => {
    const a = [{ type: "parent", target: "x" }];
    const b = [{ type: "parent", target: "x" }, { type: "blocks", target: "y" }];
    const result = mergeRelationships(a, b);
    expect(result).toEqual([
      { type: "parent", target: "x" },
      { type: "blocks", target: "y" },
    ]);
  });

  it("handles empty arrays", () => {
    expect(mergeRelationships([], [])).toEqual([]);
  });
});

describe("mergeKeyHistory", () => {
  it("unions history", () => {
    expect(mergeKeyHistory(["T-1"], ["T-1", "T-2"])).toEqual(["T-1", "T-2"]);
  });

  it("returns undefined for both empty", () => {
    expect(mergeKeyHistory(undefined, undefined)).toBeUndefined();
  });

  it("handles one side undefined", () => {
    expect(mergeKeyHistory(["T-1"], undefined)).toEqual(["T-1"]);
  });
});

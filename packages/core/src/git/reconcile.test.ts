import type { LocttState,Task } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import { mergeKeyHistory,mergeRelationships, rekeyCollisions } from "./reconcile.js";

function makeTask(id: string, key: string, createdAt: string): Task {
  return {
    frontmatter: {
      id,
      key,
      title: `Task ${key}`,
      created_at: createdAt,
      updated_at: createdAt,
    },
    body: "",
  };
}

describe("rekeyCollisions", () => {
  it("does nothing when no collisions", () => {
    const tasks = [makeTask("a", "T-1", "2026-01-01"), makeTask("b", "T-2", "2026-01-02")];
    const state: LocttState = { keys: { task: { prefix: "T-", next_number: 3 } } };
    const results = rekeyCollisions(tasks, state);
    expect(results).toEqual([]);
  });

  it("rekeys the later-created task in a collision", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state: LocttState = { keys: { task: { prefix: "T-", next_number: 5 } } };
    const results = rekeyCollisions(tasks, state);

    expect(results).toHaveLength(1);
    expect(results[0]?.taskId).toBe("b");
    expect(results[0]?.oldKey).toBe("T-1");
    expect(results[0]?.newKey).toBe("T-5");
    expect(state.keys["task"]?.next_number).toBe(6);
  });

  it("includes old key in key_history on the result", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state: LocttState = { keys: { task: { prefix: "T-", next_number: 5 } } };
    const results = rekeyCollisions(tasks, state);

    expect(results[0]?.newKey).toBe("T-5");
    expect(results[0]?.keyHistory).toEqual(["T-1"]);
  });

  it("does not mutate input task objects", () => {
    const tasks = [
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("b", "T-1", "2026-01-02T00:00:00Z"),
    ];
    const state: LocttState = { keys: { task: { prefix: "T-", next_number: 5 } } };
    rekeyCollisions(tasks, state);

    // Input tasks should remain unchanged
    expect(tasks[1]?.frontmatter.key).toBe("T-1");
    expect(tasks[1]?.frontmatter.key_history).toBeUndefined();
  });

  it("breaks ties by id", () => {
    const tasks = [
      makeTask("b", "T-1", "2026-01-01T00:00:00Z"),
      makeTask("a", "T-1", "2026-01-01T00:00:00Z"),
    ];
    const state: LocttState = { keys: { task: { prefix: "T-", next_number: 5 } } };
    const results = rekeyCollisions(tasks, state);

    expect(results).toHaveLength(1);
    // "a" sorts before "b", so "b" gets rekeyed
    expect(results[0]?.taskId).toBe("b");
  });
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

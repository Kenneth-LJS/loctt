import type { Task } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { computeWorkflowKeyCounts } from "./workflow-write.js";

/**
 * Counts, not presence. `computeWorkflowKeyUsage` next door answers
 * "is this key in use?", which is all the remap validator needs;
 * SET-17 and SET-19 need the number, and the shape of the bug this
 * guards is a counter that reports 1 for every key because it was
 * built from a Set.
 */

interface TaskShape {
  readonly key?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly task_type?: string;
  readonly relationships?: readonly { readonly type: string; readonly target: string }[];
  readonly fields?: Readonly<Record<string, unknown>>;
}

function task(fm: TaskShape): Task {
  return {
    frontmatter: { id: "01ABC", key: "T-1", title: "t", ...fm },
    body: "",
  } as unknown as Task;
}

describe("computeWorkflowKeyCounts", () => {
  it("counts each scalar slot per task rather than reporting presence", () => {
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", status: "in_review", priority: "high", task_type: "bug" }),
      task({ key: "T-2", status: "in_review", priority: "low", task_type: "bug" }),
      task({ key: "T-3", status: "done", priority: "high", task_type: "feature" }),
    ]);

    // The number the delete confirm shows. A Set-backed implementation
    // would say 1 here and the panel would under-report the blast
    // radius of a delete.
    expect(counts.statuses["in_review"]).toBe(2);
    expect(counts.statuses["done"]).toBe(1);
    expect(counts.priorities["high"]).toBe(2);
    expect(counts.task_types["bug"]).toBe(2);
  });

  it("omits keys nothing references, so the panel reads them as zero", () => {
    const counts = computeWorkflowKeyCounts([task({ status: "todo" })]);
    expect(counts.statuses["in_review"]).toBeUndefined();
  });

  it("counts a relationship once per task, not once per link", () => {
    // The number means "tasks that would need rewriting", and a task
    // with three `blocks` links is one task to rewrite. Counting links
    // would tell the user 3 tasks are affected when only 1 is.
    const counts = computeWorkflowKeyCounts([
      task({
        key: "T-1",
        relationships: [
          { type: "blocks", target: "T-2" },
          { type: "blocks", target: "T-3" },
          { type: "blocks", target: "T-4" },
          { type: "relates_to", target: "T-5" },
        ],
      }),
      task({ key: "T-2", relationships: [{ type: "blocks", target: "T-9" }] }),
    ]);

    expect(counts.relationships["blocks"]).toBe(2);
    expect(counts.relationships["relates_to"]).toBe(1);
  });

  it("counts custom-field enum values per field", () => {
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", fields: { sprint: "sprint_1", size: "M" } }),
      task({ key: "T-2", fields: { sprint: "sprint_1" } }),
      task({ key: "T-3", fields: { sprint: "sprint_2" } }),
    ]);

    // Per field — two fields holding the same value key must not pool.
    expect(counts.custom_field_values["sprint"]?.["sprint_1"]).toBe(2);
    expect(counts.custom_field_values["sprint"]?.["sprint_2"]).toBe(1);
    expect(counts.custom_field_values["size"]?.["M"]).toBe(1);
    expect(counts.custom_field_values["size"]?.["sprint_1"]).toBeUndefined();
  });

  it("counts a multi-select value once per task even when repeated", () => {
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", fields: { tags: ["a", "a", "b"] } }),
      task({ key: "T-2", fields: { tags: ["a"] } }),
    ]);

    expect(counts.custom_field_values["tags"]?.["a"]).toBe(2);
    expect(counts.custom_field_values["tags"]?.["b"]).toBe(1);
  });

  it("ignores non-string field values rather than counting them as keys", () => {
    // A number field is not an enum; counting `5` as a value key would
    // put a phantom row in the enum sub-table.
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", fields: { story_points: 5, done: true } }),
    ]);
    expect(counts.custom_field_values["story_points"]).toEqual({});
    expect(counts.custom_field_values["done"]).toEqual({});
  });

  it("counts every task that holds a field, regardless of the field's type", () => {
    // The whole-field blast radius (SET-49 field delete). `custom_field_values`
    // above is per enum *value*; a number or boolean field has no enum values,
    // so summing that table reports 0 even when tasks store data under the field
    // — the "affects nothing" lie the delete confirm would show. `custom_fields`
    // counts tasks holding the field at all, so the confirm tells the truth for
    // number and boolean fields as much as string and enum ones.
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", fields: { story_points: 5, done: true, size: "M" } }),
      task({ key: "T-2", fields: { story_points: 8, tags: ["a", "b"] } }),
      task({ key: "T-3", fields: { done: false } }),
      task({ key: "T-4", fields: {} }),
      task({ key: "T-5" }),
    ]);

    // A number field with values reports the real count, not 0.
    expect(counts.custom_fields["story_points"]).toBe(2);
    // A boolean field too — false counts, it is still a stored value.
    expect(counts.custom_fields["done"]).toBe(2);
    // Enum and multi-select fields are counted the same way, once per task.
    expect(counts.custom_fields["size"]).toBe(1);
    expect(counts.custom_fields["tags"]).toBe(1);
    // A field nothing references is absent, so the panel reads it as zero.
    expect(counts.custom_fields["never_used"]).toBeUndefined();
  });

  it("counts a field once per task even with a multi-value list, and never for empty values", () => {
    const counts = computeWorkflowKeyCounts([
      task({ key: "T-1", fields: { tags: ["a", "b", "c"] } }),
      // An empty list or null is not a held value — it must not count.
      task({ key: "T-2", fields: { tags: [], other: null } }),
    ]);
    expect(counts.custom_fields["tags"]).toBe(1);
    expect(counts.custom_fields["other"]).toBeUndefined();
  });
});

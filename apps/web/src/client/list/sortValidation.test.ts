import type { QuerySort, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { validateSortFields } from "./sortValidation.ts";

/** VUE-37: an invalid sort field is named and its row flagged. */

const WORKFLOW = {
  statuses: [{ key: "backlog", label: "Backlog", category: "pending" }],
  priorities: [{ key: "high", label: "High", value: 3 }],
  task_types: [{ key: "bug", label: "Bug" }],
  custom_fields: [{ key: "squad", label: "Squad", type: "string" }],
} as unknown as WorkflowConfig;

const s = (field: string): QuerySort => ({ field, direction: "asc" });

describe("saved-view sort fields", () => {
  // @verifies VUE-37
  it("names an invalid sort field and points at its row", () => {
    const problems = validateSortFields(
      [s("priority"), s("nonexistent_field"), s("title")],
      WORKFLOW,
    );
    expect(problems).toHaveLength(1);
    // The row index is what lets the editor flag *that* sort row.
    expect(problems[0]?.index).toBe(1);
    expect(problems[0]?.field).toBe("nonexistent_field");
    // The field is named, and the consequence stated.
    expect(problems[0]?.message).toContain("nonexistent_field");
    expect(problems[0]?.message).toMatch(/not be sorted/i);
  });

  // @verifies VUE-37
  it("accepts every real task field, so the check is not blanket-rejecting", () => {
    // POSITIVE CONTROL for the test above. A validator that flagged
    // everything would satisfy "names the invalid field" while making
    // the editor unusable.
    const ok = [s("priority"), s("due_date"), s("status"), s("title"), s("created_at")];
    expect(validateSortFields(ok, WORKFLOW)).toEqual([]);
  });

  // @verifies VUE-37
  it("distinguishes a real custom field from one that was deleted", () => {
    expect(validateSortFields([s("fields.squad")], WORKFLOW)).toEqual([]);

    const gone = validateSortFields([s("fields.ghost")], WORKFLOW);
    expect(gone).toHaveLength(1);
    expect(gone[0]?.message).toContain("fields.ghost");
  });

  // @verifies VUE-37
  it("does not invent a failure when the workflow config has not loaded", () => {
    // Without the config we cannot know which custom fields exist;
    // flagging one would show the user an error that is not theirs.
    expect(validateSortFields([s("fields.ghost")], undefined)).toEqual([]);
    // A non-custom bad field is still knowable, and still flagged.
    expect(validateSortFields([s("nope")], undefined)).toHaveLength(1);
  });
});

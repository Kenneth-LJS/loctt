import { TaskFrontmatterSchema } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { AUTO_MANAGED_FIELDS, USER_IMMUTABLE_FIELDS } from "../task/update.js";
import { validateTaskAgainstWorkflow } from "./validation.js";

/**
 * V5: the validator is maintained by a test, not by an instruction.
 *
 * "Adding a feature requires updating the validator" is a rule nobody
 * enforces. This repo has shipped fourteen tests that encoded a bug as
 * intended behaviour precisely because "someone will remember" is not a
 * mechanism.
 *
 * So: enumerate the schema at runtime and assert every field is either
 * *reachable* by a write-path check or on an exemption list carrying a
 * reason. Add a field to `TaskFrontmatterSchema` without teaching the
 * validator and this fails, naming it.
 *
 * **Its limit, stated honestly:** this proves coverage, not
 * correctness. It cannot tell you a rule is right — only that the field
 * is looked at. The failure mode it targets is forgetting entirely,
 * which is the one that actually happens.
 */

/**
 * Fields no write-path check needs to reach, each with the reason.
 *
 * A field belongs here when nothing about its *value* can be wrong —
 * not when writing the rule is inconvenient.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  title: "non-empty is enforced by the schema itself; no cross-file rule applies",
  start_date: "shape enforced by the DateOrIsoString brand; no cross-file rule",
  due_date: "shape enforced by the DateOrIsoString brand; no cross-file rule",
  estimate: "free-form by design — the unit is configurable per tracker",
  assignee: "resolved to a user id by resolveEntityRef, which throws on an unknown ref",
  reporter: "resolved to a user id by resolveEntityRef, which throws on an unknown ref",
};

/** Every field name declared on the task frontmatter schema. */
function schemaFields(): string[] {
  return Object.keys(TaskFrontmatterSchema.shape);
}

/**
 * Fields some write-path check demonstrably looks at.
 *
 * Derived from the real sets rather than restated here, so a field that
 * stops being guarded stops counting as covered.
 */
function guardedFields(): Set<string> {
  return new Set([
    ...USER_IMMUTABLE_FIELDS,
    ...AUTO_MANAGED_FIELDS,
    // Reached by `validateTaskAgainstWorkflow`: enum membership for the
    // first three, existence for the rest.
    "status",
    "priority",
    "task_type",
    "labels",
    "milestone",
    "sprint",
    "project",
    "fields",
  ]);
}

describe("every frontmatter field is validated or exempt", () => {
  it("names any field nothing checks", () => {
    const guarded = guardedFields();
    const unhandled = schemaFields().filter(
      f => !guarded.has(f) && EXEMPT[f] === undefined,
    );

    // The failure message is the point: it tells whoever added the
    // field what they forgot, rather than failing somewhere unrelated
    // later.
    expect(unhandled, `add a check for these, or exempt them with a reason: ${unhandled.join(", ")}`)
      .toEqual([]);
  });

  it("has no exemption for a field that no longer exists", () => {
    // Without this the list rots: a field gets renamed, its exemption
    // stays, and the next real gap hides behind a stale entry.
    const fields = new Set(schemaFields());
    const stale = Object.keys(EXEMPT).filter(f => !fields.has(f));
    expect(stale, `these exemptions name fields not on the schema: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("has no exemption for a field that is in fact guarded", () => {
    // An exemption that duplicates a real check is a lie about why the
    // field is safe, and it would survive the check being deleted.
    const guarded = guardedFields();
    const redundant = Object.keys(EXEMPT).filter(f => guarded.has(f));
    expect(redundant, `these are guarded, so the exemption is wrong: ${redundant.join(", ")}`)
      .toEqual([]);
  });

  it("gives every exemption a reason, not an empty string", () => {
    const blank = Object.entries(EXEMPT).filter(([, why]) => why.trim().length === 0);
    expect(blank.map(([f]) => f)).toEqual([]);
  });
});

describe("the coverage claim is real, not just a list", () => {
  it("the validator actually rejects a bad value in a field it claims", () => {
    // Guards against `guardedFields` drifting into a list of names
    // nothing backs. If `status` is claimed as covered, a bad status
    // must be rejected.
    const errors = validateTaskAgainstWorkflow(
      {
        id: "x", key: "T-1", title: "t",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        status: "definitely-not-a-real-status",
      } as never,
      {
        statuses: [{ key: "todo", label: "To Do", category: "active" }],
        priorities: [], task_types: [], relationships: [], custom_fields: [],
      } as never,
    );
    expect(errors.map(e => e.field)).toContain("status");
  });
});

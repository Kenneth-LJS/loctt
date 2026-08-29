import type {
  HistoryEntry,
  LabelDef,
  MilestoneDef,
  ProjectDef,
  SprintDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { DescribeContext } from "./describe.ts";
import {
  describeEntry,
  DRIFT_SUFFIX,
  EMPTY_VALUE,
  fieldName,
  KIND_ICONS,
  KIND_LABELS,
  NO_ACTOR,
  renderValue,
} from "./describe.ts";

/**
 * Phrasing: CMT-14 (before/after, as labels), CMT-15 (per-kind words),
 * CMT-26 and CMT-27 (drift markers), CMT-28 (no actor).
 *
 * **Every value in these fixtures is a stored key or ULID**, and every
 * assertion names the configured *label*. That is deliberate and is
 * the group's trap: a test asserting an entry "renders" passes on a
 * raw key, and one asserting an actor "appears" passes on a ULID
 * (LST-33). So the config below gives every key a label that shares no
 * substring with it — `in_progress` → "Cooking" — which means an
 * implementation that printed the key could not accidentally satisfy
 * an assertion about the label.
 */

const ANA: UserProfile = { id: "01ANA00000000000000000000A", name: "Ana Lopez", timezone: "UTC" };
const KEN: UserProfile = { id: "01KEN00000000000000000000K", name: "Ken", timezone: "UTC" };

const workflow = {
  key: { prefix: "T-" },
  statuses: [
    { key: "backlog", label: "Icebox", category: "pending", default: true },
    { key: "in_progress", label: "Cooking", category: "active" },
  ],
  priorities: [{ key: "high", label: "Sky-high", value: 3 }],
  task_types: [{ key: "bug", label: "Defect" }],
  relationships: [
    { key: "blocks", label: "Holds up", inverse: "is_blocked_by", inverse_label: "Held up by" },
  ],
  custom_fields: [
    {
      key: "team",
      label: "Owning squad",
      type: "enum",
      multi: false,
      searchable: true,
      values: [{ key: "platform", label: "Platform crew" }],
    },
    { key: "risk", label: "Risk score", type: "number", multi: false, searchable: false },
    { key: "reviewed", label: "Reviewed on", type: "date", multi: false, searchable: false },
    {
      key: "tags",
      label: "Free tags",
      type: "enum",
      multi: true,
      searchable: false,
      values: [
        { key: "a", label: "Alpha" },
        { key: "b", label: "Beta" },
      ],
    },
  ],
} as unknown as WorkflowConfig;

const labels: readonly LabelDef[] = [{ id: "01LBL0000000000000000000BG", name: "bug" }];
const milestones: readonly MilestoneDef[] = [{ id: "01MST000000000000000000M1", name: "Launch" }];
const sprints: readonly SprintDef[] = [];
const projects: readonly ProjectDef[] = [];

const ctx: DescribeContext = {
  workflow,
  users: [ANA, KEN],
  labels,
  milestones,
  sprints,
  projects,
};

/** The panel's own join: a name, never the id, never blank. */
const resolve = (id: string): string =>
  [ANA, KEN].find(u => u.id === id)?.name ?? "Unknown user";

function entry(over: Partial<HistoryEntry> & { kind: HistoryEntry["kind"] }): HistoryEntry {
  return { timestamp: "2026-08-28T09:00:00.000Z", ...over };
}

/* ------------------------------------------------------------------ *
 * CMT-14 — before and after, as labels
 * ------------------------------------------------------------------ */

describe("field_change (CMT-14)", () => {
  /** @verifies CMT-14 */
  it("shows both sides as workflow labels, never the stored keys", () => {
    const d = describeEntry(
      entry({ kind: "field_change", field: "status", before: "backlog", after: "in_progress" }),
      ctx,
      resolve,
    );

    expect(d.change?.field).toBe("Status");
    expect(d.change?.before.text).toBe("Icebox");
    expect(d.change?.after.text).toBe("Cooking");
    // The stored keys must not survive into what a reader sees — the
    // labels above share no substring with them, so this is a real
    // check rather than a tautology.
    expect(`${d.change?.before.text ?? ""} ${d.change?.after.text ?? ""}`)
      .not.toMatch(/backlog|in_progress/);
    expect(d.change?.before.drifted).toBe(false);
    expect(d.change?.after.drifted).toBe(false);
  });

  it("shows the empty side explicitly when a field is set from nothing", () => {
    const d = describeEntry(
      entry({ kind: "field_change", field: "assignee", before: null, after: ANA.id }),
      ctx,
      resolve,
    );

    expect(d.change?.field).toBe("Assignee");
    // Not a bare "Assignee: Ana Lopez" — the case is explicit.
    expect(d.change?.before.text).toBe(EMPTY_VALUE);
    expect(d.change?.after.text).toBe("Ana Lopez");
    // …and the ULID that is actually stored never reaches the reader.
    expect(d.change?.after.text).not.toContain(ANA.id);
  });

  it("shows the reverse when a field is cleared", () => {
    const d = describeEntry(
      entry({ kind: "field_change", field: "assignee", before: ANA.id, after: null }),
      ctx,
      resolve,
    );

    expect(d.change?.before.text).toBe("Ana Lopez");
    expect(d.change?.after.text).toBe(EMPTY_VALUE);
  });

  it("resolves milestone and priority through their own config", () => {
    expect(renderValue(ctx, "field_change", "priority", "high").text).toBe("Sky-high");
    expect(renderValue(ctx, "field_change", "milestone", "01MST000000000000000000M1").text)
      .toBe("Launch");
  });
});

/* ------------------------------------------------------------------ *
 * CMT-26 — a value config no longer declares
 * ------------------------------------------------------------------ */

describe("orphaned config values (CMT-26)", () => {
  /** @verifies CMT-26 */
  it("keeps the raw key and marks it, rather than blanking it", () => {
    const d = describeEntry(
      // `urgent` was a priority once; `workflow.yaml` no longer has it.
      entry({ kind: "field_change", field: "priority", before: "urgent", after: "high" }),
      ctx,
      resolve,
    );

    expect(d.change?.before.text).toBe("urgent");
    expect(d.change?.before.drifted).toBe(true);
    // Not blank — the failure this case exists to catch.
    expect(d.change?.before.text).not.toBe("");
    expect(d.change?.before.text).not.toBe(EMPTY_VALUE);
    // The still-valid side renders as its label (second bullet).
    expect(d.change?.after.text).toBe("Sky-high");
    expect(d.change?.after.drifted).toBe(false);
  });

  it("marks an assignee whose user was hard-deleted", () => {
    const v = renderValue(ctx, "field_change", "assignee", "01GONE0000000000000000000");
    expect(v.drifted).toBe(true);
    expect(v.text).toBe("01GONE0000000000000000000");
  });
});

/* ------------------------------------------------------------------ *
 * CMT-27 — custom fields
 * ------------------------------------------------------------------ */

describe("custom_field_change (CMT-27)", () => {
  /** @verifies CMT-27 */
  it("names the field by its configured label, not its key", () => {
    const d = describeEntry(
      entry({ kind: "custom_field_change", field: "team", before: null, after: "platform" }),
      ctx,
      resolve,
    );

    expect(d.change?.field).toBe("Owning squad");
    expect(d.change?.field).not.toContain("team");
    // An enum value renders as its value label.
    expect(d.change?.after.text).toBe("Platform crew");
    expect(d.change?.after.text).not.toContain("platform");
  });

  /** @verifies CMT-27 */
  it("renders a number as a number and a date in the workspace format", () => {
    expect(renderValue(ctx, "custom_field_change", "risk", 7).text).toBe("7");
    // `shortDate`'s own format, not an ISO string dumped through.
    const date = renderValue(ctx, "custom_field_change", "reviewed", "2026-03-04").text;
    expect(date).toBe("Mar 4");
    expect(date).not.toBe("2026-03-04");
  });

  /** @verifies CMT-27 */
  it("renders a multi-valued field's members rather than an array dump", () => {
    const v = renderValue(ctx, "custom_field_change", "tags", ["a", "b"]);
    expect(v.text).toBe("Alpha, Beta");
    // Not `["a","b"]` and not `a,b`.
    expect(v.text).not.toContain("[");
    expect(v.text).not.toMatch(/\ba\b/);
  });

  /** @verifies CMT-27 */
  it("marks a custom field removed from config, on the name", () => {
    const d = describeEntry(
      entry({ kind: "custom_field_change", field: "retired_field", before: null, after: "x" }),
      ctx,
      resolve,
    );

    expect(fieldName(ctx, "custom_field_change", "retired_field").drifted).toBe(true);
    expect(d.change?.field).toBe(`retired_field ${DRIFT_SUFFIX}`);
    // The value survives — the field is gone, what happened is not.
    expect(d.change?.after.text).toBe("x");
  });

  it("marks an enum value the field no longer declares", () => {
    const v = renderValue(ctx, "custom_field_change", "team", "disbanded");
    expect(v.drifted).toBe(true);
    expect(v.text).toBe("disbanded");
  });
});

/* ------------------------------------------------------------------ *
 * CMT-15 — per-kind phrasing
 * ------------------------------------------------------------------ */

describe("kinds (CMT-15)", () => {
  /** @verifies CMT-15 */
  it("gives every kind a distinct icon and a word beside it", () => {
    const icons = Object.values(KIND_ICONS);
    const words = Object.values(KIND_LABELS);
    // Distinguishable — the case's first bullet. Two kinds sharing an
    // icon *and* a word would be indistinguishable to a reader.
    expect(new Set(icons).size).toBe(icons.length);
    // Every kind carries text, so the icon is never the only carrier
    // of meaning (second bullet).
    expect(words.every(w => w.length > 0)).toBe(true);
  });

  /** @verifies CMT-15 */
  it("says the body changed without pretending to show a diff", () => {
    const d = describeEntry(
      // `body_edited` *does* carry both texts; the row must not use
      // them as a change pair.
      entry({ kind: "body_edited", before: "the old paragraph", after: "the new paragraph" }),
      ctx,
      resolve,
    );

    expect(d.summary).toBe("edited the description");
    expect(d.change).toBeUndefined();
    expect(d.summary).not.toContain("paragraph");
  });

  /** @verifies CMT-15 */
  it("names the attached file from meta", () => {
    const d = describeEntry(
      entry({ kind: "attachment_added", meta: { name: "spec.pdf", size: 12 } }),
      ctx,
      resolve,
    );
    expect(d.summary).toContain("spec.pdf");
  });

  it("names a link by the relationship's configured label", () => {
    const d = describeEntry(
      entry({ kind: "link_added", meta: { type: "blocks", target: "01T" } }),
      ctx,
      resolve,
    );
    expect(d.summary).toContain("Holds up");
    expect(d.summary).not.toContain("blocks");
  });

  it("resolves a label id to its name", () => {
    const d = describeEntry(
      entry({ kind: "label_added", after: "01LBL0000000000000000000BG" }),
      ctx,
      resolve,
    );
    expect(d.summary).toBe("added the label bug");
    expect(d.summary).not.toContain("01LBL");
  });

  /**
   * The case's last bullet, and the one with a stated wrong answer:
   * "Ken edited Ana's comment", **not** a bare "comment edited".
   */
  /** @verifies CMT-15 */
  it("says whose comment was edited when the actor is not the author", () => {
    const d = describeEntry(
      entry({
        kind: "comment_edited",
        actor: KEN.id,
        meta: { comment_id: "C1", author: ANA.id },
      }),
      ctx,
      resolve,
    );

    expect(d.summary).toBe("edited Ana Lopez’s comment");
    // The author's ULID never reaches the reader.
    expect(d.summary).not.toContain(ANA.id);
  });

  it("does not attribute a self-edit to a third party", () => {
    const d = describeEntry(
      entry({
        kind: "comment_edited",
        actor: ANA.id,
        meta: { comment_id: "C1", author: ANA.id },
      }),
      ctx,
      resolve,
    );

    expect(d.summary).toBe("edited their comment");
    expect(d.summary).not.toContain("Ana Lopez");
  });

  it("names an unresolvable comment author honestly rather than by id", () => {
    const d = describeEntry(
      entry({
        kind: "comment_deleted",
        actor: KEN.id,
        meta: { comment_id: "C1", author: "01GONE0000000000000000000" },
      }),
      ctx,
      resolve,
    );

    expect(d.summary).toBe("deleted Unknown user’s comment");
    expect(d.summary).not.toContain("01GONE");
  });
});

/* ------------------------------------------------------------------ *
 * CMT-28 — no actor
 * ------------------------------------------------------------------ */

describe("missing actor (CMT-28)", () => {
  it("has a phrasing that is neither blank nor an invented user", () => {
    expect(NO_ACTOR).toBe("System");
    expect(NO_ACTOR.length).toBeGreaterThan(0);
    // Not any real user's name — a fabricated attribution is the other
    // half of what the case rules out.
    expect([ANA.name, KEN.name]).not.toContain(NO_ACTOR);
  });

  it("still describes an entry that has no actor", () => {
    const d = describeEntry(
      entry({ kind: "field_change", field: "status", before: "backlog", after: "in_progress" }),
      ctx,
      resolve,
    );
    // The summary is about the change, not the actor, so it survives
    // the actor's absence intact — which is what lets the row print
    // "System" in front of it.
    expect(d.summary).toBe("changed Status");
    expect(d.change?.after.text).toBe("Cooking");
  });
});

/* ------------------------------------------------------------------ *
 * CMT-29 — a rename appears as a change
 * ------------------------------------------------------------------ */

describe("key rename (CMT-29)", () => {
  /** @verifies CMT-29 */
  it("shows the before and after keys of a rekey", () => {
    const d = describeEntry(
      entry({ kind: "field_change", field: "key", before: "T-12", after: "M-4" }),
      ctx,
      resolve,
    );

    expect(d.change?.field).toBe("Key");
    expect(d.change?.before.text).toBe("T-12");
    expect(d.change?.after.text).toBe("M-4");
  });
});

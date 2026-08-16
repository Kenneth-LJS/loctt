import type { HistoryEntry, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { HistoryDisplayContext } from "./history.js";
import { formatHistoryEntry } from "./history.js";

/**
 * @verifies CMT-C5
 *
 * `loctt log` used to print what the file stores rather than what the
 * user configured: `status: not_started → in_progress` instead of the
 * labels, custom fields by key instead of label, and no actor at all —
 * so the log said what changed but never who.
 *
 * The formatter is the right place to test the resolution rules,
 * because several of them (a drifted key, a missing config, an absent
 * actor) are states a live tracker reaches only by breaking it.
 */

const WORKFLOW = {
  key: "T",
  statuses: [
    { key: "not_started", label: "Not started", category: "pending", default: true },
    { key: "in_progress", label: "In progress", category: "active" },
  ],
  priorities: [{ key: "high", label: "High", value: 1 }],
  task_types: [{ key: "bug", label: "Bug" }],
  relationships: [],
  custom_fields: [{ key: "team_name", label: "Team", type: "text" }],
} as unknown as WorkflowConfig;

const KEN = "01J000000000000000000KEN";
const ctx: HistoryDisplayContext = {
  workflow: WORKFLOW,
  users: new Map([[KEN, "Ken"]]),
};

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "field_change",
    actor: KEN,
    ...over,
  } as HistoryEntry;
}

describe("formatHistoryEntry", () => {
  it("renders configured labels on both sides of a status change", () => {
    const line = formatHistoryEntry(
      entry({ field: "status", before: "not_started", after: "in_progress" }),
      ctx,
    );
    expect(line).toContain("Not started");
    expect(line).toContain("In progress");
    // The stored keys are what the log used to show; a human reading
    // the log has no reason to know them.
    expect(line).not.toContain("not_started");
    expect(line).not.toContain("in_progress");
  });

  it("names a custom field by its label, not its key", () => {
    const line = formatHistoryEntry(
      entry({ kind: "custom_field_change", field: "team_name", before: null, after: "Platform" }),
      ctx,
    );
    expect(line).toContain("Team:");
    expect(line).not.toContain("team_name");
  });

  it("shows the acting user's display name rather than the ULID", () => {
    const line = formatHistoryEntry(entry({ field: "status", after: "in_progress" }), ctx);
    expect(line).toContain("Ken");
    expect(line).not.toContain(KEN);
  });

  it("states that the actor is unknown rather than ending the line blank", () => {
    // Built without `actor` rather than with `actor: undefined`:
    // exactOptionalPropertyTypes distinguishes the two, and absent is
    // what a pre-user-tracking entry on disk actually looks like.
    const { actor: _actor, ...actorless } = entry({
      field: "status",
      after: "in_progress",
    });
    const line = formatHistoryEntry(actorless as HistoryEntry, ctx);
    // "not recorded" and "the renderer dropped it" must not look alike.
    expect(line).toMatch(/actor unknown/i);
  });

  it("falls back to the id when the actor is no longer a known user", () => {
    const line = formatHistoryEntry(
      entry({ field: "status", after: "in_progress", actor: "01JGONEGONEGONEGONEGONE" }),
      ctx,
    );
    // A deleted user must not erase attribution for what they did.
    expect(line).toContain("01JGONEGONEGONEGONEGONE");
    expect(line).not.toMatch(/actor unknown/i);
  });

  it("marks a value whose key is no longer in the workflow config", () => {
    const line = formatHistoryEntry(
      entry({ field: "status", before: "not_started", after: "deleted_status" }),
      ctx,
    );
    // Blank would make the log disagree with the task, which still
    // holds the value: show it, and say the config no longer explains it.
    expect(line).toContain("deleted_status");
    expect(line).toContain("(?)");
  });

  it("renders raw keys unmarked when no workflow config is available", () => {
    const line = formatHistoryEntry(
      entry({ field: "status", before: "not_started", after: "in_progress" }),
      {},
    );
    expect(line).toContain("not_started");
    // Without the config we cannot tell a valid key from a drifted one,
    // so claiming drift here would be a guess.
    expect(line).not.toContain("(?)");
  });
});

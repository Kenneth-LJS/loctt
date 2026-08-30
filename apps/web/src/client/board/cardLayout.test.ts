import type { UserSettings } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { DEFAULT_CARD_LAYOUT, resolveCardLayout, resolveColumnCardLayout } from "./cardLayout.ts";
import { HIDDEN_COLUMNS_KEY, hiddenColumnsOf, withHiddenColumns } from "./chipSettings.ts";

describe("resolveCardLayout", () => {
  // @verifies BRD-5
  it("renders exactly the fields card_layout lists, in the stored order", () => {
    const settings = { card_layout: ["assignee", "due_date"] } as unknown as UserSettings;

    const layout = resolveCardLayout(settings);

    // Both concerns come from the one array: assignee and due date on,
    // priority and labels off because they are simply absent.
    expect(layout).toEqual(["assignee", "due_date"]);
    expect(layout).not.toContain("priority");
    expect(layout).not.toContain("labels");
  });

  // @verifies BRD-5
  it("reorders the fields when the stored order changes", () => {
    const before = resolveCardLayout(
      { card_layout: ["assignee", "due_date"] } as unknown as UserSettings,
    );
    const after = resolveCardLayout(
      { card_layout: ["due_date", "assignee"] } as unknown as UserSettings,
    );

    // Position in the array *is* the render order (CW-17), so moving
    // due date ahead of assignee has to move the row.
    expect(before).toEqual(["assignee", "due_date"]);
    expect(after).toEqual(["due_date", "assignee"]);
  });

  // @verifies BRD-5
  it("falls back to the built-in layout when the user has no card_layout", () => {
    // A user who has never opened the settings editor. The board must
    // not error on the missing key.
    expect(resolveCardLayout({} as UserSettings)).toEqual(DEFAULT_CARD_LAYOUT);
    expect(resolveCardLayout(undefined)).toEqual(DEFAULT_CARD_LAYOUT);
  });

  // @verifies BRD-5
  it("treats an explicit empty array as title-only, not as absent", () => {
    // The contract is explicit that these are different states:
    // absence means "use the default", `[]` means "show nothing but
    // the title". Collapsing them makes title-only unrepresentable.
    expect(resolveCardLayout({ card_layout: [] } as unknown as UserSettings)).toEqual([]);
  });

  // @verifies BRD-5
  it("falls back to the default rather than throwing on a hand-edited layout", () => {
    // Settings are stored schema-less server-side, so settings.yaml can
    // carry anything. A duplicate is rejected by CW-17's own rule; a
    // non-array and an unknown field are simply junk.
    expect(resolveCardLayout({ card_layout: "assignee" } as unknown as UserSettings))
      .toEqual(DEFAULT_CARD_LAYOUT);
    expect(resolveCardLayout({ card_layout: ["assignee", "assignee"] } as unknown as UserSettings))
      .toEqual(DEFAULT_CARD_LAYOUT);
    expect(resolveCardLayout({ card_layout: ["not_a_field"] } as unknown as UserSettings))
      .toEqual(DEFAULT_CARD_LAYOUT);
  });
});

describe("chip visibility settings", () => {
  // @verifies BRD-3
  it("reports nothing hidden for a user who has never toggled", () => {
    expect(hiddenColumnsOf({} as UserSettings)).toEqual([]);
    expect(hiddenColumnsOf(undefined)).toEqual([]);
  });

  // @verifies BRD-4
  it("round-trips hidden columns through the settings object", () => {
    const next = withHiddenColumns({} as UserSettings, ["done", "wont_do"]);

    expect(hiddenColumnsOf(next)).toEqual(["done", "wont_do"]);
  });

  // @verifies BRD-4
  it("carries the user's other settings through the write", () => {
    // PUT replaces the whole document, so dropping the other keys here
    // would erase card_layout and default_project on every chip click.
    const current = {
      default_project: "01PROJECT",
      card_layout: ["assignee"],
    } as unknown as UserSettings;

    const next = withHiddenColumns(current, ["done"]);

    expect(next.default_project).toBe("01PROJECT");
    expect(next.card_layout).toEqual(["assignee"]);
    expect((next as Record<string, unknown>)[HIDDEN_COLUMNS_KEY]).toEqual(["done"]);
  });

  // @verifies BRD-3
  it("ignores a hand-edited value that is not a list of column ids", () => {
    expect(hiddenColumnsOf({ [HIDDEN_COLUMNS_KEY]: "done" } as unknown as UserSettings)).toEqual([]);
    expect(hiddenColumnsOf({ [HIDDEN_COLUMNS_KEY]: [1, "done"] } as unknown as UserSettings))
      .toEqual(["done"]);
  });
});

/**
 * @verifies K9
 *
 * A card's status is always visible in a multi-status column. Without
 * it, a column collapsing `in_progress` and `blocked` is an
 * undifferentiated pile, and K8's cross-status reordering is guesswork.
 */
describe("resolveColumnCardLayout — K9", () => {
  it("shows status in a column that collapses several statuses", () => {
    const layout = resolveColumnCardLayout(["key", "priority"], ["in_progress", "blocked"]);
    expect(layout).toContain("status");
    // It leads: the status is what the user is scanning for.
    expect(layout[0]).toBe("status");
  });

  it("leaves a single-status column's layout alone", () => {
    const layout = resolveColumnCardLayout(["key", "priority"], ["in_progress"]);
    expect(layout).not.toContain("status");
    expect(layout).toEqual(["key", "priority"]);
  });

  it("does not duplicate a status the layout already lists", () => {
    const layout = resolveColumnCardLayout(["status", "key"], ["in_progress", "blocked"]);
    expect(layout.filter(f => f === "status")).toHaveLength(1);
    expect(layout).toEqual(["status", "key"]);
  });
});

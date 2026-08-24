import { HISTORY_KINDS, HistoryEntrySchema } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

/**
 * History had no schema at all. `isHistoryEntry` checked that
 * `timestamp` and `kind` were strings and nothing else, so `kind` was
 * never tested against its union — a hand-edited `not_a_real_kind`
 * reached every reader. `loctt log` printed it verbatim, and a UI that
 * switches on `kind` to pick an icon has no case for it.
 *
 * The schema must not undo P-11. A row it rejects is still *kept* in
 * the file and reported; rejecting decides what is readable, not what
 * is allowed to exist.
 */

describe("HistoryEntrySchema", () => {
  it("accepts an entry the code actually writes", () => {
    expect(HistoryEntrySchema.safeParse({
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "field_change",
      field: "status",
      before: "todo",
      after: "done",
      actor: "01J0000000000000000000USER",
    }).success).toBe(true);
  });

  it("rejects a kind outside the union", () => {
    // The gap this closes.
    expect(HistoryEntrySchema.safeParse({
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "not_a_real_kind",
    }).success).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    // Ordering and the merge identity key both read it.
    expect(HistoryEntrySchema.safeParse({ kind: "created" }).success).toBe(false);
  });

  it("accepts extra keys rather than rejecting the row", () => {
    // `.passthrough()`: a row from a newer LocTT carrying a field this
    // build does not know is still readable. Rejecting it would make a
    // forward-compatible file unreadable, which P-11 forbids.
    expect(HistoryEntrySchema.safeParse({
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "created",
      some_future_field: "x",
    }).success).toBe(true);
  });

  it("leaves before/after unconstrained", () => {
    // They capture arbitrary field transitions across every
    // custom-field type; constraining them would reject legal data.
    for (const v of ["s", 3, true, ["a"], { k: 1 }, null]) {
      expect(HistoryEntrySchema.safeParse({
        timestamp: "2026-01-01T00:00:00.000Z", kind: "field_change", before: v, after: v,
      }).success).toBe(true);
    }
  });

  it("covers every kind the union declares", () => {
    // Guards the derivation: `HistoryKind` is now
    // `(typeof HISTORY_KINDS)[number]`, so the two cannot drift — but
    // this fails loudly if someone reintroduces a hand-written union.
    for (const kind of HISTORY_KINDS) {
      expect(HistoryEntrySchema.safeParse({
        timestamp: "2026-01-01T00:00:00.000Z", kind,
      }).success, `kind "${kind}" should validate`).toBe(true);
    }
    expect(HISTORY_KINDS).toHaveLength(17);
  });
});

import { describe, expect, it } from "vitest";

import { parsePartition } from "./parse.ts";

/**
 * The reader's contract is that a ticket is never silently dropped and a
 * `Cases:` line is never silently half-read. Both failures make the
 * completeness gate pass by checking less than it claims to, which is worse
 * than no gate: the plan treats a green partition check as evidence that
 * every case has an owner.
 */

const doc = (...lines: string[]): string => lines.join("\n");

describe("parsePartition", () => {
  it("reads a ticket's id, title, and case list", () => {
    const { tickets } = parsePartition(
      doc("### M2.1 · Task detail — read shell ⬜", "Cases: TSK-1, TSK-2, TSK-3", "- a bullet"),
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      id: "M2.1",
      title: "Task detail — read shell",
      cases: ["TSK-1", "TSK-2", "TSK-3"],
      declared: true,
    });
  });

  it("distinguishes a ticket with no Cases: line from one declaring none", () => {
    const { tickets } = parsePartition(
      doc("### M1.1 · Shell ✅", "- a bullet", "", "### M1.2 · List ✅", "Cases:", "- a bullet"),
    );

    // Without this distinction the gate cannot tell "not yet partitioned"
    // from "deliberately owns nothing", and would accept the former.
    expect(tickets[0]).toMatchObject({ id: "M1.1", declared: false, cases: [] });
    expect(tickets[1]).toMatchObject({ id: "M1.2", declared: true, cases: [] });
  });

  it("does not carry a Cases: line into the following ticket", () => {
    const { tickets } = parsePartition(
      doc("### M1.1 · Shell ✅", "Cases: SHL-1", "", "### M1.2 · List ✅", "- no cases here"),
    );

    expect(tickets[1]).toMatchObject({ id: "M1.2", declared: false, cases: [] });
  });

  it("ends a ticket at the next ## heading", () => {
    const { tickets } = parsePartition(
      doc("### M1.4 · Bulk 🔵", "Cases: BLK-1", "", "# Milestone 2", "", "## Notes", "Cases: BLK-99"),
    );

    // A stray `Cases:` line in prose after the ticket must not be attributed
    // to it — that would place cases in a ticket nobody wrote them into.
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.cases).toEqual(["BLK-1"]);
  });

  it("throws when one ticket declares two Cases: lines", () => {
    // Whichever line the reader picked, the other's cases would go unchecked
    // while appearing to be owned.
    expect(() =>
      parsePartition(doc("### M2.1 · Detail ⬜", "Cases: TSK-1", "- a bullet", "Cases: TSK-2")),
    ).toThrow(/second "Cases:" line/);
  });

  it("reads unplaceable entries with their reasons", () => {
    const { unplaceable } = parsePartition(
      doc(
        "### M1.1 · Shell ✅",
        "Cases: SHL-1",
        "",
        "## Unplaceable cases",
        "",
        "- XS-12 — spans M2 and M3; needs a call on where parity is asserted",
      ),
    );

    expect(unplaceable).toEqual([
      {
        id: "XS-12",
        reason: "spans M2 and M3; needs a call on where parity is asserted",
        line: 6,
      },
    ]);
  });

  it("does not treat unplaceable bullets as belonging to the preceding ticket", () => {
    const { tickets } = parsePartition(
      doc("### M1.1 · Shell ✅", "Cases: SHL-1", "", "## Unplaceable cases", "- XS-12 — why"),
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.cases).toEqual(["SHL-1"]);
  });
});

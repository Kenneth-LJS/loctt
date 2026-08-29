import { formatCommentEditors as coreFormat } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { formatCommentEditors, UNKNOWN_EDITOR } from "./editors.ts";

/**
 * The "edited" marker, and its agreement with core.
 *
 * This module is a deliberate copy of core's `formatCommentEditors`
 * (see `editors.ts` for why it is not imported into the browser
 * bundle). A copy that nothing compares against is drift waiting to
 * happen, so core's own function is imported *here* — this file runs
 * in Node, where pulling core in costs nothing — and the two are
 * checked to agree.
 */

describe("formatCommentEditors", () => {
  const names: Record<string, string> = { u_sam: "Sam", u_alex: "Alex", u_jo: "Jo" };
  const resolve = (id: string): string | undefined => names[id];

  /** @verifies CMT-5 */
  it("renders nothing for a comment that has never been edited", () => {
    expect(formatCommentEditors({}, resolve)).toBeUndefined();
    // Paired positive: `edited` is what turns the marker on, so the
    // undefined above is about the flag rather than about the resolver.
    expect(formatCommentEditors({ edited: true }, resolve)).toBe("Edited");
  });

  /** @verifies CMT-5 CMT-35 */
  it("renders a bare marker for a self-edit and a named one for someone else's", () => {
    // Core excludes self-edits from `editors`, so an empty list *is*
    // the author having edited their own comment. CMT-5: "editing
    // one's own comment renders the plain 'edited' marker".
    expect(formatCommentEditors({ edited: true, editors: [] }, resolve)).toBe("Edited");

    // And an edit by someone else names them — CMT-35's "author
    // primarily with 'Edited by <editor>' secondary". These are
    // different renderings, not alternatives, so both are asserted.
    expect(formatCommentEditors({ edited: true, editors: ["u_sam"] }, resolve))
      .toBe("Edited by Sam");
    expect(formatCommentEditors({ edited: true, editors: ["u_sam", "u_alex"] }, resolve))
      .toBe("Edited by Sam and Alex");
    expect(formatCommentEditors({ edited: true, editors: ["u_sam", "u_alex", "u_jo"] }, resolve))
      .toBe("Edited by Sam, Alex, and Jo");
  });

  /** @verifies CMT-21 */
  it("never puts an unresolvable editor's ULID in the marker", () => {
    const ghost = "01M15GONE00000000000000000";
    const out = formatCommentEditors({ edited: true, editors: [ghost] }, resolve);

    expect(out).toBe(`Edited by ${UNKNOWN_EDITOR}`);
    // The assertion that matters: the id is not in the string. Core's
    // own version falls back to the raw id here, which is the LST-33
    // shape — this copy deliberately does not.
    expect(out).not.toContain(ghost);
    expect(coreFormat({ edited: true, editors: [ghost] })).toContain(ghost);
  });

  /** @verifies CMT-5 */
  it("agrees with core wherever both can name the editors", () => {
    /**
     * The drift check. Every case where core resolves a name is a case
     * the two must render identically; the only intended difference is
     * the unresolvable-id fallback asserted above.
     */
    const cases: { edited?: true; editors?: string[] }[] = [
      {},
      { edited: true },
      { edited: true, editors: [] },
      { edited: true, editors: ["u_sam"] },
      { edited: true, editors: ["u_sam", "u_alex"] },
      { edited: true, editors: ["u_sam", "u_alex", "u_jo"] },
    ];
    for (const c of cases) {
      expect(formatCommentEditors(c, resolve)).toBe(coreFormat(c, resolve));
    }
  });
});

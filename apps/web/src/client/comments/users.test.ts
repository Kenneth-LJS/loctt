import type { UserProfile } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { authorTitle, buildUserIndex, UNKNOWN_AUTHOR } from "./users.ts";

/**
 * The ULID → person join, and its two failure modes.
 *
 * The P-4 trap this file exists for: `author` and every mention's
 * `userId` are raw ULIDs, and LST-33 shipped one into UI content
 * because a lookup fell through behind a test that asserted a row
 * "appears" — which a ULID satisfies. So these assert the *string a
 * reader would see*, and specifically assert it is not the id.
 */

function user(id: string, name: string, extra: Partial<UserProfile> = {}): UserProfile {
  return { id, name, timezone: "UTC" as UserProfile["timezone"], ...extra };
}

const ANA = user("01M15ANA0000000000000000AA", "Ana Lopez", { email: "ana@example.com" });
const BO = user("01M15BO00000000000000000BB", "Bo Reed");
const SAM = user("01M15SAM0000000000000000CC", "Sam Gone", { archived: true });

describe("buildUserIndex", () => {
  /** @verifies CMT-21 */
  it("names an unknown author honestly rather than leaking the ULID or going blank", () => {
    const index = buildUserIndex([ANA]);
    const ghost = "01M15DELETED000000000000ZZ";

    expect(index.name(ghost)).toBe(UNKNOWN_AUTHOR);
    // The two ways this goes wrong, asserted as such rather than
    // implied by the positive above.
    expect(index.name(ghost)).not.toBe(ghost);
    expect(index.name(ghost)).not.toBe("");
    expect(index.name(ghost)).not.toContain(ghost);

    // Paired positive: a *known* id still resolves, so "always says
    // Unknown user" would not pass.
    expect(index.name(ANA.id)).toBe("Ana Lopez");
    expect(index.known(ANA.id)).toBe(true);
    expect(index.known(ghost)).toBe(false);
  });

  /** @verifies CMT-21 */
  it("puts the unrecognised id in a tooltip, and only for an unrecognised one", () => {
    const index = buildUserIndex([ANA]);
    const ghost = "01M15DELETED000000000000ZZ";

    // The id is recoverable for whoever is debugging …
    expect(authorTitle(index, ghost)).toContain(ghost);
    // … and absent for a user whose name already answers the question.
    expect(authorTitle(index, ANA.id)).toBeUndefined();
  });

  /** @verifies CMT-8 */
  it("excludes archived users from the mentionable list but still resolves them", () => {
    const index = buildUserIndex([ANA, BO, SAM]);

    // Not offered for a *new* mention — and not merely ranked lower:
    // absent, so no query string can surface them.
    expect(index.mentionable.map(c => c.name)).toEqual(["Ana Lopez", "Bo Reed"]);
    expect(index.mentionable.some(c => c.id === SAM.id)).toBe(false);

    // But an *existing* mention of them still resolves, marked
    // archived — CMT-8's last bullet, historical attribution.
    const resolved = index.mention(SAM.id);
    expect(resolved).toEqual({ id: SAM.id, name: "Sam Gone", archived: true });

    // And a live user is not marked archived, so the flag means
    // something rather than always being true.
    expect(index.mention(ANA.id)?.archived).toBe(false);
    expect(index.mention("01M15NOBODY00000000000000")).toBeUndefined();
  });

  /** @verifies CMT-7 */
  it("gives every candidate a hint — the email when there is one, a truncated id otherwise", () => {
    const index = buildUserIndex([ANA, BO]);
    const hints = new Map(index.mentionable.map(c => [c.name, c.hint]));

    expect(hints.get("Ana Lopez")).toBe("ana@example.com");
    // No email, so the id's tail — enough to tell two Bos apart, and
    // short enough not to be a ULID in the reader's face.
    expect(hints.get("Bo Reed")).toBe(`…${BO.id.slice(-6)}`);
    expect(hints.get("Bo Reed")).not.toBe(BO.id);
  });

  /** @verifies CMT-7 */
  it("disambiguates two users who share a display name", () => {
    const ana2 = user("01M15ANA2000000000000000DD", "Ana Lopez", { email: "a.lopez@example.com" });
    const index = buildUserIndex([ANA, ana2]);

    const rows = index.mentionable.filter(c => c.name === "Ana Lopez");
    expect(rows).toHaveLength(2);
    // The names are identical, so the hints are the only thing that
    // can tell them apart — and they must differ.
    expect(rows[0]?.hint).not.toBe(rows[1]?.hint);
    expect(new Set(rows.map(r => r.id)).size).toBe(2);
  });
});

import { describe, expect, it } from "vitest";

import { parseUserProfile, serializeUserProfile, UserProfileError } from "./profile.js";

describe("parseUserProfile", () => {
  it("parses a complete profile", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
email: ken@example.com
timezone: America/Los_Angeles
avatar: avatar.png
`);
    expect(profile).toEqual({
      id: "01HXXXXXXXXXXXXXXXXXXXXXXX",
      name: "Ken",
      email: "ken@example.com",
      timezone: "America/Los_Angeles",
      avatar: "avatar.png",
    });
    // A clean profile carries no health (omitted, not []).
    expect(profile.health).toBeUndefined();
  });

  it("preserves archived: true", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
archived: true
`);
    expect(profile.archived).toBe(true);
  });

  // ---- Object-fatal: only `id` fatals (a user is addressed by id) ----

  it("rejects a missing id (object-fatal)", () => {
    const yaml = `name: Ken
timezone: UTC
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow("id is required (expected string)");
  });

  it("rejects a blank id (object-fatal)", () => {
    const yaml = `id: ""
name: Ken
timezone: UTC
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
  });

  it("rejects a non-object payload (no record to degrade around)", () => {
    expect(() => parseUserProfile(`- just\n- a list\n`)).toThrow(UserProfileError);
  });

  // ---- Field-local: everything else degrades into `health` (Phase-7B) ----
  //
  // Was asserting the bug: these previously THREW, locking the whole
  // profile out over one hand-corrupted field. K26 says only identity
  // (`id`) is object-fatal; a bad email/timezone/avatar/name degrades.

  // @verifies DEG-13
  it("degrades an unknown timezone into health, keeping the user loadable", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: Mars/Olympus_Mons
`);
    expect(profile.id).toBe("01HXXXXXXXXXXXXXXXXXXXXXXX");
    expect(profile.name).toBe("Ken");
    // The corrupt value is NOT on the record...
    expect(profile.timezone).toBeUndefined();
    // ...it is set aside in health, with the raw value preserved.
    const h = profile.health?.find(f => f.field === "timezone");
    expect(h?.kind).toBe("wrong_type");
    expect(h?.raw).toBe("Mars/Olympus_Mons");
  });

  it("degrades an invalid email into health", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
email: "not an email"
`);
    expect(profile.email).toBeUndefined();
    const h = profile.health?.find(f => f.field === "email");
    expect(h?.kind).toBe("wrong_type");
    expect(h?.raw).toBe("not an email");
  });

  it("degrades an empty name into health (missing_required semantics)", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: ""
timezone: UTC
`);
    expect(profile.name).toBeUndefined();
    const h = profile.health?.find(f => f.field === "name");
    expect(h).toBeDefined();
    // A present-but-empty name is a wrong_type/too_small fault, not absence.
    expect(h?.raw).toBe("");
  });

  it("degrades an absent required field (timezone) as missing_required", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
`);
    expect(profile.timezone).toBeUndefined();
    const h = profile.health?.find(f => f.field === "timezone");
    expect(h?.kind).toBe("missing_required");
  });

  // @verifies DEG-13
  it("degrades an unknown key into health (unrecognised), preserving its value", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
phone: "+1 555"
`);
    expect(profile.name).toBe("Ken");
    const h = profile.health?.find(f => f.field === "phone");
    expect(h?.kind).toBe("unrecognised");
    expect(h?.raw).toBe("+1 555");
  });

  it("degrades a path-traversal avatar into health rather than fatalling", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
avatar: "../../etc/passwd"
`);
    // The unsafe value is NOT applied to the record...
    expect(profile.avatar).toBeUndefined();
    // ...but is set aside for repair, preserved verbatim.
    const h = profile.health?.find(f => f.field === "avatar");
    expect(h?.kind).toBe("wrong_type");
    expect(h?.raw).toBe("../../etc/passwd");
  });

  it("accepts a plain basename", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
avatar: avatar.png
`);
    expect(profile.avatar).toBe("avatar.png");
  });
});

describe("serializeUserProfile round-trip (K27 value-preserved)", () => {
  it("re-emits a corrupt field's raw value so a load → save does not drop it", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: Mars/Olympus_Mons
phone: "+1 555"
`;
    const profile = parseUserProfile(yaml);
    // Sanity: both are degraded, not on the record.
    expect(profile.timezone).toBeUndefined();

    const out = serializeUserProfile(profile);
    // The corrupt timezone and the unknown key both survive the round trip.
    const reloaded = parseUserProfile(out);
    expect(reloaded.health?.find(f => f.field === "timezone")?.raw).toBe(
      "Mars/Olympus_Mons",
    );
    expect(reloaded.health?.find(f => f.field === "phone")?.raw).toBe("+1 555");
  });
});

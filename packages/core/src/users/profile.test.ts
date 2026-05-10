import { describe, expect, it } from "vitest";

import { parseUserProfile, UserProfileError } from "./profile.js";

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
  });

  it("preserves archived: true", () => {
    const profile = parseUserProfile(`id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
archived: true
`);
    expect(profile.archived).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: Mars/Olympus_Mons
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow(/timezone/);
  });

  it("rejects an empty name", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: ""
timezone: UTC
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow("name must be a non-empty string");
  });

  it("rejects an invalid email", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
email: "not an email"
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow(/email/);
  });

  it("rejects a missing id", () => {
    const yaml = `name: Ken
timezone: UTC
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow("id is required (expected string)");
  });

  it("rejects a missing timezone", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow(/timezone/);
  });

  it("rejects unknown keys", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
phone: "+1 555"
`;
    expect(() => parseUserProfile(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects an avatar with a path separator", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
avatar: "../../etc/passwd"
`;
    expect(() => parseUserProfile(yaml)).toThrow(UserProfileError);
    expect(() => parseUserProfile(yaml)).toThrow(/basename/);
  });

  it("rejects an avatar with a leading slash", () => {
    const yaml = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
avatar: "/etc/passwd"
`;
    expect(() => parseUserProfile(yaml)).toThrow(/basename/);
  });

  it("rejects '.' or '..' as avatar", () => {
    const dot = `id: 01HXXXXXXXXXXXXXXXXXXXXXXX
name: Ken
timezone: UTC
avatar: "."
`;
    expect(() => parseUserProfile(dot)).toThrow(/must not be/);
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

import { describe, expect, it } from "vitest";

import { UserSettingsSchema } from "./users.js";

describe("UserSettings", () => {
  it("accepts an empty object", () => {
    expect(UserSettingsSchema.parse({})).toEqual({});
  });

  it("accepts a default_project string", () => {
    const parsed = UserSettingsSchema.parse({ default_project: "backend" });
    expect(parsed.default_project).toBe("backend");
  });

  it("rejects an empty default_project", () => {
    expect(() => UserSettingsSchema.parse({ default_project: "" })).toThrow();
  });

  it("rejects a non-string default_project", () => {
    expect(() => UserSettingsSchema.parse({ default_project: 42 })).toThrow();
    expect(() => UserSettingsSchema.parse({ default_project: null })).toThrow();
  });

  it("passes through UI-only keys unchanged", () => {
    // Theme, card_layout, list_view, sidebar_pins etc. live in
    // the settings file but core does not interpret them. They must
    // survive a parse round-trip exactly as written.
    const input = {
      default_project: "backend",
      theme: "dark",
      card_layout: { show_priority: true, show_assignee: false },
      sidebar_pins: ["view-1", "view-2"],
      list_view: { filter_chips: { show: ["reporter"], hide: ["type"] } },
    };
    const parsed = UserSettingsSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it("passes through arbitrarily-typed UI values", () => {
    // Defensive: core has no opinion on UI value shapes. A future UI
    // adding new keys with novel shapes must not require a contract
    // change.
    const input = {
      future_ui_key: { nested: { deep: ["a", 1, true, null] } },
    };
    expect(UserSettingsSchema.parse(input)).toEqual(input);
  });
});

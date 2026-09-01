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
    // Theme, list_view, sidebar_pins etc. live in the settings file but
    // core does not interpret them. They must survive a parse round-trip
    // exactly as written.
    const input = {
      default_project: "backend",
      theme: "dark",
      sidebar_pins: ["view-1", "view-2"],
      list_view: { filter_chips: { show: ["reporter"], hide: ["type"] } },
    };
    const parsed = UserSettingsSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  describe("theme and sidebar_pins (SET-11, SET-13)", () => {
    // @verifies SET-11
    it("accepts the three theme preferences and rejects anything else", () => {
      for (const t of ["light", "dark", "system"]) {
        expect(UserSettingsSchema.parse({ theme: t }).theme).toBe(t);
      }
      // A hand-edited settings.yaml naming a theme that does not exist
      // is caught at load rather than repainting to nothing.
      expect(() => UserSettingsSchema.parse({ theme: "solarized" })).toThrow();
      expect(UserSettingsSchema.parse({}).theme).toBeUndefined();
    });

    // @verifies SET-13
    it("accepts an ordered pin array and preserves its order", () => {
      // Order is the sidebar order — this is why pins are an array and
      // not a set.
      const input = { sidebar_pins: ["v-c", "v-a", "v-b"] };
      expect(UserSettingsSchema.parse(input).sidebar_pins)
        .toEqual(["v-c", "v-a", "v-b"]);
    });

    // @verifies SET-13
    it("rejects a repeated pin and an empty pin id", () => {
      // A pin appearing twice has no meaningful sidebar position.
      expect(() => UserSettingsSchema.parse({ sidebar_pins: ["a", "a"] }))
        .toThrow();
      expect(() => UserSettingsSchema.parse({ sidebar_pins: [""] })).toThrow();
    });

    // @verifies SET-27
    it("accepts an empty pin list — every pin swept is representable", () => {
      // SET-27 rewrites settings.yaml after deleting every pinned
      // view. If `[]` were rejected the sweep could not persist its
      // result and would re-run on every load.
      expect(UserSettingsSchema.parse({ sidebar_pins: [] }).sidebar_pins)
        .toEqual([]);
    });
  });

  describe("card_layout (CW-17)", () => {
    it("accepts an ordered array and preserves its order", () => {
      // Order is the point: it carries render order as well as
      // visibility, so drag-to-reorder needs no second setting.
      const input = { card_layout: ["due_date", "priority", "assignee"] };
      const parsed = UserSettingsSchema.parse(input);
      expect(parsed.card_layout).toEqual(["due_date", "priority", "assignee"]);
    });

    it("distinguishes an explicit empty array from absence", () => {
      // [] means "title only" — a deliberate choice, not "use defaults".
      expect(UserSettingsSchema.parse({ card_layout: [] }).card_layout).toEqual([]);
      expect(UserSettingsSchema.parse({}).card_layout).toBeUndefined();
    });

    it("rejects the superseded boolean-map shape", () => {
      // The pre-CW-17 shape. Rejecting it means a hand-edited settings
      // file using the old form fails loudly instead of silently
      // rendering an empty card.
      expect(() =>
        UserSettingsSchema.parse({
          card_layout: { show_priority: true, show_assignee: false },
        }),
      ).toThrow();
    });

    it("rejects an unknown field name", () => {
      expect(() => UserSettingsSchema.parse({ card_layout: ["nonexistent"] })).toThrow();
    });

    it("rejects a repeated field", () => {
      // A field listed twice has no meaningful render position.
      expect(() =>
        UserSettingsSchema.parse({ card_layout: ["priority", "status", "priority"] }),
      ).toThrow(/must not repeat/);
    });
  });

  describe("editor_mode (D17)", () => {
    it("accepts the two editor modes", () => {
      expect(UserSettingsSchema.parse({ editor_mode: "wysiwyg" }).editor_mode).toBe("wysiwyg");
      expect(UserSettingsSchema.parse({ editor_mode: "source" }).editor_mode).toBe("source");
    });

    it("rejects an unknown mode", () => {
      expect(() => UserSettingsSchema.parse({ editor_mode: "vim" })).toThrow();
    });
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

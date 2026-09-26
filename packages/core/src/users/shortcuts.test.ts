import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GLOBAL_SHORTCUTS, SHORTCUT_IDS, UserSettingsSchema } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { blockingFindings, checkDataIntegrity } from "../diagnostics/integrity.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadUserSettings, saveUserSettings } from "./settings.js";
import {
  applyShortcutChanges,
  isShortcutActive,
  readKeyboardShortcuts,
  resolveKeyboardShortcuts,
  salvageKeyboardShortcuts,
  validateShortcutIds,
  withKeyboardShortcuts,
} from "./shortcuts.js";

/**
 * The per-user single-key shortcut switches (K133, A11Y-43): what
 * "active" means, how a change is applied and stored, and how a
 * hand-edited value degrades (corruption-handling guide: field-local,
 * reported by doctor).
 */

describe("the shortcut catalog", () => {
  it("has one entry per id, and every id is in the catalog", () => {
    expect(GLOBAL_SHORTCUTS.map(s => s.id)).toEqual([...SHORTCUT_IDS]);
  });

  it("keeps the three Go-to sequences under one shortcut", () => {
    const goto = GLOBAL_SHORTCUTS.find(s => s.id === "goto");
    expect(goto?.bindings.map(b => b.keys.join(" "))).toEqual(["g l", "g b", "g t"]);
  });
});

describe("resolving the switches", () => {
  // @verifies A11Y-43
  it("has everything on for a user who never touched the setting", () => {
    const state = resolveKeyboardShortcuts({});
    expect(state.singleKey).toBe(true);
    expect(state.shortcuts.every(s => s.on && s.active)).toBe(true);
  });

  // @verifies A11Y-43
  it("makes every shortcut inactive when the master is off, keeping each one's own switch", () => {
    const ks = { single_key: false, disabled: ["goto" as const] };
    const state = resolveKeyboardShortcuts(ks);
    expect(state.shortcuts.every(s => !s.active)).toBe(true);
    // The own-switch state survives, so turning the master back on
    // restores the user's choice.
    expect(state.shortcuts.find(s => s.id === "goto")?.on).toBe(false);
    expect(state.shortcuts.find(s => s.id === "new-task")?.on).toBe(true);
    expect(isShortcutActive(ks, "new-task")).toBe(false);
  });

  // @verifies A11Y-43
  it("makes only a shortcut switched off on its own inactive", () => {
    const ks = { disabled: ["cycle-theme" as const] };
    expect(isShortcutActive(ks, "cycle-theme")).toBe(false);
    expect(isShortcutActive(ks, "new-task")).toBe(true);
  });
});

describe("applying changes", () => {
  it("stores the master only when off, and keeps disabled in catalog order", () => {
    expect(applyShortcutChanges({}, { off: ["shortcut-help", "new-task"] })).toEqual({
      disabled: ["new-task", "shortcut-help"],
    });
    expect(applyShortcutChanges({ single_key: false }, { singleKey: true })).toEqual({});
    expect(applyShortcutChanges({}, { singleKey: false })).toEqual({ single_key: false });
  });

  it("keeps the per-shortcut list when the master changes", () => {
    expect(applyShortcutChanges({ disabled: ["goto"] }, { singleKey: false })).toEqual({
      single_key: false,
      disabled: ["goto"],
    });
  });

  it("lets `on` win over `off` for the same id", () => {
    expect(applyShortcutChanges({}, { off: ["goto"], on: ["goto"] })).toEqual({});
  });

  it("drops the key entirely on reset, keeping every other setting", () => {
    const settings = { theme: "dark" as const, keyboard_shortcuts: { single_key: false } };
    expect(withKeyboardShortcuts(settings, {})).toEqual({ theme: "dark" });
  });

  it("refuses an unknown id on the write path, naming it", () => {
    expect(validateShortcutIds(["goto", "bogus", "goto"])).toEqual({ known: ["goto"], unknown: ["bogus"] });
  });

  it("is rejected by the stored schema when it repeats or invents an id", () => {
    expect(UserSettingsSchema.safeParse({ keyboard_shortcuts: { disabled: ["goto", "goto"] } }).success).toBe(false);
    expect(UserSettingsSchema.safeParse({ keyboard_shortcuts: { disabled: ["bogus"] } }).success).toBe(false);
    expect(UserSettingsSchema.safeParse({ keyboard_shortcuts: { single_key: false, disabled: ["goto"] } }).success).toBe(true);
  });
});

describe("degrading a hand-edited value", () => {
  it("keeps valid ids and drops unknown, duplicate and non-string ones, naming each", () => {
    const out = salvageKeyboardShortcuts({ single_key: false, disabled: ["goto", "bogus", "goto", 42] });
    expect(out.value).toEqual({ single_key: false, disabled: ["goto"] });
    expect(out.dropped).toEqual([
      { field: "disabled", value: "bogus", reason: "unknown" },
      { field: "disabled", value: "goto", reason: "duplicate" },
      { field: "disabled", value: "42", reason: "malformed" },
    ]);
  });

  it("falls back to on for a non-boolean master without losing the list", () => {
    const out = salvageKeyboardShortcuts({ single_key: "no", disabled: ["goto"] });
    expect(out.value).toEqual({ disabled: ["goto"] });
    expect(out.dropped).toEqual([{ field: "single_key", value: "no", reason: "malformed" }]);
  });

  it("drops a value that is not an object to all-on", () => {
    expect(salvageKeyboardShortcuts("off")).toEqual({ value: {}, dropped: [], wholeValueDropped: true });
    expect(readKeyboardShortcuts({ keyboard_shortcuts: ["goto"] } as never)).toEqual({});
  });

  it("names a stray key so a typo'd `disable:` does not vanish silently", () => {
    const out = salvageKeyboardShortcuts({ disable: ["goto"] });
    expect(out.value).toEqual({});
    expect(out.dropped).toEqual([{ field: "key", value: "disable", reason: "malformed" }]);
  });
});

async function withUserSettings(
  yaml: string,
  fn: (ctx: { locttDir: string; userId: string; path: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "loctt-shortcuts-"));
  try {
    await initLoctt(root, { docs: false });
    const locttDir = resolveLocttDir(root);
    const userId = "01HXXXXXXXXXXXXXXXXXXXXXXX";
    await mkdir(join(locttDir, "users", userId), { recursive: true });
    await writeFile(join(locttDir, "users", userId, "profile.yaml"), `id: ${userId}\nname: Ken\n`, "utf-8");
    const path = join(locttDir, "users", userId, "settings.yaml");
    await writeFile(path, yaml, "utf-8");
    await fn({ locttDir, userId, path });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("loading and doctor", () => {
  // @verifies A11Y-43
  it("loads a corrupt value field-locally: the good parts and every other setting survive", async () => {
    await withUserSettings(
      "theme: dark\nkeyboard_shortcuts:\n  single_key: false\n  disabled: [goto, bogus]\n",
      async ({ locttDir, userId }) => {
        const settings = await loadUserSettings(locttDir, userId);
        expect(settings.theme).toBe("dark");
        expect(settings.keyboard_shortcuts).toEqual({ single_key: false, disabled: ["goto"] });
      },
    );
  });

  it("round-trips a clean value through save and load", async () => {
    await withUserSettings("theme: dark\n", async ({ locttDir, userId, path }) => {
      const settings = await loadUserSettings(locttDir, userId);
      await saveUserSettings(locttDir, userId, withKeyboardShortcuts(settings, { disabled: ["new-task"] }));
      expect(await readFile(path, "utf-8")).toContain("new-task");
      expect(readKeyboardShortcuts(await loadUserSettings(locttDir, userId))).toEqual({ disabled: ["new-task"] });
    });
  });

  it("names each dropped part in doctor, malformed and non-blocking", async () => {
    await withUserSettings(
      "keyboard_shortcuts:\n  single_key: maybe\n  disabled: [goto, bogus]\n",
      async ({ locttDir, userId }) => {
        const findings = await checkDataIntegrity(locttDir);
        const ks = findings.filter(f => f.path.includes(userId) && /keyboard_shortcuts/.test(f.message));
        expect(ks).toHaveLength(2);
        expect(ks.every(f => f.severity === "malformed")).toBe(true);
        expect(ks.some(f => /bogus/.test(f.message))).toBe(true);
        expect(ks.some(f => /single_key/.test(f.message) && /maybe/.test(f.message))).toBe(true);
        expect(blockingFindings(findings)).toHaveLength(0);
      },
    );
  });

  it("names a value that is not an object at all", async () => {
    await withUserSettings("keyboard_shortcuts: off\n", async ({ locttDir, userId }) => {
      const findings = await checkDataIntegrity(locttDir);
      const ks = findings.filter(f => f.path.includes(userId) && /keyboard_shortcuts/.test(f.message));
      expect(ks).toHaveLength(1);
      expect(ks[0]?.message).toMatch(/not a valid/);
    });
  });

  it("reports nothing for a clean value", async () => {
    await withUserSettings("keyboard_shortcuts:\n  disabled: [goto]\n", async ({ locttDir }) => {
      const findings = await checkDataIntegrity(locttDir);
      expect(findings.filter(f => /keyboard_shortcuts/.test(f.message))).toHaveLength(0);
    });
  });
});

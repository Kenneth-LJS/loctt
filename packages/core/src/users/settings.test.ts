import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { loadUserSettings, saveUserSettings } from "./settings.js";

const USER_ID = "01HXXXXXXXXXXXXXXXXXXXXXXX";

describe("loadUserSettings corruption tolerance (Phase-7B)", () => {
  let locttDir: string;

  beforeEach(async () => {
    locttDir = await mkdtemp(join(tmpdir(), "loctt-settings-"));
  });
  afterEach(async () => {
    await rm(locttDir, { recursive: true, force: true });
  });

  async function writeSettings(yaml: string): Promise<void> {
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, yaml, "utf-8");
  }

  it("loads healthy settings unchanged", async () => {
    await writeSettings(`theme: dark\ndefault_project: web\n`);
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.theme).toBe("dark");
    expect(settings.default_project).toBe("web");
  });

  it("returns {} when the file is absent", async () => {
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings).toEqual({});
  });

  // The central guarantee: a wrong-typed KNOWN setting must NOT lock the
  // user out of their whole settings surface. Was asserting the bug —
  // the plain `.parse()` threw here, 500-ing every settings panel.
  // @verifies DEG-28
  it("degrades a wrong-typed known key (theme: 42) to default, keeping the rest", async () => {
    await writeSettings(`theme: 42\ndefault_project: web\n`);
    const settings = await loadUserSettings(locttDir, USER_ID);
    // The corrupt known key is dropped (falls back to default/absent)...
    expect(settings.theme).toBeUndefined();
    // ...but the healthy known key beside it still loads.
    expect(settings.default_project).toBe("web");
  });

  it("degrades a wrong-typed card_layout without throwing", async () => {
    await writeSettings(`card_layout: "big"\ntheme: light\n`);
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.card_layout).toBeUndefined();
    expect(settings.theme).toBe("light");
  });

  // The load-bearing passthrough (Group-G): unknown keys are NOT
  // corruption — they must survive untouched even alongside a corrupt
  // known key. If this drops the unknown key, a settings save would
  // destroy data like sidebar pins a newer client wrote.
  // @verifies DEG-28
  it("preserves unknown passthrough keys even when a known key is corrupt", async () => {
    await writeSettings(
      `theme: 42\nexperimental_pins: [a, b, c]\nsome_future_key: hello\n`,
    );
    const settings = await loadUserSettings(locttDir, USER_ID) as Record<string, unknown>;
    expect(settings["theme"]).toBeUndefined();
    // Unknown keys pass through byte-for-byte.
    expect(settings["experimental_pins"]).toEqual(["a", "b", "c"]);
    expect(settings["some_future_key"]).toBe("hello");
  });

  it("preserves an unknown key when everything typed is healthy", async () => {
    await writeSettings(`theme: dark\nsidebar_extra: keep-me\n`);
    const settings = await loadUserSettings(locttDir, USER_ID) as Record<string, unknown>;
    expect(settings["theme"]).toBe("dark");
    expect(settings["sidebar_extra"]).toBe("keep-me");
  });

  // K159: pinned views are retired. A stored value must load, must not
  // surface as a setting, and must be dropped by the next write; only a
  // pre-K158 sidebar_groups (or none yet) still needs it, to seed the migration.
  it("loads a legacy sidebar_pins cleanly and the next write drops it (K159)", async () => {
    await writeSettings(`theme: dark\nsidebar_pins:\n  - v1\n  - v2\nsidebar_groups:\n  version: 2\n  order: [labels]\n`);
    const loaded = await loadUserSettings(locttDir, USER_ID);
    expect(loaded.theme).toBe("dark");
    await saveUserSettings(locttDir, USER_ID, { ...loaded, theme: "light" });
    const raw = await readFile(getUserSettingsPath(locttDir, USER_ID), "utf-8");
    expect(raw).not.toContain("sidebar_pins");
    expect(raw).toContain("theme: light");
    expect(raw).toContain("labels");
  });

  it("a wrong-typed sidebar_pins does not break loading (K159)", async () => {
    await writeSettings(`theme: dark\nsidebar_pins: 42\n`);
    expect((await loadUserSettings(locttDir, USER_ID)).theme).toBe("dark");
  });

  it("keeps sidebar_pins through a write while sidebar_groups is still pre-K158, so the migration can seed from it (K159)", async () => {
    await writeSettings(`sidebar_pins: [v1]\nsidebar_groups:\n  order: [labels]\n`);
    const loaded = await loadUserSettings(locttDir, USER_ID);
    await saveUserSettings(locttDir, USER_ID, { ...loaded, theme: "dark" });
    expect(await readFile(getUserSettingsPath(locttDir, USER_ID), "utf-8")).toContain("sidebar_pins");
  });
});

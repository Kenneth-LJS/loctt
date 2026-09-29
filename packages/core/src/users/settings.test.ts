import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { collectUnreadableSettings, loadUserSettings, saveUserSettings, UnreadableSettingsError } from "./settings.js";

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

  // K159 retired pinned views; K160's upgrade step moves them into the
  // sidebar order and deletes the key. One left after that is corrupt:
  // ignored on load (nothing reads it), so the next write of the settings
  // leaves it behind; doctor names the file until then.
  it("K160: a stray sidebar_pins is ignored on load and the next write leaves it behind", async () => {
    await writeSettings(`theme: dark\nsidebar_pins:\n  - v1\n  - v2\nsidebar_groups:\n  version: 2\n  order: [labels]\n`);
    const loaded = await loadUserSettings(locttDir, USER_ID) as Record<string, unknown>;
    expect(loaded["theme"]).toBe("dark");
    expect(loaded["sidebar_pins"]).toBeUndefined();
    await saveUserSettings(locttDir, USER_ID, { ...loaded, theme: "light" });
    const raw = await readFile(getUserSettingsPath(locttDir, USER_ID), "utf-8");
    expect(raw).not.toContain("sidebar_pins");
    expect(raw).toContain("theme: light");
    expect(raw).toContain("labels");
  });

  it("K160: no exception for a pre-K158 sidebar_groups any more: the pins do not survive a write beside one", async () => {
    // B53 kept pins through a write while sidebar_groups was pre-K158, so
    // the read-time migration could seed from them. The step does that now.
    await writeSettings(`sidebar_pins: [v1]\nsidebar_groups:\n  order: [labels]\n`);
    const loaded = await loadUserSettings(locttDir, USER_ID);
    await saveUserSettings(locttDir, USER_ID, { ...loaded, theme: "dark" });
    expect(await readFile(getUserSettingsPath(locttDir, USER_ID), "utf-8")).not.toContain("sidebar_pins");
  });

  it("a wrong-typed sidebar_pins does not break loading (K159)", async () => {
    await writeSettings(`theme: dark\nsidebar_pins: 42\n`);
    expect((await loadUserSettings(locttDir, USER_ID)).theme).toBe("dark");
  });
});

// B56 (G12): a settings file that does not parse, or is not a mapping,
// used to make every settings read throw for that user. It now loads as
// no settings, and a write refuses rather than replace the file with the
// defaults plus one change.
describe("an unreadable settings.yaml (B56)", () => {
  let locttDir: string;

  beforeEach(async () => {
    locttDir = await mkdtemp(join(tmpdir(), "loctt-settings-unreadable-"));
  });
  afterEach(async () => {
    await rm(locttDir, { recursive: true, force: true });
  });

  async function writeSettings(text: string): Promise<string> {
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf-8");
    return path;
  }

  const UNREADABLE: ReadonlyArray<readonly [string, string]> = [
    ["does not parse as YAML", "theme: [dark\ndefault_project: web\n"],
    ["is a list", "- theme\n- dark\n"],
    ["is a bare value", "dark\n"],
  ];

  // @verifies DEG-28
  it.each(UNREADABLE)("loads as no settings when the file %s", async (_what, text) => {
    await writeSettings(text);
    expect(await loadUserSettings(locttDir, USER_ID)).toEqual({});
  });

  // @verifies DEG-28
  it.each(UNREADABLE)("refuses a write, leaving the file as it is, when the file %s", async (_what, text) => {
    const path = await writeSettings(text);
    const err = await saveUserSettings(locttDir, USER_ID, { theme: "light" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnreadableSettingsError);
    const envelope = (err as UnreadableSettingsError).toEnvelope();
    expect(envelope.code).toBe("config_invalid");
    expect(envelope.data_state).toBe("not_saved");
    expect(envelope.message).toContain(join("users", USER_ID, "settings.yaml"));
    expect(await readFile(path, "utf-8")).toBe(text);
  });

  it("a file of comments only is no settings, and a write replaces it", async () => {
    const path = await writeSettings("# nothing here yet\n");
    expect(await loadUserSettings(locttDir, USER_ID)).toEqual({});
    await saveUserSettings(locttDir, USER_ID, { theme: "dark" });
    expect(await readFile(path, "utf-8")).toContain("theme: dark");
  });

  it("doctor's scan names the file, including one that is not a mapping", async () => {
    await writeSettings("- theme\n");
    const reports = await collectUnreadableSettings(locttDir);
    expect(reports.map(r => r.userId)).toEqual([USER_ID]);
    expect(reports[0]?.error).toMatch(/name: value/);
  });
});

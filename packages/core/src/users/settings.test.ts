import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { loadUserSettings } from "./settings.js";

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
});

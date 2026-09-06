import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { UserSettings } from "@loctt/contracts";
import { SIDEBAR_GROUP_IDS, SIDEBAR_ITEM_IDS } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { loadUserSettings, saveUserSettings } from "./settings.js";
import {
  readSidebarGroups,
  resolveSidebarOrder,
  salvageSidebarGroups,
} from "./sidebarGroups.js";

const USER_ID = "01HXXXXXXXXXXXXXXXXXXXXXXX";

describe("readSidebarGroups", () => {
  it("returns {} when the setting is absent (default order, all visible)", () => {
    expect(readSidebarGroups(undefined)).toEqual({});
    expect(readSidebarGroups({})).toEqual({});
  });

  it("returns a clean stored value unchanged", () => {
    const stored = { sidebar_groups: { order: ["labels", "projects"], hidden: ["sprints"] } } as unknown as UserSettings;
    expect(readSidebarGroups(stored)).toEqual({
      order: ["labels", "projects"],
      hidden: ["sprints"],
    });
  });

  it("drops an unknown group id rather than discarding the whole setting", () => {
    // @verifies SHL-45 — degrade on an unknown group id
    const stored = { sidebar_groups: { order: ["labels", "not-a-group", "projects"] } } as unknown as UserSettings;
    // The whole thing is NOT thrown away; the unknown id is lifted out.
    expect(readSidebarGroups(stored)).toEqual({ order: ["labels", "projects"] });
  });

  it("de-dups a repeated id rather than failing", () => {
    // @verifies SHL-45 — degrade on a duplicate group id
    const stored = { sidebar_groups: { order: ["labels", "labels", "projects"] } } as unknown as UserSettings;
    expect(readSidebarGroups(stored)).toEqual({ order: ["labels", "projects"] });
  });

  it("treats a wrong-shaped value as no customization", () => {
    const bad = (v: unknown) => readSidebarGroups({ sidebar_groups: v } as unknown as UserSettings);
    expect(bad("banana")).toEqual({});
    expect(bad(42)).toEqual({});
    expect(bad(["a", "b"])).toEqual({});
  });
});

describe("salvageSidebarGroups records every drop so doctor can name it", () => {
  // Fix-review finding 3: these three malformed shapes used to be salvaged
  // SILENTLY — no drop recorded, so doctor reported the file as clean while
  // the user's intent (hide a group) was lost. Each must now record a drop.

  it("records a scalar-instead-of-list as malformed (the realistic typo)", () => {
    // @verifies SHL-45 — a user writes a single id as a scalar
    const r = salvageSidebarGroups({ order: ["views"], hidden: "sprints" });
    expect(r.groups).toEqual({ order: ["views"] });
    expect(r.dropped).toContainEqual({ list: "hidden", id: expect.any(String), reason: "malformed" });
  });

  it("records a non-string element as malformed rather than skipping it", () => {
    // @verifies SHL-45
    const r = salvageSidebarGroups({ hidden: [42, "labels"] });
    expect(r.groups).toEqual({ hidden: ["labels"] });
    expect(r.dropped).toContainEqual({ list: "hidden", id: "42", reason: "malformed" });
  });

  it("records a stray/typo'd key so the ids under it are not lost silently", () => {
    // @verifies SHL-45 — `hiden` instead of `hidden`
    const r = salvageSidebarGroups({ order: ["views"], hiden: ["sprints"] });
    expect(r.groups).toEqual({ order: ["views"] });
    expect(r.dropped.some(d => d.reason === "malformed" && d.id.includes("hiden"))).toBe(true);
  });
});

describe("resolveSidebarOrder", () => {
  const CATALOG = [...SIDEBAR_GROUP_IDS];

  it("yields the full catalog in default order, all visible, for an empty setting", () => {
    const resolved = resolveSidebarOrder({}, CATALOG);
    expect(resolved.map(r => r.id)).toEqual(CATALOG);
    expect(resolved.every(r => !r.hidden)).toBe(true);
  });

  it("places ordered ids first, then the rest in default order", () => {
    const resolved = resolveSidebarOrder({ order: ["labels", "projects"] }, CATALOG);
    expect(resolved.slice(0, 2).map(r => r.id)).toEqual(["labels", "projects"]);
    // Every catalog id is present exactly once.
    expect(new Set(resolved.map(r => r.id))).toEqual(new Set(CATALOG));
    expect(resolved).toHaveLength(CATALOG.length);
  });

  it("marks hidden ids without removing them from the list", () => {
    // @verifies SHL-45 — hidden groups are absent from the render but remembered
    const resolved = resolveSidebarOrder({ hidden: ["sprints", "recents"] }, CATALOG);
    const hidden = resolved.filter(r => r.hidden).map(r => r.id);
    expect(hidden).toEqual(expect.arrayContaining(["sprints", "recents"]));
    expect(resolved).toHaveLength(CATALOG.length);
  });

  it("skips a setting id that is not in the passed catalog", () => {
    // A filter id fed a group-only catalog is not placed.
    const resolved = resolveSidebarOrder({ order: ["overdue", "labels"] }, CATALOG);
    expect(resolved.map(r => r.id)).not.toContain("overdue");
    expect(resolved[0]?.id).toBe("labels");
  });
});

describe("sidebar_groups round-trips through settings.yaml", () => {
  let locttDir: string;
  beforeEach(async () => {
    locttDir = await mkdtemp(join(tmpdir(), "loctt-sbgroups-"));
  });
  afterEach(async () => {
    await rm(locttDir, { recursive: true, force: true });
  });

  it("saves and reloads a sidebar_groups setting intact", async () => {
    // @verifies SHL-45 — the setting persists per-user
    await saveUserSettings(locttDir, USER_ID, {
      sidebar_groups: { order: ["labels", "projects"], hidden: ["sprints"] },
    } as UserSettings);
    const reloaded = await loadUserSettings(locttDir, USER_ID);
    expect(readSidebarGroups(reloaded)).toEqual({
      order: ["labels", "projects"],
      hidden: ["sprints"],
    });
  });

  it("salvages a hand-corrupted sidebar_groups per-field without locking the file", async () => {
    // @verifies SHL-45 — a bad group id degrades ONE entry, valid ids
    // survive, and other settings load. The tolerant settings loader
    // runs a faulting sidebar_groups through per-field salvage (not a
    // whole-key drop): `bogus` and the duplicate `labels` are lifted out,
    // `labels` and `projects` are kept, and `theme` still loads (P7).
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      "theme: dark\nsidebar_groups:\n  order: [labels, bogus, labels, projects]\n",
      "utf-8",
    );
    const settings = await loadUserSettings(locttDir, USER_ID);
    // The rest of the file still loads (this is the whole point of P7).
    expect(settings.theme).toBe("dark");
    // The valid ids are salvaged — the whole customization is NOT thrown
    // away over one stray id (field-local degrade).
    expect(readSidebarGroups(settings)).toEqual({ order: ["labels", "projects"] });
  });

  it("degrades a wholly-unshaped sidebar_groups to default (nothing to salvage)", async () => {
    // @verifies SHL-45 — a scalar/bare-list value has no per-field
    // structure to keep, so it degrades to absent while `theme` loads.
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "theme: dark\nsidebar_groups: banana\n", "utf-8");
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.theme).toBe("dark");
    expect(readSidebarGroups(settings)).toEqual({});
  });

  it("salvages valid ids when a raw (non-loader) settings object is read", () => {
    // readSidebarGroups is also used on raw objects (the web client
    // reads settings straight from the API), so its own salvage path —
    // drop unknown/duplicate ids, keep the rest — must hold independently
    // of the loader's key-granular degrade.
    const raw = { sidebar_groups: { order: ["labels", "bogus", "labels", "projects"] } };
    expect(readSidebarGroups(raw as unknown as UserSettings)).toEqual({
      order: ["labels", "projects"],
    });
  });

  it("keeps every catalog id resolvable after a corrupt read", async () => {
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "sidebar_groups: not-an-object\n", "utf-8");
    const settings = await loadUserSettings(locttDir, USER_ID);
    const resolved = resolveSidebarOrder(readSidebarGroups(settings), [...SIDEBAR_ITEM_IDS]);
    expect(resolved).toHaveLength(SIDEBAR_ITEM_IDS.length);
  });
});

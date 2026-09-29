import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SidebarGroups, UserSettings } from "@loctt/contracts";
import { SIDEBAR_BUILTIN_VIEW_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { loadUserSettings, saveUserSettings } from "./settings.js";
import {
  forgetSavedViewInSidebar,
  readSidebarGroups,
  resolveRenderedSidebarItems,
  resolveSidebarLayout,
  resolveSidebarOrder,
  salvageSidebarGroups,
  setSidebarItemHidden,
  sidebarGroupsFromLayout,
  type SidebarOrderInput,
  type SidebarSavedView,
  sidebarSavedViews,
  validateSidebarIds,
} from "./sidebarGroups.js";

const USER_ID = "01HXXXXXXXXXXXXXXXXXXXXXXX";
const BUILTINS = [...SIDEBAR_BUILTIN_VIEW_IDS];

const VIEWS: readonly SidebarSavedView[] = [
  { id: "bugs", name: "Open bugs", broken: false },
  { id: "mine", name: "Mine", broken: false },
];

/** A settings object holding a raw `sidebar_groups` value. */
const withGroups = (v: unknown): UserSettings => ({ sidebar_groups: v } as unknown as UserSettings);

/** The Views group's child ids, in resolved order. */
function childIds(groups: SidebarOrderInput, views = VIEWS): string[] {
  const row = resolveSidebarLayout(groups, views).find(r => r.kind === "views");
  return row?.kind === "views" ? row.children.map(c => c.id) : [];
}

/** The top-level ids, in resolved order. */
function topIds(groups: SidebarOrderInput, views = VIEWS): string[] {
  return resolveSidebarLayout(groups, views).map(r => (r.kind === "views" ? "views" : r.id));
}

describe("readSidebarGroups (K158 shape)", () => {
  it("returns the default (version only) when the setting is absent", () => {
    expect(readSidebarGroups(undefined)).toEqual({ version: 2 });
    expect(readSidebarGroups({})).toEqual({ version: 2 });
  });

  it("returns a clean K158 value unchanged", () => {
    const stored = withGroups({ version: 2, order: ["labels", "views", "view:bugs", "overdue"], hidden: ["view:mine"] });
    expect(readSidebarGroups(stored)).toEqual({
      version: 2,
      order: ["labels", "views", "view:bugs", "overdue"],
      hidden: ["view:mine"],
    });
  });

  it("drops an unknown id rather than discarding the whole setting", () => {
    // @verifies SHL-45 — degrade on an unknown group id
    const stored = withGroups({ version: 2, order: ["labels", "not-a-group", "projects"] });
    expect(readSidebarGroups(stored)).toEqual({ version: 2, order: ["labels", "projects"] });
  });

  it("de-dups a repeated id rather than failing", () => {
    // @verifies SHL-45 — degrade on a duplicate group id
    const stored = withGroups({ version: 2, order: ["labels", "labels", "projects"] });
    expect(readSidebarGroups(stored)).toEqual({ version: 2, order: ["labels", "projects"] });
  });

  it("treats a wrong-shaped value as no customization", () => {
    const bad = (v: unknown) => readSidebarGroups(withGroups(v));
    expect(bad("banana")).toEqual({ version: 2 });
    expect(bad(42)).toEqual({ version: 2 });
    expect(bad(["a", "b"])).toEqual({ version: 2 });
  });
});

describe("salvageSidebarGroups records every drop so doctor can name it", () => {
  it("records a scalar-instead-of-list as malformed (the realistic typo)", () => {
    // @verifies SHL-45 — a user writes a single id as a scalar
    const r = salvageSidebarGroups({ version: 2, order: ["layouts"], hidden: "sprints" });
    expect(r.groups).toEqual({ version: 2, order: ["layouts"] });
    expect(r.dropped).toContainEqual({ list: "hidden", id: expect.any(String), reason: "malformed" });
  });

  it("records a non-string element as malformed rather than skipping it", () => {
    // @verifies SHL-45
    const r = salvageSidebarGroups({ version: 2, hidden: [42, "labels"] });
    expect(r.groups).toEqual({ version: 2, hidden: ["labels"] });
    expect(r.dropped).toContainEqual({ list: "hidden", id: "42", reason: "malformed" });
  });

  it("records a stray/typo'd key so the ids under it are not lost silently", () => {
    // @verifies SHL-45 — `hiden` instead of `hidden`
    const r = salvageSidebarGroups({ version: 2, order: ["layouts"], hiden: ["sprints"] });
    expect(r.groups).toEqual({ version: 2, order: ["layouts"] });
    expect(r.dropped.some(d => d.reason === "malformed" && d.id.includes("hiden"))).toBe(true);
  });

  it("K158: an empty `view:` id and a pre-K158 id in a K158 value are unknown", () => {
    // @verifies SHL-54
    const r = salvageSidebarGroups({ version: 2, order: ["views", "view:", "saved-filters", "view:bugs"] });
    expect(r.groups).toEqual({ version: 2, order: ["views", "view:bugs"] });
    expect(r.dropped.map(d => [d.id, d.reason])).toEqual([["view:", "unknown"], ["saved-filters", "unknown"]]);
  });

  it("K158: a version this build does not know is reported, and the ids still load", () => {
    // @verifies SHL-54
    const r = salvageSidebarGroups({ version: 9, order: ["labels"] });
    expect(r.groups).toEqual({ version: 2, order: ["labels"] });
    expect(r.dropped).toContainEqual({ list: "order", id: "version 9", reason: "malformed" });
  });

  it("K160: a value without `version` (the pre-K158 layout) is ignored whole and flagged, not salvaged per id", () => {
    // @verifies SHL-54 — after the 0.3.0 → 0.4.0 step the reader knows
    // only the K158 shape; an old one reads as the default layout.
    const r = salvageSidebarGroups({ order: ["saved-filters", "filters", "labels"], hidden: ["views"] });
    expect(r.groups).toEqual({ version: 2 });
    expect(r.olderLayout).toBe(true);
    expect(r.wholeValueDropped).toBe(false);
    expect(r.dropped).toEqual([]);
    // Even one made only of K158 ids: without `version: 2` it is not K158.
    expect(salvageSidebarGroups({ order: ["labels"] })).toMatchObject({ groups: { version: 2 }, olderLayout: true });
    expect(salvageSidebarGroups({})).toMatchObject({ groups: { version: 2 }, olderLayout: true });
    // A K158 value is not flagged.
    expect(salvageSidebarGroups({ version: 2, order: ["labels"] }).olderLayout).toBe(false);
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
    expect(new Set(resolved.map(r => r.id))).toEqual(new Set(CATALOG));
  });

  it("marks hidden ids without removing them from the list", () => {
    // @verifies SHL-45 — hidden groups are absent from the render but remembered
    const resolved = resolveSidebarOrder({ hidden: ["sprints", "recents"] }, CATALOG);
    expect(resolved.filter(r => r.hidden).map(r => r.id)).toEqual(["sprints", "recents"]);
    expect(resolved).toHaveLength(CATALOG.length);
  });
});

/** @verifies SHL-50 (K158: one Views group, built-in and saved views in one ordered, hideable list) */
describe("resolveSidebarLayout (K158)", () => {
  it("default: layouts, projects, views, ...; the Views children are the built-ins then the saved views", () => {
    expect(topIds({})).toEqual(["layouts", "projects", "views", "milestones", "sprints", "labels", "recents"]);
    expect(childIds({})).toEqual([...BUILTINS, "view:bugs", "view:mine"]);
  });

  it("interleaves built-in and saved views in their stored relative order", () => {
    const order = ["view:mine", "overdue", "view:bugs", "assigned-to-me"];
    expect(childIds({ order }).slice(0, 4)).toEqual(order);
  });

  it("a new saved view (not in the stored order) appends after every placed and default child", () => {
    const groups = { order: ["views", ...BUILTINS, "view:bugs", "view:mine"] };
    const withNew = [...VIEWS, { id: "fresh", name: "Fresh", broken: false }];
    expect(childIds(groups, withNew).at(-1)).toBe("view:fresh");
  });

  it("a deleted saved view drops out of the order (its stored id is skipped)", () => {
    const groups = { order: ["view:gone", "view:bugs"], hidden: ["view:gone"] };
    expect(childIds(groups)).not.toContain("view:gone");
    expect(childIds(groups)[0]).toBe("view:bugs");
  });

  it("carries each saved view's name and broken flag", () => {
    const views = [{ id: "bad", name: "Bad view", broken: true }];
    const row = resolveSidebarLayout({}, views).find(r => r.kind === "views");
    const saved = row?.kind === "views" ? row.children.find(c => c.kind === "saved") : undefined;
    expect(saved).toEqual({ kind: "saved", id: "view:bad", viewId: "bad", name: "Bad view", broken: true, hidden: false });
  });

  it("round-trips: the value written from a layout resolves to the same layout", () => {
    const groups = { order: ["labels", "views", "view:mine", "overdue"], hidden: ["view:bugs", "sprints"] };
    const rows = resolveSidebarLayout(groups, VIEWS);
    expect(resolveSidebarLayout(sidebarGroupsFromLayout(rows), VIEWS)).toEqual(rows);
  });

  it("setSidebarItemHidden sets one item's own flag and leaves the order alone", () => {
    const groups: SidebarGroups = { version: 2, order: ["views", "view:bugs"], hidden: ["sprints"] };
    expect(setSidebarItemHidden(groups, "view:bugs", true)).toEqual({
      version: 2, order: ["views", "view:bugs"], hidden: ["sprints", "view:bugs"],
    });
    expect(setSidebarItemHidden({ version: 2, hidden: ["overdue"] }, "overdue", false)).toEqual({ version: 2 });
  });
});

describe("sidebarSavedViews (the default order a saved view takes)", () => {
  it("queries.yaml order, then broken; archived excluded", () => {
    const list = sidebarSavedViews(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C", archived: true },
        { id: "d", name: "D" },
      ],
      [{ id: "x", name: "X" }],
    );
    expect(list.map(v => [v.id, v.broken])).toEqual([["a", false], ["b", false], ["d", false], ["x", true]]);
  });
});

describe("validateSidebarIds (write paths)", () => {
  it("accepts group, built-in and existing saved-view ids; refuses the rest, naming them", () => {
    const r = validateSidebarIds(["views", "overdue", "view:bugs", "view:nope", "saved-filters", "layouts", "layouts"], VIEWS);
    expect(r.known).toEqual(["views", "overdue", "view:bugs", "layouts"]);
    expect(r.unknown).toEqual(["view:nope", "saved-filters"]);
  });
});

describe("resolveRenderedSidebarItems (A346, K158: the CLI/MCP read-back)", () => {
  it("lists every group once, with the Views children straight after `views`", () => {
    const items = resolveRenderedSidebarItems({ order: ["view:mine", "overdue", "projects"] }, VIEWS);
    expect(items.map(i => i.id)).toEqual([
      "projects", "layouts", "views",
      "view:mine", "overdue", "assigned-to-me", "reported-by-me", "mentions-me",
      "due-this-week", "high-priority", "view:bugs",
      "milestones", "sprints", "labels", "recents",
    ]);
    expect(items.find(i => i.id === "view:mine")?.name).toBe("Mine");
  });

  it("marks every child hidden while the Views group is hidden, and only then", () => {
    const hiddenGroup = resolveRenderedSidebarItems({ hidden: ["views"] }, VIEWS);
    expect(hiddenGroup.filter(i => i.hidden)).toHaveLength(1 + BUILTINS.length + VIEWS.length);
    const one = resolveRenderedSidebarItems({ hidden: ["view:bugs"] }, VIEWS);
    expect(one.filter(i => i.hidden).map(i => i.id)).toEqual(["view:bugs"]);
  });

  it("flags a broken saved view", () => {
    const items = resolveRenderedSidebarItems({}, [{ id: "bad", name: "Bad", broken: true }]);
    expect(items.find(i => i.id === "view:bad")).toEqual({ id: "view:bad", hidden: false, name: "Bad", broken: true });
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

  it("saves and reloads a K158 sidebar_groups setting intact", async () => {
    // @verifies SHL-45 — the setting persists per-user
    await saveUserSettings(locttDir, USER_ID, {
      sidebar_groups: { version: 2, order: ["labels", "view:bugs"], hidden: ["sprints"] },
    } as UserSettings);
    const reloaded = await loadUserSettings(locttDir, USER_ID);
    expect(readSidebarGroups(reloaded)).toEqual({
      version: 2,
      order: ["labels", "view:bugs"],
      hidden: ["sprints"],
    });
  });

  it("K160: a pre-K158 value on disk loads as the default layout, and the other settings still load", async () => {
    // @verifies SHL-54 — the upgrade step converts it; one left after
    // that is corrupt (field-local: only the layout falls back).
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "theme: dark\nsidebar_groups:\n  order: [filters, saved-filters]\n  hidden: [views]\n", "utf-8");
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.theme).toBe("dark");
    expect(settings.sidebar_groups).toBeUndefined();
    expect(readSidebarGroups(settings)).toEqual({ version: 2 });
    expect(topIds(readSidebarGroups(settings))).toEqual([...SIDEBAR_GROUP_IDS]);
  });

  it("salvages a hand-corrupted sidebar_groups per-field without locking the file", async () => {
    // @verifies SHL-45 — a bad group id degrades ONE entry, valid ids
    // survive, and other settings load (P7).
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      "theme: dark\nsidebar_groups:\n  version: 2\n  order: [labels, bogus, labels, projects]\n",
      "utf-8",
    );
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.theme).toBe("dark");
    expect(readSidebarGroups(settings)).toEqual({ version: 2, order: ["labels", "projects"] });
  });

  it("degrades a wholly-unshaped sidebar_groups to default (nothing to salvage)", async () => {
    // @verifies SHL-45
    const path = getUserSettingsPath(locttDir, USER_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "theme: dark\nsidebar_groups: banana\n", "utf-8");
    const settings = await loadUserSettings(locttDir, USER_ID);
    expect(settings.theme).toBe("dark");
    expect(readSidebarGroups(settings)).toEqual({ version: 2 });
  });
});

describe("sidebarGroupsFromLayout keeps what the layout cannot show (K158)", () => {
  it("keeps an archived view's place and hidden flag when the panel rewrites the order", () => {
    const previous = { order: ["views", "view:archived", "view:bugs"], hidden: ["view:archived"] };
    const rows = resolveSidebarLayout(previous, VIEWS);
    const next = sidebarGroupsFromLayout(rows, previous);
    expect(next.order).toContain("view:archived");
    expect(next.hidden).toEqual(["view:archived"]);
  });

  it("forgetSavedViewInSidebar drops a deleted view from order and hidden", () => {
    expect(forgetSavedViewInSidebar({ version: 2, order: ["view:bugs", "labels"], hidden: ["view:bugs"] }, "bugs"))
      .toEqual({ version: 2, order: ["labels"] });
  });
});

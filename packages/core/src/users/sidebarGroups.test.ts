import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SidebarGroups, UserSettings } from "@loctt/contracts";
import { SIDEBAR_GROUP_IDS, SIDEBAR_ITEM_IDS } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserSettingsPath } from "../paths/index.js";
import { loadUserSettings, saveUserSettings } from "./settings.js";
import {
  readSidebarGroups,
  resolveGroupedSidebarOrder,
  resolveRenderedSidebarItems,
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

/**
 * @verifies SHL-45 (K125: built-in filters nest under one "Filters" group)
 *
 * Ken: "Nest under 'Filters'" — the six `SIDEBAR_FILTER_IDS` collapse
 * into one reorderable/hideable row in the Customize-sidebar panel,
 * each still individually reorderable/hideable INSIDE it. Recorded as
 * A339: an existing flat stored order (from before this ticket, when a
 * filter id could only ever be a top-level entry) must still load —
 * the migrated group's position is the position of the FIRST filter id
 * in that stored order, with the filters' own inner order/hidden flags
 * preserved untouched.
 */
describe("resolveGroupedSidebarOrder (K125 nesting + migration)", () => {
  const GROUP_CATALOG = [...SIDEBAR_GROUP_IDS];

  it("places 'filters' at its default catalog slot for an empty setting", () => {
    const rows = resolveGroupedSidebarOrder({}, GROUP_CATALOG);
    const idx = rows.findIndex(r => r.kind === "filters-group");
    // Default catalog order: views, projects, saved-filters, filters, …
    expect(idx).toBe(3);
    const group = rows[idx];
    expect(group?.kind).toBe("filters-group");
    if (group?.kind === "filters-group") {
      expect(group.hidden).toBe(false);
      expect(group.children.map(c => c.id)).toEqual([
        "assigned-to-me", "reported-by-me", "mentions-me",
        "due-this-week", "overdue", "high-priority",
      ]);
      expect(group.children.every(c => !c.hidden)).toBe(true);
    }
  });

  it("MIGRATION: an existing flat order with a filter id first places the group there, keeping inner order/hidden", () => {
    // Pre-K125 stored shape: a user reordered "overdue" to the very top
    // and hid "high-priority" — both individual-filter operations, the
    // only kind that existed before this ticket.
    const stored: SidebarGroups = {
      order: ["overdue", "projects", "labels"],
      hidden: ["high-priority"],
    };
    const rows = resolveGroupedSidebarOrder(stored, GROUP_CATALOG);
    // The group is spliced in at "overdue"'s old position: index 0.
    expect(rows[0]?.kind).toBe("filters-group");
    const group = rows[0];
    if (group?.kind === "filters-group") {
      // "overdue" led the flat order among the filters, so it leads the
      // group's own inner order too (resolveSidebarOrder's normal rule
      // over the filter-only catalog) — inner order is untouched by the
      // migration, only the group's OWN position is inferred.
      expect(group.children[0]?.id).toBe("overdue");
      expect(group.children.find(c => c.id === "high-priority")?.hidden).toBe(true);
      expect(group.children.find(c => c.id === "overdue")?.hidden).toBe(false);
    }
    // "projects" and "labels" still resolve, in their stored order,
    // after the group.
    const topIds = rows.map(r => r.kind === "item" ? r.id : "filters");
    expect(topIds.indexOf("projects")).toBeGreaterThan(0);
    expect(topIds.indexOf("labels")).toBeGreaterThan(topIds.indexOf("projects"));
  });

  it("MIGRATION: a flat order with no filter id at all falls back to the group's default catalog slot", () => {
    const stored: SidebarGroups = { order: ["labels", "projects"] };
    const rows = resolveGroupedSidebarOrder(stored, GROUP_CATALOG);
    expect(rows[0]?.kind).toBe("item");
    expect(rows[1]?.kind).toBe("item");
    // labels, projects lead (as stored); filters and the rest of the
    // catalog follow in default order after them.
    const topIds = rows.map(r => r.kind === "item" ? r.id : "filters");
    expect(topIds.slice(0, 2)).toEqual(["labels", "projects"]);
    expect(topIds).toContain("filters");
  });

  it("honors an explicit post-migration 'filters' placement in the stored order", () => {
    // A fresh save made AFTER this ticket ships: the user explicitly
    // ordered the Filters group third, after projects and labels.
    const stored: SidebarGroups = { order: ["projects", "labels", "filters"] };
    const rows = resolveGroupedSidebarOrder(stored, GROUP_CATALOG);
    const topIds = rows.map(r => r.kind === "item" ? r.id : "filters");
    expect(topIds.slice(0, 3)).toEqual(["projects", "labels", "filters"]);
  });

  it("hiding the 'filters' group is independent of each child's own hidden flag", () => {
    const stored: SidebarGroups = { hidden: ["filters"] };
    const rows = resolveGroupedSidebarOrder(stored, GROUP_CATALOG);
    const group = rows.find(r => r.kind === "filters-group");
    expect(group?.hidden).toBe(true);
    if (group?.kind === "filters-group") {
      // Children keep their OWN hidden flags (all visible here) — the
      // group's hidden state is a separate signal a renderer ANDs in,
      // not something that mutates the children's stored flags.
      expect(group.children.every(c => !c.hidden)).toBe(true);
    }
  });

  it("a top-level filter id in the stored order never produces a second top-level row for it", () => {
    // Regression guard for the migration: after splicing the group in,
    // the original filter id must not ALSO still occupy a top-level
    // slot (it would render both nested AND as a phantom top-level row).
    const stored: SidebarGroups = { order: ["overdue", "projects"] };
    const rows = resolveGroupedSidebarOrder(stored, GROUP_CATALOG);
    const topLevelFilterRow = rows.find(r => r.kind === "item" && (r.id as string) === "overdue");
    expect(topLevelFilterRow).toBeUndefined();
  });
});

describe("resolveRenderedSidebarItems (A346: the CLI/MCP read-back)", () => {
  it("lists every item id once, in the order the grouped sidebar renders", () => {
    const items = resolveRenderedSidebarItems({ order: ["overdue", "projects"] });
    expect(items.map(i => i.id)).toEqual([
      "filters", "overdue", "assigned-to-me", "reported-by-me", "mentions-me",
      "due-this-week", "high-priority",
      "projects", "views", "saved-filters", "milestones", "sprints", "labels", "recents",
    ]);
    expect(new Set(items.map(i => i.id))).toEqual(new Set(SIDEBAR_ITEM_IDS));
  });

  it("marks every built-in hidden while the filters group is hidden, and only then", () => {
    const hiddenGroup = resolveRenderedSidebarItems({ hidden: ["filters"] });
    expect(hiddenGroup.filter(i => i.hidden).map(i => i.id).sort()).toEqual([
      "assigned-to-me", "due-this-week", "filters", "high-priority",
      "mentions-me", "overdue", "reported-by-me",
    ]);
    const oneFilter = resolveRenderedSidebarItems({ hidden: ["overdue"] });
    expect(oneFilter.filter(i => i.hidden).map(i => i.id)).toEqual(["overdue"]);
  });
});

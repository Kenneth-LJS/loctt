/**
 * The 0.3.0 → 0.4.0 upgrade (K160): every user's `settings.yaml` moves
 * to the K158 Views layout, the retired `sidebar_pins` seeding the saved
 * views' order, and the old keys go. Run on the frozen 0.3.0 seed
 * (`tests/fixtures/trackers/seed-0.3.0`), whose user settings live beside
 * it in `user-settings/` (a tracker's `.gitignore` ignores
 * `users/*\/settings.yaml`, so they cannot be checked in under `.loctt/`).
 *
 * The expected layouts are written out here from B52's rule (A370 item
 * 2) and A371's pin seeding, by hand for the fixture, so the step cannot
 * vouch for itself.
 *
 * Converted from B52/B53's read-time tests (`users/sidebarGroups.test.ts`
 * "migrateLegacySidebarGroups (K158)"): the same cases, now against the
 * step's conversion (`convertOlderLayout`).
 *
 * @verifies SHL-54
 * @verifies ONB-C23
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SidebarGroups } from "@loctt/contracts";
import { SIDEBAR_BUILTIN_VIEW_IDS } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { checkDataIntegrity } from "../diagnostics/integrity.js";
import { loadUserSettings } from "../users/settings.js";
import {
  readSidebarGroups,
  resolveRenderedSidebarItems,
  resolveSidebarLayout,
  type SidebarOrderInput,
  type SidebarSavedView,
} from "../users/sidebarGroups.js";
import { loadSidebarSavedViews } from "../users/sidebarViews.js";
import { migrateToCurrent, planMigration } from "./migrate.js";
import {
  convertOlderLayout,
  convertSettingsText,
  moveSidebarSettingsToViewsLayout,
  pinnedFirst,
} from "./steps/sidebar-views-layout.js";
import { CURRENT_SCHEMA_VERSION } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "../../../../tests/fixtures/trackers");
const FROZEN_030 = join(FIXTURES, "seed-0.3.0");
const FROZEN_010 = join(FIXTURES, "seed-0.1.0");

const ADA = "01M3JSJ5SC2X6K2GXCM8DDY4C3";   // pre-K158 layout + pins
const BEA = "01M3JSJ6CXR6KBVE6HJQ1BDAN5";   // pins only, no sidebar_groups
const CAL = "01M3JSJ6P7SE9KVFDFKMHSTS3K";   // neither key
const RECENT = "view:01M3JSJ5RT26R3NG7G9TXP3F56";
const BUGS = "view:01M3JSKF7FX68V26D9GDQ768F9";
const HOT = "view:01M3JSKFGY2KVS3DFF1TVEKWWY";
const BUILTINS = [...SIDEBAR_BUILTIN_VIEW_IDS];

let root: string;
let locttDir: string;

/** A fresh copy of a frozen seed, with its user settings installed. */
async function copyFrozen(fixture: string): Promise<void> {
  await cp(join(fixture, ".loctt"), locttDir, { recursive: true });
  const settingsDir = join(fixture, "user-settings");
  let files: string[] = [];
  try {
    files = await readdir(settingsDir);
  } catch {
    return;
  }
  for (const f of files) {
    const target = join(locttDir, "users", f.replace(/\.yaml$/, ""), "settings.yaml");
    await mkdir(dirname(target), { recursive: true });
    await cp(join(settingsDir, f), target);
  }
}

function settingsPath(userId: string): string {
  return join(locttDir, "users", userId, "settings.yaml");
}

async function rawSettings(userId: string): Promise<Record<string, unknown>> {
  return parseYaml(await readFile(settingsPath(userId), "utf-8")) as Record<string, unknown>;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-upgrade-040-"));
  locttDir = join(root, ".loctt");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("0.3.0 → 0.4.0 on the frozen 0.3.0 seed", () => {
  beforeEach(async () => { await copyFrozen(FROZEN_030); });

  it("the preview lists the one step, described in plain words, not risky", async () => {
    const plan = await planMigration(locttDir);
    expect(plan.from).toBe("0.3.0");
    expect(plan.to).toBe("0.4.0");
    expect(plan.steps.map(s => `${s.from}->${s.to}`)).toEqual(["0.3.0->0.4.0"]);
    expect(plan.steps[0]?.description).toBe("Move sidebar settings to the Views layout");
    expect(plan.steps[0]?.risky).toBeUndefined();
  });

  it("converts a pre-K158 layout exactly by B52's rule, pins leading the saved views, and deletes the old keys", async () => {
    const result = await migrateToCurrent(locttDir);
    expect(result.to).toBe("0.4.0");
    const ada = await rawSettings(ADA);
    // Filters sat first, so the one Views group takes its place, the
    // built-ins leading in their stored order (overdue, assigned-to-me,
    // then the rest). Saved views follow: the pinned Hot list first (the
    // pin naming a missing view is skipped), then queries.yaml order.
    // The old `views` switcher becomes `layouts` at its place.
    expect(ada["sidebar_groups"]).toEqual({
      version: 2,
      order: [
        "views",
        "overdue", "assigned-to-me", "reported-by-me", "mentions-me", "due-this-week", "high-priority",
        HOT, RECENT, BUGS,
        "projects", "layouts", "milestones", "sprints", "labels", "recents",
      ],
      // The hidden Saved views group hid each saved view (Filters was not
      // hidden, so Views is not); high-priority keeps its own flag.
      hidden: ["high-priority", HOT, RECENT, BUGS],
    });
    expect(ada).not.toHaveProperty("sidebar_pins");
    // Every other key is untouched, and so is the file's comment.
    expect(ada["theme"]).toBe("dark");
    expect(ada["experimental_flag"]).toBe("keep-me");
    expect(await readFile(settingsPath(ADA), "utf-8")).toMatch(/^# Written by loctt 0\.3\.0/);
  });

  it("A371 item 4 (review M1): pins with no sidebar_groups are read as an empty pre-K158 value", async () => {
    await migrateToCurrent(locttDir);
    const bea = await rawSettings(BEA);
    // The default pre-K158 order had Saved views above Filters: the saved
    // views lead, the pinned Open bugs first.
    expect(bea["sidebar_groups"]).toEqual({
      version: 2,
      order: ["layouts", "projects", "views", BUGS, RECENT, HOT, ...BUILTINS, "milestones", "sprints", "labels", "recents"],
    });
    expect(bea).not.toHaveProperty("sidebar_pins");
    expect(bea["editor_mode"]).toBe("source");
  });

  it("leaves a file with neither key byte for byte", async () => {
    const before = await readFile(settingsPath(CAL), "utf-8");
    await migrateToCurrent(locttDir);
    expect(await readFile(settingsPath(CAL), "utf-8")).toBe(before);
  });

  it("the converted layout reads back through the K158 reader as the sidebar the user had", async () => {
    await migrateToCurrent(locttDir);
    const views = await loadSidebarSavedViews(locttDir);
    const items = resolveRenderedSidebarItems(readSidebarGroups(await loadUserSettings(locttDir, ADA)), views);
    expect(items.map(i => i.id).slice(0, 4)).toEqual(["views", "overdue", "assigned-to-me", "reported-by-me"]);
    expect(items.filter(i => i.hidden).map(i => i.id)).toEqual(["high-priority", HOT, RECENT, BUGS]);
    // And doctor has nothing to say about any settings file.
    const findings = (await checkDataIntegrity(locttDir)).filter(f => f.path.includes("settings.yaml"));
    expect(findings).toEqual([]);
  });

  it("is idempotent: a second run of the step changes no file", async () => {
    await migrateToCurrent(locttDir);
    const snapshot = await Promise.all([ADA, BEA, CAL].map(id => readFile(settingsPath(id), "utf-8")));
    await moveSidebarSettingsToViewsLayout(locttDir);
    const again = await Promise.all([ADA, BEA, CAL].map(id => readFile(settingsPath(id), "utf-8")));
    expect(again).toEqual(snapshot);
  });

  it("leaves a corrupt or unreadable settings file as it is, and doctor reports it", async () => {
    const corrupt = "01HCCCCCCCCCCCCCCCCCCCCCCC";
    const broken = "01HBBBBBBBBBBBBBBBBBBBBBBB";
    const files: Record<string, string> = {
      // A pre-K158 value with an id it never had: converting it would
      // silently rewrite the corruption, so neither key is touched.
      [corrupt]: "sidebar_groups:\n  order: [filters, bogus]\nsidebar_pins: [x]\n",
      [broken]: "theme: [dark\nsidebar_pins: [x]\n",
    };
    for (const [id, text] of Object.entries(files)) {
      await mkdir(join(locttDir, "users", id), { recursive: true });
      await writeFile(join(locttDir, "users", id, "profile.yaml"), `id: ${id}\nname: X\n`, "utf-8");
      await writeFile(settingsPath(id), text, "utf-8");
    }
    await migrateToCurrent(locttDir);
    for (const [id, text] of Object.entries(files)) {
      expect(await readFile(settingsPath(id), "utf-8")).toBe(text);
    }
    const findings = await checkDataIntegrity(locttDir);
    const about = (id: string) => findings.filter(f => f.path === settingsPath(id)).map(f => f.message);
    expect(about(corrupt).some(m => /"sidebar_groups" is in the layout loctt wrote before 0\.4\.0/.test(m))).toBe(true);
    expect(about(corrupt).some(m => /"sidebar_pins" is no longer used/.test(m))).toBe(true);
    expect(about(broken).some(m => /could not be read/.test(m))).toBe(true);
    // The good files were still converted.
    expect(await rawSettings(ADA)).not.toHaveProperty("sidebar_pins");
  });
});

describe("the chain 0.1.0 → 0.3.0 → 0.4.0 in one migrate", () => {
  beforeEach(async () => { await copyFrozen(FROZEN_010); });

  it("previews both steps and runs both, stamping 0.4.0", async () => {
    // A 0.1.0 tracker's users could have pre-K158 settings too.
    await mkdir(join(locttDir, "users", ADA), { recursive: true });
    await writeFile(settingsPath(ADA), "sidebar_groups:\n  hidden: [saved-filters]\nsidebar_pins: [01M3JSKFGY2KVS3DFF1TVEKWWY]\n", "utf-8");
    const plan = await planMigration(locttDir);
    expect(plan.steps.map(s => `${s.from}->${s.to}`)).toEqual(["0.1.0->0.3.0", "0.3.0->0.4.0"]);
    const result = await migrateToCurrent(locttDir);
    expect(result.from).toBe("0.1.0");
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.steps.map(s => `${s.from}->${s.to}`)).toEqual(["0.1.0->0.3.0", "0.3.0->0.4.0"]);
    expect((await readFile(join(locttDir, ".schema-version"), "utf-8")).trim()).toBe("0.4.0");
    const ada = await rawSettings(ADA);
    expect(ada).not.toHaveProperty("sidebar_pins");
    expect((ada["sidebar_groups"] as SidebarGroups).order?.slice(2, 4)).toEqual(["views", HOT]);
  });
});

// ── The conversion rule itself (B52/A370 item 2; were read-time tests) ──

const VIEWS: readonly SidebarSavedView[] = [
  { id: "bugs", name: "Open bugs", broken: false },
  { id: "mine", name: "Mine", broken: false },
];

function childIds(groups: SidebarOrderInput): string[] {
  const row = resolveSidebarLayout(groups, VIEWS).find(r => r.kind === "views");
  return row?.kind === "views" ? row.children.map(c => c.id) : [];
}
function topIds(groups: SidebarOrderInput): string[] {
  return resolveSidebarLayout(groups, VIEWS).map(r => (r.kind === "views" ? "views" : r.id));
}
const convert = (older: Parameters<typeof convertOlderLayout>[0], views = VIEWS) => convertOlderLayout(older, views);

describe("convertOlderLayout (B52's rule, A370 item 2)", () => {
  it("an empty value: Views takes the Saved views slot, and the saved views lead (they rendered above Filters)", () => {
    const g = convert({});
    expect(topIds(g)).toEqual(["layouts", "projects", "views", "milestones", "sprints", "labels", "recents"]);
    expect(childIds(g)).toEqual(["view:bugs", "view:mine", ...BUILTINS]);
  });

  it("renames the switcher: `views` (List/Board/Timeline) becomes `layouts`, same place, same hidden flag", () => {
    const g = convert({ order: ["labels", "views"], hidden: ["views"] });
    expect(topIds(g).slice(0, 2)).toEqual(["labels", "layouts"]);
    expect(g.hidden).toContain("layouts");
    expect(g.hidden).not.toContain("views");
  });

  it("places Views where the EARLIER of Filters and Saved views sat, built-ins leading when Filters came first", () => {
    const g = convert({ order: ["filters", "projects", "saved-filters"] });
    expect(topIds(g).slice(0, 2)).toEqual(["views", "projects"]);
    expect(childIds(g)).toEqual([...BUILTINS, "view:bugs", "view:mine"]);
  });

  it("keeps the built-ins' own stored order and hidden flags", () => {
    const g = convert({ order: ["overdue", "assigned-to-me", "filters"], hidden: ["high-priority"] });
    expect(childIds(g).slice(0, 2)).toEqual(["overdue", "assigned-to-me"]);
    expect(g.hidden).toEqual(["high-priority"]);
  });

  it("a hidden Filters group hides each built-in, and the saved views stay visible", () => {
    const items = resolveRenderedSidebarItems(convert({ hidden: ["filters"] }), VIEWS);
    expect(items.find(i => i.id === "views")?.hidden).toBe(false);
    expect(items.filter(i => i.hidden).map(i => i.id).sort()).toEqual([...BUILTINS].sort());
  });

  it("a hidden Saved views group hides each saved view, and the built-ins stay visible", () => {
    const items = resolveRenderedSidebarItems(convert({ hidden: ["saved-filters"] }), VIEWS);
    expect(items.filter(i => i.hidden).map(i => i.id)).toEqual(["view:bugs", "view:mine"]);
  });

  it("both hidden: the Views group is hidden, and each built-in keeps only its own flag", () => {
    expect(convert({ hidden: ["filters", "saved-filters", "overdue"] }).hidden).toEqual(["views", "overdue"]);
  });

  it("the pre-K125 flat order (a built-in id at the top level, no `filters`) still places Views there (A339)", () => {
    const g = convert({ order: ["overdue", "projects", "labels", "saved-filters"] });
    expect(topIds(g).slice(0, 3)).toEqual(["views", "projects", "labels"]);
    expect(childIds(g)[0]).toBe("overdue");
  });

  it("is written in the K158 shape and reads back unchanged", () => {
    const g = convert({ order: ["saved-filters", "filters"] });
    expect(g.version).toBe(2);
    expect(readSidebarGroups({ sidebar_groups: g })).toEqual(g);
  });
});

describe("pins seed the saved views (A371 items 1 and 5)", () => {
  const views: readonly SidebarSavedView[] = [
    { id: "a", name: "A", broken: false },
    { id: "b", name: "B", broken: false },
    { id: "c", name: "C", broken: false },
    { id: "x", name: "X", broken: true },
  ];

  it("pinned first in pin order; a missing, archived (unlisted) or broken pin is skipped; duplicates fold", () => {
    expect(pinnedFirst(views, ["c", "gone", "x", "c", "a"]).map(v => v.id)).toEqual(["c", "a", "b", "x"]);
    expect(pinnedFirst(views, []).map(v => v.id)).toEqual(["a", "b", "c", "x"]);
  });

  it("a K158 value ignores pins, which are only deleted", async () => {
    const out = await convertSettingsText(
      "sidebar_groups:\n  version: 2\n  order: [labels]\nsidebar_pins: [b]\n",
      () => Promise.resolve(views),
    );
    expect(parseYaml(out ?? "")).toEqual({ sidebar_groups: { version: 2, order: ["labels"] } });
  });

  it("a pins value that is not a list reads as no pins, and is deleted", async () => {
    const out = await convertSettingsText("sidebar_pins: b\n", () => Promise.resolve(views));
    const groups = (parseYaml(out ?? "") as { sidebar_groups: SidebarGroups }).sidebar_groups;
    expect(groups.order?.slice(3, 6)).toEqual(["view:a", "view:b", "view:c"]);
  });

  it("leaves the file when the saved views cannot be read and the conversion needs them", async () => {
    expect(await convertSettingsText("sidebar_groups: {}\nsidebar_pins: [a]\n", () => Promise.resolve(null))).toBeNull();
    // A K158 value needs no saved views: its pins are still deleted.
    expect(await convertSettingsText("sidebar_groups: {version: 2}\nsidebar_pins: [a]\n", () => Promise.resolve(null)))
      .not.toContain("sidebar_pins");
  });
});

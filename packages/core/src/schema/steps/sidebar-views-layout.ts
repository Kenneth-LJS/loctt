import { readdir, readFile } from "node:fs/promises";

import type {
  SidebarBuiltinViewId,
  SidebarGroupId,
  SidebarGroups,
  SidebarItemId,
} from "@loctt/contracts";
import {
  savedViewSidebarId,
  SIDEBAR_BUILTIN_VIEW_IDS,
  SIDEBAR_GROUPS_VERSION,
} from "@loctt/contracts";
import { isMap, parseDocument } from "yaml";
import { z } from "zod";

import { loadQueriesConfig } from "../../config/queries.js";
import { getUsersDir, getUserSettingsPath } from "../../paths/index.js";
import {
  resolveSidebarOrder,
  type SidebarSavedView,
  sidebarSavedViews,
} from "../../users/sidebarGroups.js";
import { writeFileAtomically } from "../../utils/atomic-yaml.js";
import { fileExists } from "../../utils/fs.js";
import { isMissingFile } from "../../utils/read-state.js";

/**
 * The 0.3.0 → 0.4.0 upgrade step (K160): every user's `settings.yaml`
 * moves to the K158 Views layout, and the retired `sidebar_pins` goes.
 *
 * Before K158 the sidebar had a "Saved views" section and a "Filters"
 * section (the built-in views), and `sidebar_groups` ordered and hid
 * them as groups, with `views` naming the List / Board / Timeline
 * switcher. Saved views were ordered by `sidebar_pins` (pinned first,
 * then `queries.yaml` order). K158 made one Views group; K159 retired
 * pins. B52/B53 converted an old value every time it was read; K160
 * (Ken: *"i dont want to support this backward compatibility forever"*)
 * replaces that with this one step.
 *
 * ## Per settings file
 *
 * - `sidebar_groups` without `version` (the pre-K158 shape), clean:
 *   converted by B52's rule (A370 item 2, {@link convertOlderLayout}),
 *   the saved views taking `sidebar_pins` order first (A371 item 5).
 * - No `sidebar_groups`, but a `sidebar_pins` key: read as an empty
 *   pre-K158 value, so the pins still order the saved views (A371 item
 *   4; closes the review's M1).
 * - `sidebar_groups` with a `version` (already K158, or a version this
 *   build does not know): left as it is; the reader handles it.
 * - `sidebar_pins` is then deleted. Every other key, comment and line is
 *   left as it was (the YAML document is edited, not re-serialized).
 * - Neither key: nothing to do, the file is not written.
 *
 * The saved views are the tracker's `queries.yaml` at the time of the
 * step: archived views are not listed (they were not in the sidebar), a
 * view whose filters no longer load is listed last (VUE-22).
 *
 * ## What is left as it is
 *
 * Never deleted, never guessed at (corruption guide rule 3: refuse
 * rather than approximate): a settings file that cannot be read, does
 * not parse as YAML or is not a mapping; a pre-K158 `sidebar_groups`
 * that is not clean (an unknown id, a duplicate, a stray key, a value
 * that is not an object), since converting it would silently rewrite
 * the corruption; and, when `queries.yaml` cannot be read, any file
 * whose conversion needs the saved views. Doctor reports each after the
 * upgrade: an unreadable file, a `sidebar_groups` in the older layout,
 * a stray `sidebar_pins`, a `queries.yaml` that does not load.
 *
 * Idempotent: after one run no file holds an older layout it can
 * convert or a `sidebar_pins` key it can delete, so a second run
 * writes nothing.
 */
export async function moveSidebarSettingsToViewsLayout(locttDir: string): Promise<void> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return;
  let savedViews: readonly SidebarSavedView[] | null | undefined;
  const loadViews = async (): Promise<readonly SidebarSavedView[] | null> => {
    if (savedViews === undefined) savedViews = await loadSavedViews(locttDir);
    return savedViews;
  };
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = getUserSettingsPath(locttDir, entry.name);
    if (!(await fileExists(path))) continue;
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    const next = await convertSettingsText(raw, loadViews);
    if (next !== null) await writeFileAtomically(path, next);
  }
}

/**
 * One settings file's text after the step, or null when it is left as it
 * is (nothing to convert, or it cannot be converted faithfully).
 * `savedViews` is called only when a conversion needs them, and returns
 * null when they cannot be read.
 */
export async function convertSettingsText(
  raw: string,
  savedViews: () => Promise<readonly SidebarSavedView[] | null>,
): Promise<string | null> {
  if (raw.trim() === "") return null;
  const doc = parseDocument(raw);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return null;
  const hasGroups = doc.has("sidebar_groups");
  const hasPins = doc.has("sidebar_pins");
  if (!hasGroups && !hasPins) return null;

  const js = doc.toJS() as Record<string, unknown>;
  const groups: unknown = hasGroups ? js["sidebar_groups"] : undefined;
  let older: OlderSidebarGroups | undefined;
  if (!hasGroups) {
    older = {};
  } else if (isPlainObject(groups) && "version" in groups) {
    older = undefined;
  } else {
    const parsed = OlderSidebarGroupsSchema.safeParse(groups);
    if (!parsed.success) return null;
    older = parsed.data;
  }

  if (older !== undefined) {
    const views = await savedViews();
    if (views === null) return null;
    const pins = hasPins ? pinList(js["sidebar_pins"]) : [];
    doc.set("sidebar_groups", convertOlderLayout(older, pinnedFirst(views, pins)));
  }
  if (hasPins) doc.delete("sidebar_pins");
  return String(doc);
}

/** The format this step upgrades from (frozen, like every published format). */
export const SIDEBAR_VIEWS_LAYOUT_FROM = "0.3.0";

/**
 * Whether no user's settings hold anything this step would convert: for a
 * repair that must stamp a `.schema-version` it lost (A366's rule, A372).
 * A file the step would leave as it is (unreadable, not YAML, a damaged
 * pre-K158 value) does not count against it: the step would not change it
 * either. The saved views do not matter to the answer, so none are read.
 */
export async function isProvablyInViewsLayout(locttDir: string): Promise<boolean> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return true;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = getUserSettingsPath(locttDir, entry.name);
    if (!(await fileExists(path))) continue;
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    if ((await convertSettingsText(raw, () => Promise.resolve([]))) !== null) return false;
  }
  return true;
}

/** The saved views as the sidebar lists them, or null when `queries.yaml` cannot be read. */
async function loadSavedViews(locttDir: string): Promise<readonly SidebarSavedView[] | null> {
  try {
    const config = await loadQueriesConfig(locttDir);
    return sidebarSavedViews(config.queries, config.broken ?? []);
  } catch (err) {
    return isMissingFile(err) ? [] : null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ── The pre-K158 format (frozen: this step is its only reader) ───────

/** The pre-K158 group ids (K125): `views` was the List / Board / Timeline switcher. */
const OLDER_GROUP_IDS = [
  "views",
  "projects",
  "saved-filters",
  "filters",
  "milestones",
  "sprints",
  "labels",
  "recents",
] as const;
type OlderGroupId = (typeof OLDER_GROUP_IDS)[number];
const OLDER_ITEM_IDS = [...OLDER_GROUP_IDS, ...SIDEBAR_BUILTIN_VIEW_IDS] as const;

const uniqueIds = z
  .array(z.enum(OLDER_ITEM_IDS))
  .refine(ids => new Set(ids).size === ids.length, { message: "repeats an id" });

/** A clean `sidebar_groups` value written before K158 (no `version`). */
const OlderSidebarGroupsSchema = z
  .object({ order: uniqueIds.optional(), hidden: uniqueIds.optional() })
  .strict();
type OlderSidebarGroups = z.infer<typeof OlderSidebarGroupsSchema>;

const BUILTIN_IDS: ReadonlySet<string> = new Set(SIDEBAR_BUILTIN_VIEW_IDS);

/**
 * A retired `sidebar_pins` value (K159). Anything that is not a list
 * reads as no pins, and a non-string entry is skipped (A371 item 1).
 */
function pinList(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/**
 * `views` with the pinned ones first, in pin order (A371 item 5): a pin
 * naming a missing, archived (not listed) or broken view is skipped, and
 * duplicates fold. The rest follow in their listed order.
 */
export function pinnedFirst(
  views: readonly SidebarSavedView[],
  pins: readonly string[],
): readonly SidebarSavedView[] {
  if (pins.length === 0) return views;
  const byId = new Map(views.map(v => [v.id, v]));
  const pinned = [...new Set(pins)].flatMap(id => {
    const v = byId.get(id);
    return v === undefined || v.broken ? [] : [v];
  });
  const pinnedIds = new Set(pinned.map(v => v.id));
  return [...pinned, ...views.filter(v => !pinnedIds.has(v.id))];
}

/**
 * Converts a pre-K158 `sidebar_groups` value to the K158 shape so the
 * sidebar looks the same as it did (B52's rule, A370 item 2).
 *
 * The old value is first resolved exactly as the old sidebar rendered it
 * (including K125's A339 rule for a value older still: a `filters` group
 * absent from `order` sits where the first built-in id did). Then:
 *
 *  - `views` (the switcher) becomes `layouts`, same place, same flag.
 *  - `saved-filters` and `filters` become one `views` group, placed where
 *    the EARLIER of the two sat.
 *  - Its children are the two old sections' rows in the order they
 *    rendered: the built-ins in their stored order and the saved views in
 *    `savedViews` order (pins first, see {@link pinnedFirst}), whichever
 *    section came first leading.
 *  - Hidden: `views` is hidden only when both old groups were. Otherwise
 *    the children of a hidden old group are hidden one by one, so what
 *    was hidden stays hidden. Every built-in's own flag is kept.
 *
 * A saved view created after the step is not covered by an old "saved
 * views hidden" choice: it appends, visible, like any new view.
 */
export function convertOlderLayout(
  older: OlderSidebarGroups,
  savedViews: readonly SidebarSavedView[],
): SidebarGroups {
  const rows = resolveOlderRows(older);
  const savedHidden = rows.find(r => r.id === "saved-filters")?.hidden ?? false;
  const filtersHidden = rows.find(r => r.id === "filters")?.hidden ?? false;
  const bothHidden = savedHidden && filtersHidden;

  const order: SidebarItemId[] = [];
  const hidden: SidebarItemId[] = [];
  const children: SidebarItemId[] = [];
  const childHidden: SidebarItemId[] = [];
  let viewsPlaced = false;

  for (const row of rows) {
    if (row.id === "saved-filters" || row.id === "filters") {
      if (!viewsPlaced) {
        order.push("views");
        if (bothHidden) hidden.push("views");
        viewsPlaced = true;
      }
      if (row.id === "filters") {
        for (const c of row.children ?? []) {
          children.push(c.id);
          // When the whole group is hidden the built-ins keep only their
          // own flags; otherwise a hidden Filters group hides each one.
          if (c.hidden || (filtersHidden && !bothHidden)) childHidden.push(c.id);
        }
      } else {
        for (const v of savedViews) {
          const id = savedViewSidebarId(v.id);
          children.push(id);
          if (savedHidden && !bothHidden) childHidden.push(id);
        }
      }
      continue;
    }
    const id: SidebarGroupId = row.id === "views" ? "layouts" : row.id;
    order.push(id);
    if (row.hidden) hidden.push(id);
  }

  // Children sit straight after `views` (only their relative order
  // matters; this keeps the file readable).
  const at = order.indexOf("views");
  order.splice(at + 1, 0, ...children);
  const allHidden = [...hidden, ...childHidden];
  return {
    version: SIDEBAR_GROUPS_VERSION,
    order,
    ...(allHidden.length > 0 ? { hidden: allHidden } : {}),
  };
}

interface OlderRow {
  readonly id: OlderGroupId;
  readonly hidden: boolean;
  readonly children?: readonly { readonly id: SidebarBuiltinViewId; readonly hidden: boolean }[];
}

/**
 * The pre-K158 sidebar's rows, as it rendered them (K125/A339): the
 * `filters` group at its stored position, or, when a value older still
 * has no `filters` entry, where the first built-in id sat.
 */
function resolveOlderRows(groups: OlderSidebarGroups): readonly OlderRow[] {
  const filterOrder = resolveSidebarOrder(groups, SIDEBAR_BUILTIN_VIEW_IDS);
  const storedOrder: readonly string[] = groups.order ?? [];
  const withoutBuiltins = storedOrder.filter(id => !BUILTIN_IDS.has(id));
  let topOrder: string[];
  if (storedOrder.includes("filters")) {
    topOrder = withoutBuiltins;
  } else {
    const firstBuiltin = storedOrder.findIndex(id => BUILTIN_IDS.has(id));
    topOrder = firstBuiltin === -1
      ? withoutBuiltins
      : [...withoutBuiltins.slice(0, firstBuiltin), "filters", ...withoutBuiltins.slice(firstBuiltin)];
  }
  return resolveSidebarOrder({ order: topOrder, hidden: groups.hidden ?? [] }, OLDER_GROUP_IDS).map(r =>
    r.id === "filters"
      ? { id: r.id, hidden: r.hidden, children: filterOrder }
      : { id: r.id, hidden: r.hidden },
  );
}

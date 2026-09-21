/**
 * Saved-view tools plus read-only config introspection.
 *
 * K102: a view stores an ORDERED `filters[]` list — no `query` DSL
 * string and no `conditions` tree. This module passes that list through
 * to core untouched in both directions; the only thing it adds is a
 * display-only `summary` on the way out.
 *
 * `list_views` reads the
 * saved-query catalog from queries.yaml (and degrades gracefully
 * when the file is missing); the other two return the workflow
 * and calendar configs verbatim as JSON.
 */

import type { Filter } from "@loctt/contracts";
import { ComparisonOpSchema } from "@loctt/contracts";
import {
  applyArchivedScope,
  archiveView,
  createView,
  deleteView,
  editView,
  filtersToSummary,
  isMissingFile,
  loadCalendarConfig,
  loadQueriesConfig,
  loadWorkflowConfig,
  unarchiveView,
} from "@loctt/core";
import { z } from "zod";

import { getArchivedScope } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

/**
 * Sort spec shape shared by `create_view` and `edit_view`. Mirrors the
 * `QuerySort[]` a saved view stores — a list of `{field, direction}`,
 * so an agent can express the multi-key sorts a view can hold.
 */
const SortSchema = z.array(z.object({
  field: z.string(),
  direction: z.enum(["asc", "desc"]),
}));

/**
 * A view's ordered filter list (K102), shared by `create_view` and
 * `edit_view`.
 *
 * A discriminated union on `kind`, mirroring `FilterSchema` in contracts.
 * It is declared here rather than re-exported from contracts because the
 * MCP input schema carries agent-facing `.describe()` text that the
 * storage schema has no business holding.
 *
 * The list is stored EXACTLY as supplied: same order, never merged into
 * one DSL string, never reordered. That is the whole point of K102 — a
 * `simple` filter carries no query text, so a view authored here still
 * reopens as editable dropdown rows in the web picker instead of an
 * opaque blob of DSL.
 */
const FilterSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("simple"),
    field: z.string().min(1).describe("Field name, e.g. `status`, `assignee`, `fields.severity`"),
    op: ComparisonOpSchema.describe("Comparison operator"),
    values: z.array(z.string()).describe(
      "Selected value(s) as strings. Several values under `=` mean \"is any of\"; "
      + "under `!=` they mean \"is none of\". Postfix operators (`is empty`, "
      + "`is not empty`) take none — pass [].",
    ),
  }),
  z.object({
    kind: z.literal("advanced"),
    query: z.string().min(1).describe(
      "A LocTT DSL fragment, e.g. `(due_date < today or priority = high)`. "
      + "Validated on write and spacing-normalized — ONLY spacing; nothing "
      + "else is rewritten.",
    ),
  }),
]);

/**
 * Prose shared by `create_view` and `edit_view`, so the two tools cannot
 * describe the same stored shape two different ways.
 */
const FILTERS_GUIDANCE =
  "`filters` is an ORDERED list of filters that ALL AND together, stored exactly as "
  + "supplied — never merged into a single DSL string and never reordered. Each entry is "
  + "either `{kind: \"simple\", field, op, values}` or `{kind: \"advanced\", query}`. "
  + "PREFER `simple` filters: a view authored over MCP should still render as editable "
  + "dropdown rows in the web picker (K102), and a `simple` filter carries no query text, "
  + "so it always does. Reach for `advanced` only for what a simple filter cannot express "
  + "— parentheses, `or`, or mixed boolean nesting. An advanced filter's DSL is validated "
  + "on write (a malformed one is rejected here rather than poisoning the catalog) and is "
  + "spacing-normalized: ONLY spacing changes, so `status=a` comes back as `status = a` "
  + "and nothing else about the text is rewritten.";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_views",
    description: "List saved views from queries.yaml. Returns JSON [{id, name, filters, summary, sort?, archivedScope?, icon?, archived?}]. `filters` is the view's ordered filter list — the SOURCE OF TRUTH for what it matches (K102); all filters AND together, and the order is exactly as authored. `summary` is a human-readable one-line rendering of those filters, for DISPLAY ONLY: never parse it, never store it, and never send it back as input — edit a view by passing a new `filters` array. `archivedScope` is the view's own archived scope (a property of the view, not a filter). Address a view by `id`, not `name` — names are not unique, and running a view by an ambiguous name fails. By default archived views are hidden (K107); pass `archived: archived` for only archived or `archived: all` for both. Archived views carry `archived: true` and are still runnable by id. A view whose stored filters no longer parse is returned too, as {id, name, summary, broken: true, error, position?}.",
    inputSchema: {
      archived: z.enum(["active", "archived", "all"]).optional()
        .describe("Archived scope (K107): `active` (default) hides archived, `archived` shows only archived, `all` shows both. Broken views are always listed."),
    },
    handler: async ({ locttDir }, args) => {
      let config;
      try {
        config = await loadQueriesConfig(locttDir);
      } catch (err) {
        // "No saved views configured." used to cover ENOENT, a syntax
        // error and EACCES alike. Only the first is true, and an agent
        // told there are none may offer to recreate a catalog it never
        // read — over the file that holds it.
        if (isMissingFile(err)) return text("No saved views configured.");
        return errorResult(
          `${err instanceof Error ? err.message : String(err)}\n\n`
          + "Saved views could not be listed. This is not the same as having none — "
          + "do not create or overwrite views until this file can be read.",
        );
      }
      // `id`, `sort` and `archived` were dropped here, leaving an
      // agent with `{name, query}` — no way to tell two same-named
      // views apart, and no way to address either, since `findView`
      // throws on an ambiguous name (QRY-C6). Omitted rather than
      // nulled when absent, so "no sort" and "sorted by nothing"
      // stay distinguishable.
      //
      // VUE-22 / north-star principle 5 & parity: a view whose filters no
      // longer parse is returned too, carrying `broken: true` and the
      // parser's `error`/`position`, rather than being dropped or taking
      // down the whole list. An agent must see the view exists and is
      // broken — silently omitting it would let the agent recreate it
      // over the file that still holds it.
      // K107: hide archived views by default. The scope applies only to
      // the well-formed queries; a broken entry has no reliable `archived`
      // field, so it is always surfaced below (a degrade the agent must
      // see, not filter out).
      const scoped = applyArchivedScope(config.queries, getArchivedScope(args));
      const good = scoped.map(q => ({
        id: q.id,
        name: q.name,
        // K102: the ordered filter list IS the view. It is what an agent
        // must read to understand the view and what it must send back
        // (whole, in order) to change it.
        filters: q.filters,
        // A display-only rendering of the same filters. It exists so an
        // agent can show a user what a view does in one line without
        // rendering the array itself; it is NOT a stored field and is
        // never parsed back — there is no canonical DSL for a view any
        // more, and reconstructing one is exactly what K102 removes.
        summary: filtersToSummary(q.filters),
        ...(q.sort !== undefined ? { sort: q.sort } : {}),
        // The view's own archived scope (K107) — a property of the view,
        // distinct from the `archived` flag that hides it from lists.
        ...(q.archivedScope !== undefined ? { archivedScope: q.archivedScope } : {}),
        ...(q.icon !== undefined ? { icon: q.icon } : {}),
        ...(q.archived !== undefined ? { archived: q.archived } : {}),
      }));
      const broken = (config.broken ?? []).map(b => ({
        id: b.id,
        name: b.name,
        // A broken entry has no valid `filters` to return, so its
        // best-effort `summary` is all there is to show. Display-only,
        // like the good entries' — it did not validate, so it is
        // certainly not parseable back.
        summary: b.summary,
        broken: true as const,
        error: b.error,
        ...(b.position !== undefined ? { position: b.position } : {}),
      }));
      return text(JSON.stringify([...good, ...broken], null, 2));
    },
  },
  {
    name: "create_view",
    description:
      "Create a saved view in queries.yaml. A view is a named, re-runnable set of " +
      "filters. " + FILTERS_GUIDANCE + " `sort` orders results. `archivedScope` is the " +
      "view's OWN archived scope (whether it looks at active, archived, or all tasks) — " +
      "a property of the view, never a filter term. `icon` is an optional display icon. " +
      "Returns the created view (including its generated id) — address the view by that " +
      "id afterward, since names are not unique.",
    inputSchema: {
      name: z.string().describe("Display label. Need not be unique, but a unique name can be used as a ref."),
      filters: z.array(FilterSchema).describe(
        "The view's filters, in order. All AND together. May be empty (matches "
        + "everything within the view's archived scope). Prefer `simple` entries.",
      ),
      sort: SortSchema.optional().describe("Ordered sort keys, e.g. [{field: \"priority\", direction: \"desc\"}]"),
      archivedScope: z.enum(["active", "archived", "all"]).optional()
        .describe("The view's own archived scope: `active` (default) / `archived` / `all`. Not a filter."),
      icon: z.string().optional().describe("Optional display icon for the view."),
    },
    handler: async ({ locttDir }, args) => {
      const sort = args["sort"] as Array<{ field: string; direction: "asc" | "desc" }> | undefined;
      const archivedScope = args["archivedScope"] as "active" | "archived" | "all" | undefined;
      const icon = args["icon"] as string | undefined;
      const created = await createView(locttDir, {
        name: args["name"] as string,
        filters: args["filters"] as Filter[],
        ...(sort !== undefined ? { sort } : {}),
        ...(archivedScope !== undefined ? { archivedScope } : {}),
        ...(icon !== undefined ? { icon } : {}),
      });
      return text(JSON.stringify(created, null, 2));
    },
  },
  {
    name: "edit_view",
    description:
      "Edit a saved view. `view` accepts an id or a unique name (an ambiguous name is " +
      "rejected — use the id). Any of `name`, `filters`, `sort`, `archivedScope`, `icon` " +
      "may be supplied; omitted fields are left unchanged. " + FILTERS_GUIDANCE + " " +
      "Supplying `filters` REPLACES the whole ordered list — there is no partial patch, " +
      "because order is meaningful, so send the full list you want. Omitting `filters` " +
      "leaves the view's filters untouched. To change one row, call `list_views` first, " +
      "modify that array, and send it back whole. Pass `sort: null` to clear an existing " +
      "sort and `icon: null` to clear the icon (both distinct from omitting them, which " +
      "leaves them as-is).",
    inputSchema: {
      view: z.string().describe("View id or unique name"),
      name: z.string().optional(),
      filters: z.array(FilterSchema).optional().describe(
        "Replaces the view's ENTIRE ordered filter list. Omit to leave filters unchanged.",
      ),
      sort: SortSchema.nullable().optional().describe("New sort keys, or null to clear the sort"),
      archivedScope: z.enum(["active", "archived", "all"]).optional()
        .describe("The view's own archived scope: `active` / `archived` / `all`. Not a filter."),
      icon: z.string().nullable().optional().describe("New display icon, or null to clear it."),
    },
    handler: async ({ locttDir }, args) => {
      const ref = args["view"] as string;
      const sort = args["sort"] as Array<{ field: string; direction: "asc" | "desc" }> | null | undefined;
      const archivedScope = args["archivedScope"] as "active" | "archived" | "all" | undefined;
      const icon = args["icon"] as string | null | undefined;
      const updated = await editView(locttDir, ref, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        // Present → replaces the whole list; absent → untouched. There is
        // deliberately no merge step here (K102: order is meaningful).
        ...(args["filters"] !== undefined ? { filters: args["filters"] as Filter[] } : {}),
        ...(archivedScope !== undefined ? { archivedScope } : {}),
        // `icon` present-and-null → clear; present-and-string → set;
        // absent → unchanged, mirroring `sort` below.
        ...("icon" in args ? { icon: icon ?? null } : {}),
        // `sort` present-and-null → clear; present-and-array → set;
        // absent → leave unchanged. `"sort" in args` distinguishes an
        // explicit null from an omitted key.
        ...("sort" in args ? { sort: sort ?? null } : {}),
      });
      return text(JSON.stringify(updated, null, 2));
    },
  },
  {
    name: "delete_view",
    description:
      "Permanently remove a saved view from queries.yaml. `view` accepts an id or a " +
      "unique name. Use `archive_view` for the reversible (soft) variant. Always " +
      "requires `confirm: true`.",
    inputSchema: {
      view: z.string().describe("View id or unique name"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_view");
      if (blocked) return blocked;
      const ref = args["view"] as string;
      // hard: the web's DELETE contract — DELETE means delete, not
      // archive. `archive_view` is the reversible path (VUE-25).
      await deleteView(locttDir, ref, { hard: true });
      return text(JSON.stringify({ deleted: ref }, null, 2));
    },
  },
  {
    name: "archive_view",
    description: "Mark a saved view as archived — hidden from default lists but still runnable by id. Reversible via `unarchive_view`. `view` accepts an id or a unique name.",
    inputSchema: { view: z.string().describe("View id or unique name") },
    handler: async ({ locttDir }, args) => {
      const ref = args["view"] as string;
      await archiveView(locttDir, ref);
      return text(JSON.stringify({ archived: ref }, null, 2));
    },
  },
  {
    name: "unarchive_view",
    description: "Clear the archived flag on a saved view, restoring it to default lists. `view` accepts an id or a unique name.",
    inputSchema: { view: z.string().describe("View id or unique name") },
    handler: async ({ locttDir }, args) => {
      const ref = args["view"] as string;
      await unarchiveView(locttDir, ref);
      return text(JSON.stringify({ unarchived: ref }, null, 2));
    },
  },
  {
    name: "get_workflow_config",
    description: "Returns the full workflow configuration as JSON: the valid statuses, priorities, task types, relationship types, and custom-field definitions, each with its stored `key` and human label. Call this FIRST — before creating or editing any task — to discover the valid keys for enum-valued fields, because stored values are config keys, not the human labels. Read-only, no parameters.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const config = await loadWorkflowConfig(locttDir);
      return text(JSON.stringify(config, null, 2));
    },
  },
  {
    name: "get_calendar",
    description: "Returns the workspace calendar config (timezone, working days, holidays). Read-only — calendar is configured via the UI.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadCalendarConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
];

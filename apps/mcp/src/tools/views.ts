/**
 * Read-only config/view introspection. `list_views` reads the
 * saved-query catalog from queries.yaml (and degrades gracefully
 * when the file is missing); the other two return the workflow
 * and calendar configs verbatim as JSON.
 */

import {
  applyArchivedScope,
  archiveView,
  createView,
  deleteView,
  editView,
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

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_views",
    description: "List saved views from queries.yaml. Returns JSON [{id, name, query, conditions, sort?, archived?}]. `query` is the DSL string (regenerated, spacing-normalized) and `conditions` is its structured form — the source of truth the query is derived from. Address a view by `id`, not `name` — names are not unique, and running a view by an ambiguous name fails. By default archived views are hidden (K107); pass `archived: archived` for only archived or `archived: all` for both. Archived views carry `archived: true` and are still runnable by id.",
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
      // VUE-22 / north-star principle 5 & parity: a view whose query no
      // longer parses is returned too, carrying `broken: true` and the
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
        query: q.query,
        // The structured source of truth, returned alongside `query` for
        // parity/debuggability: an agent introspecting a view sees the
        // same conditions the web builder edits, not just the DSL.
        conditions: q.conditions,
        ...(q.sort !== undefined ? { sort: q.sort } : {}),
        ...(q.archived !== undefined ? { archived: q.archived } : {}),
      }));
      const broken = (config.broken ?? []).map(b => ({
        id: b.id,
        name: b.name,
        query: b.query,
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
      "Create a saved view in queries.yaml. A view is a named query an agent or " +
      "user can re-run by name or id. The `query` is a LocTT DSL string (the same " +
      "language `list_tasks` accepts as `query`); it is validated on write, so a " +
      "malformed query is rejected here rather than silently poisoning the catalog. " +
      "The view stores a structured `conditions` form derived from the DSL (that " +
      "is the source of truth); the returned `query` is regenerated from it and is " +
      "spacing-normalized, so `status=a` comes back as `status = a`. " +
      "`sort` is optional and orders results. Returns the created view (including its " +
      "generated id and derived `conditions`) — address the view by that id afterward, " +
      "since names are not unique.",
    inputSchema: {
      name: z.string().describe("Display label. Need not be unique, but a unique name can be used as a ref."),
      query: z.string().describe("LocTT query DSL, e.g. `status in (backlog, in_progress)`"),
      sort: SortSchema.optional().describe("Ordered sort keys, e.g. [{field: \"priority\", direction: \"desc\"}]"),
    },
    handler: async ({ locttDir }, args) => {
      const sort = args["sort"] as Array<{ field: string; direction: "asc" | "desc" }> | undefined;
      const created = await createView(locttDir, {
        name: args["name"] as string,
        query: args["query"] as string,
        ...(sort !== undefined ? { sort } : {}),
      });
      return text(JSON.stringify(created, null, 2));
    },
  },
  {
    name: "edit_view",
    description:
      "Edit a saved view. `view` accepts an id or a unique name (an ambiguous name is " +
      "rejected — use the id). Any of `name`, `query`, `sort` may be supplied; omitted " +
      "fields are left unchanged. A new `query` is validated on write and its structured " +
      "`conditions` re-derived (the returned `query` is regenerated, spacing-normalized). " +
      "Pass `sort: null` to clear an existing sort (distinct from omitting it, which " +
      "leaves it as-is).",
    inputSchema: {
      view: z.string().describe("View id or unique name"),
      name: z.string().optional(),
      query: z.string().optional().describe("LocTT query DSL"),
      sort: SortSchema.nullable().optional().describe("New sort keys, or null to clear the sort"),
    },
    handler: async ({ locttDir }, args) => {
      const ref = args["view"] as string;
      const sort = args["sort"] as Array<{ field: string; direction: "asc" | "desc" }> | null | undefined;
      const updated = await editView(locttDir, ref, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...(args["query"] !== undefined ? { query: args["query"] as string } : {}),
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

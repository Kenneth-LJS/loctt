import type { ArchivedScope, Filter, QuerySort } from "@loctt/contracts";
import { ComparisonOpSchema } from "@loctt/contracts";
import {
  applyArchivedScope,
  archiveView,
  createView,
  deleteView,
  editView,
  filtersToSummary,
  findViewOrBroken,
  loadOptionalConfigs,
  loadQueriesConfig,
  resolveLocttDir,
  unarchiveView,
} from "@loctt/core";

import { getArg, getArgAll, parseArchivedScope, positional, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * Flags this command family accepts. A union across its subcommands:
 * they share one argv, so splitting per subcommand would reject a
 * sibling's valid flag (the PRU-C9 rule — an unrecognised flag is a
 * mistype, not a silent no-op).
 */
const ACCEPTED_FLAGS: readonly string[] = [
  "--all", "--archived", "--query", "--filter", "--name", "--sort", "--yes", "--icon",
  // K102-broken-repair: the explicit opt-in to replace or delete a view
  // whose stored filters did not load, discarding the original text
  // queries.yaml preserves for it. Accepted by `edit` and `delete`; it
  // does nothing to a healthy view.
  "--force",
];

/**
 * The operators `--filter` accepts, longest first so `is not empty` is
 * matched before `is`, and `!=`/`<=`/`>=` before `<`/`>`. Order is the
 * whole correctness argument here: a shortest-first scan would read
 * `status != done` as the operator `<`.
 */
const FILTER_OPS: readonly string[] = [
  "is not empty", "is empty", "not in", "!=", "<=", ">=", "~", "in", "=", "<", ">",
];

/**
 * Parses one `--filter "field op value[,value...]"` into a SIMPLE filter.
 *
 * The CLI authors simple filters by preference (K102: a CLI/MCP-made view
 * should still render editably in the web picker rather than as opaque
 * DSL), so this is the primary authoring path and `--query` is the
 * escape hatch for what simple filters cannot say.
 *
 * Values are comma-separated; a multi-value `=` means "any of these"
 * (core widens it to `in` at execution). `is empty` / `is not empty` take
 * no value.
 */
function parseSimpleFilter(raw: string): Filter {
  const text = raw.trim();
  if (text === "") {
    throw new UsageError(`--filter needs "field op value", e.g. --filter "status = backlog"`);
  }
  for (const op of FILTER_OPS) {
    // Operators must be surrounded by whitespace (or end the string) so a
    // field or value containing one is not mistaken for the operator.
    const idx = text.indexOf(` ${op} `);
    const isPostfix = op.startsWith("is ");
    const postfixIdx = text.endsWith(` ${op}`) ? text.length - op.length - 1 : -1;
    if (isPostfix && postfixIdx > 0) {
      return {
        kind: "simple",
        field: text.slice(0, postfixIdx).trim(),
        op: ComparisonOpSchema.parse(op),
        values: [],
      };
    }
    if (idx > 0) {
      const field = text.slice(0, idx).trim();
      const valuePart = text.slice(idx + op.length + 2).trim();
      if (field === "") {
        throw new UsageError(`--filter "${raw}" has no field before "${op}"`);
      }
      if (valuePart === "") {
        throw new UsageError(`--filter "${raw}" has no value after "${op}"`);
      }
      const values = valuePart.split(",").map(v => v.trim()).filter(v => v !== "");
      if (values.length === 0) {
        throw new UsageError(`--filter "${raw}" has no value after "${op}"`);
      }
      return { kind: "simple", field, op: ComparisonOpSchema.parse(op), values };
    }
  }
  throw new UsageError(
    `--filter "${raw}" has no recognised operator `
    + `(one of: ${FILTER_OPS.join(", ")}) — values with spaces are fine, e.g. --filter "title ~ my task"`,
  );
}

/**
 * Collects the ordered filter list a create/edit was given.
 *
 * `--filter` (repeatable) yields simple filters and `--query` (repeatable)
 * advanced ones; both may be mixed. Order follows the ARGV order across
 * both flags, because a view's list is stored as authored (K102) — so
 * `--filter a --query b --filter c` stores exactly those three, in that
 * order.
 */
function collectFilters(args: string[]): Filter[] {
  const out: { index: number; filter: Filter }[] = [];
  const seen = { filter: 0, query: 0 };
  const simple = getArgAll(args, "--filter");
  const advanced = getArgAll(args, "--query");
  // Walk argv once so the two flags interleave in the order typed.
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--filter" || a.startsWith("--filter=")) {
      const raw = simple[seen.filter];
      if (raw !== undefined) out.push({ index: i, filter: parseSimpleFilter(raw) });
      seen.filter += 1;
    } else if (a === "--query" || a.startsWith("--query=")) {
      const raw = advanced[seen.query];
      if (raw !== undefined) out.push({ index: i, filter: { kind: "advanced", query: raw } });
      seen.query += 1;
    }
  }
  return out.map(o => o.filter);
}

/**
 * Parses a `--sort` value into the `QuerySort[]` a saved view stores.
 *
 * Format: comma-separated `field[:asc|:desc]`, e.g.
 * `priority:desc,created:asc`. A bare field defaults to `asc`, matching
 * the `list --sort <field>` default. This supports the multi-key sorts
 * a view can hold — a single `--sort field` alone cannot — while staying
 * one flag.
 *
 * `-` is the explicit "clear sort" signal on `edit` (mirrors
 * `milestone edit --target-date -`); it returns null so the caller can
 * distinguish "clear" from "leave unchanged" (undefined).
 */
function parseSort(raw: string | undefined): QuerySort[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "-") return null;
  const parts = raw.split(",").map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length === 0) {
    throw new UsageError(`--sort needs at least one field, e.g. --sort priority:desc`);
  }
  return parts.map(p => {
    const [field, dir] = p.split(":");
    if (!field) {
      throw new UsageError(`--sort field is empty in "${p}"`);
    }
    if (dir !== undefined && dir !== "asc" && dir !== "desc") {
      throw new UsageError(`--sort direction must be "asc" or "desc", got "${dir}" in "${p}"`);
    }
    return { field, direction: dir ?? "asc" };
  });
}

/**
 * `loctt views <subcommand>` — saved-view lifecycle.
 *
 * Bare `loctt views` (and `loctt views list`) lists the catalog; the
 * write subcommands (`create`/`edit`/`delete`/`archive`/`unarchive`)
 * are the CLI half of the parity K30 built — the web authored views and
 * these two surfaces could only read them. Every write goes through the
 * same core `views/manage` functions the web server calls, so a view
 * authored here and one authored in the UI are indistinguishable.
 *
 * A view is addressed by id or by a unique name (`findView` in core);
 * an ambiguous name is rejected with a message telling you to use the
 * id instead.
 */
export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  // A flag in the subcommand slot means no subcommand was given — e.g.
  // `loctt views --archived all` is the bare LIST with a scope flag, not a
  // subcommand named "--archived". Treat a leading `--flag` as "list".
  const subToken = args[1];
  const sub = subToken !== undefined && subToken.startsWith("--") ? undefined : subToken;
  const locttDir = resolveLocttDir(root);

  // Bare `loctt views` keeps its historical meaning: list. `list` is
  // also accepted explicitly for symmetry with the entity commands.
  if (sub === undefined || sub === "list") {
    // K107: the archived scope applies to the list. Default `active`
    // hides archived views; `--archived archived|all` (and the deprecated
    // `--all` alias) widen it. Before K107 the list always showed archived
    // views (marked ` (archived)`).
    await list(locttDir, parseArchivedScope(args));
    return;
  }

  switch (sub) {
    case "create": {
      await runCommand(async () => {
        // A flag here is a mistyped name, not a name (see `positional`).
        const name = positional(args, 2, `loctt views create <name> [--filter "field op value"]... [--query "<dsl>"]... [--sort field:asc,...] [--archived <scope>] [--icon <icon>]`);
        if (!name) {
          throw new UsageError("missing name", `loctt views create <name> [--filter "field op value"]... [--query "<dsl>"]... [--sort field:asc,...] [--archived <scope>] [--icon <icon>]`);
        }
        // K102: a view is an ordered filter list. `--filter` authors a
        // simple filter, `--query` an advanced one, and they interleave in
        // argv order. An empty list is allowed — a view with no filters
        // matches everything within its archived scope.
        const filters = collectFilters(args);
        const sort = parseSort(getArg(args, "--sort"));
        const icon = getArg(args, "--icon");
        // `--archived` on create names the view's own SCOPE, not a filter
        // (K107). Absent leaves it at the default (`active`).
        const scope = args.includes("--archived") || args.some(a => a.startsWith("--archived="))
          ? parseArchivedScope(args)
          : undefined;
        const created = await createView(locttDir, {
          name,
          filters,
          ...(sort ? { sort } : {}),
          ...(scope !== undefined ? { archivedScope: scope } : {}),
          ...(icon !== undefined ? { icon } : {}),
        });
        console.log(`Created view "${created.name}" (id ${created.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref || ref.startsWith("--")) {
          throw new UsageError("missing view ref", `loctt views edit <name|id> [--name <new>] [--filter "field op value"]... [--query "<dsl>"]... [--sort field:asc,...|-] [--archived <scope>] [--icon <icon>]`);
        }
        const name = getArg(args, "--name");
        const sort = parseSort(getArg(args, "--sort"));
        const icon = getArg(args, "--icon");
        const scope = args.includes("--archived") || args.some(a => a.startsWith("--archived="))
          ? parseArchivedScope(args)
          : undefined;
        // Filters are replaced WHOLESALE when any are given: order is
        // meaningful, so there is no partial-filter patch (K102). Giving
        // none leaves the view's existing filters untouched.
        const filters = collectFilters(args);
        const hasFilterFlags = filters.length > 0;
        // K102-broken-repair: `--force` is itself a change on a BROKEN
        // entry — "replace it, filters and all" — so it satisfies the
        // nothing-to-change check there. On a HEALTHY view it changes
        // nothing, so the check still applies and `--force` alone is a
        // usage error rather than a no-op rewrite: the flag must not
        // become a back door to an empty edit (constraint 4 — the
        // healthy path is untouched by this feature).
        const force = args.includes("--force");
        const refIsBroken = force
          && findViewOrBroken(
            await loadQueriesConfig(locttDir),
            ref,
          ).kind === "broken";
        if (
          name === undefined && !hasFilterFlags && sort === undefined
          && scope === undefined && icon === undefined && !refIsBroken
        ) {
          throw new UsageError("nothing to change", `loctt views edit <name|id> [--name <new>] [--filter "field op value"]... [--query "<dsl>"]... [--sort field:asc,...|-] [--archived <scope>] [--icon <icon>] [--force]`);
        }
        const updated = await editView(locttDir, ref, {
          ...(name !== undefined ? { name } : {}),
          ...(hasFilterFlags ? { filters } : {}),
          // sort: null clears, undefined leaves unchanged. parseSort
          // maps `-` → null, absent → undefined, a spec → the array.
          ...(sort !== undefined ? { sort } : {}),
          ...(scope !== undefined ? { archivedScope: scope } : {}),
          ...(icon !== undefined ? { icon } : {}),
          ...(force ? { replaceBroken: true } : {}),
        });
        console.log(`Updated view "${updated.name}" (id ${updated.id})`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref || ref.startsWith("--")) {
          throw new UsageError("missing view ref", `loctt views ${sub} <name|id>`);
        }
        if (sub === "archive") await archiveView(locttDir, ref);
        else await unarchiveView(locttDir, ref);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} view ${ref}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref || ref.startsWith("--")) {
        console.error(`Error: missing view ref`);
        console.error(`Usage: loctt views delete <name|id> [--yes] [--force]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete view ${ref}? (use 'loctt views archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        // hard: the web's DELETE contract — DELETE means delete, not
        // archive. `views archive` is the reversible path (VUE-25).
        // `--force` is the K102-broken-repair opt-in, distinct from
        // `--yes`: `--yes` skips the interactive prompt every hard delete
        // has, while `--force` consents to discarding the preserved
        // original text of a BROKEN entry. A healthy view ignores it.
        await deleteView(locttDir, ref, { hard: true, replaceBroken: args.includes("--force") });
        console.log(`Deleted view ${ref}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt views <list|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}

/**
 * Lists saved views from queries.yaml. One line per view:
 * `<name>  <summary>` plus a `[sort: ...]` suffix when the view declares
 * one and an ` (archived)` marker when hidden from default lists.
 *
 * The summary is rendered from the view's filters at display time (K102)
 * — a view stores no derived DSL string, and nothing here parses one back.
 */
async function list(locttDir: string, scope: ArchivedScope): Promise<void> {
  const { queriesConfig } = await loadOptionalConfigs(locttDir);
  const broken = queriesConfig?.broken ?? [];
  if (!queriesConfig || (queriesConfig.queries.length === 0 && broken.length === 0)) {
    console.log("No saved views.");
    return;
  }
  // K107: hide archived views by default. The scope applies only to the
  // well-formed queries; a broken entry has no reliable `archived` field
  // and is always listed below (a degrade the user must see).
  const scoped = applyArchivedScope(queriesConfig.queries, scope);
  for (const v of scoped) {
    const sortPart = v.sort && v.sort.length > 0
      ? `  [sort: ${v.sort.map(s => `${s.field} ${s.direction}`).join(", ")}]`
      : "";
    const arch = v.archived === true ? "  (archived)" : "";
    console.log(`${v.name}  ${filtersToSummary(v.filters)}${sortPart}${arch}`);
  }
  // VUE-22 / north-star principle 5 & parity: a view whose query no
  // longer parses is listed here too, marked broken with the parser's
  // message, rather than being dropped — one bad entry no longer hides
  // itself or takes down the rest of the catalog. The UI marks these
  // broken in the sidebar; the CLI does the same in text.
  for (const b of broken) {
    console.log(`${b.name}  ${b.summary}  [broken: ${b.error}]`);
  }
}

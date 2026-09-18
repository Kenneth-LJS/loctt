import type { QuerySort } from "@loctt/contracts";
import {
  archiveView,
  createView,
  deleteView,
  editView,
  loadOptionalConfigs,
  resolveLocttDir,
  unarchiveView,
} from "@loctt/core";

import { getArg, positional, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * Flags this command family accepts. A union across its subcommands:
 * they share one argv, so splitting per subcommand would reject a
 * sibling's valid flag (the PRU-C9 rule — an unrecognised flag is a
 * mistype, not a silent no-op).
 */
const ACCEPTED_FLAGS: readonly string[] = ["--query", "--name", "--sort", "--yes"];

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
  const sub = args[1];
  const locttDir = resolveLocttDir(root);

  // Bare `loctt views` keeps its historical meaning: list. `list` is
  // also accepted explicitly for symmetry with the entity commands.
  if (sub === undefined || sub === "list") {
    await list(locttDir);
    return;
  }

  switch (sub) {
    case "create": {
      await runCommand(async () => {
        // A flag here is a mistyped name, not a name (see `positional`).
        const name = positional(args, 2, `loctt views create <name> --query "<dsl>" [--sort field:asc,...]`);
        if (!name) {
          throw new UsageError(
            "missing name",
            `loctt views create <name> --query "<dsl>" [--sort field:asc,...]`,
          );
        }
        const query = getArg(args, "--query");
        if (query === undefined) {
          throw new UsageError(
            "missing --query",
            `loctt views create <name> --query "<dsl>" [--sort field:asc,...]`,
          );
        }
        const sort = parseSort(getArg(args, "--sort"));
        // create takes no "clear" case; `-` is nonsensical here.
        const created = await createView(locttDir, {
          name,
          query,
          ...(sort ? { sort } : {}),
        });
        console.log(`Created view "${created.name}" (id ${created.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref || ref.startsWith("--")) {
          throw new UsageError(
            "missing view ref",
            `loctt views edit <name|id> [--name <new>] [--query "<dsl>"] [--sort field:asc,...|-]`,
          );
        }
        const name = getArg(args, "--name");
        const query = getArg(args, "--query");
        const sort = parseSort(getArg(args, "--sort"));
        if (name === undefined && query === undefined && sort === undefined) {
          throw new UsageError(
            "nothing to change",
            `loctt views edit <name|id> [--name <new>] [--query "<dsl>"] [--sort field:asc,...|-]`,
          );
        }
        const updated = await editView(locttDir, ref, {
          ...(name !== undefined ? { name } : {}),
          ...(query !== undefined ? { query } : {}),
          // sort: null clears, undefined leaves unchanged. parseSort
          // maps `-` → null, absent → undefined, a spec → the array.
          ...(sort !== undefined ? { sort } : {}),
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
        console.error(`Usage: loctt views delete <name|id> [--yes]`);
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
        await deleteView(locttDir, ref, { hard: true });
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
 * `<name>  <query>` plus a `[sort: ...]` suffix when the view declares
 * one and an ` (archived)` marker when hidden from default lists.
 */
async function list(locttDir: string): Promise<void> {
  const { queriesConfig } = await loadOptionalConfigs(locttDir);
  const broken = queriesConfig?.broken ?? [];
  if (!queriesConfig || (queriesConfig.queries.length === 0 && broken.length === 0)) {
    console.log("No saved views.");
    return;
  }
  for (const v of queriesConfig.queries) {
    const sortPart = v.sort && v.sort.length > 0
      ? `  [sort: ${v.sort.map(s => `${s.field} ${s.direction}`).join(", ")}]`
      : "";
    const arch = v.archived === true ? "  (archived)" : "";
    console.log(`${v.name}  ${v.query}${sortPart}${arch}`);
  }
  // VUE-22 / north-star principle 5 & parity: a view whose query no
  // longer parses is listed here too, marked broken with the parser's
  // message, rather than being dropped — one bad entry no longer hides
  // itself or takes down the rest of the catalog. The UI marks these
  // broken in the sidebar; the CLI does the same in text.
  for (const b of broken) {
    console.log(`${b.name}  ${b.query}  [broken: ${b.error}]`);
  }
}

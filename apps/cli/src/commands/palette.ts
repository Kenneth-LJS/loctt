/**
 * `loctt palette` — lists the built-in colour palette (K103).
 *
 * Without this, `--color palette:<id>` is unusable: the ids are defined
 * in core and appear nowhere a user or an agent can read them, so the
 * only way to pick one is to guess. K103 requires the listing on all
 * three surfaces (the web picker shows swatches; MCP has
 * `list_palette_colors`); this is the CLI's.
 *
 * It is a read-only top-level command rather than a subcommand of any
 * one entity family because the palette is not owned by statuses or
 * labels — every entity colour draws from the same list, and hanging it
 * off one family would imply otherwise.
 *
 * Two formats: the default is tab-separated columns (greppable, and the
 * `id` is the first field so `loctt palette | cut -f1` is the id list);
 * `--format json` emits the entries verbatim for scripting.
 */

import { BUILTIN_PALETTE } from "@loctt/core";

import { getArg, rejectUnknownFlags } from "../runtime/args.js";
import { formatPaletteList } from "../runtime/color.js";
import { UsageError } from "../runtime/errors.js";

const ACCEPTED_FLAGS: readonly string[] = ["--format"];

export function run(args: string[]): void {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  if (sub !== undefined && sub !== "list" && !sub.startsWith("--")) {
    throw new UsageError(`unknown subcommand "${sub}"`, "loctt palette [list] [--format <table|json>]");
  }
  const format = getArg(args, "--format") ?? "table";
  if (format !== "table" && format !== "json") {
    throw new UsageError(
      `--format must be one of: table, json (got "${format}")`,
      "loctt palette [list] [--format <table|json>]",
    );
  }
  if (format === "json") {
    console.log(JSON.stringify(BUILTIN_PALETTE, null, 2));
    return;
  }
  for (const line of formatPaletteList()) console.log(line);
}

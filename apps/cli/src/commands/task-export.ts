import { writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import {
  buildListContext,
  exportTasksToCSV,
  exportTasksToJSON,
  filterForExport,
  listTasks,
  loadAllTasksDetailed,
  loadOptionalConfigs,
  loadProjectsConfig,
  resolveLocttDir,
  resolveProjectIdFromInput,
} from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";

/**
 * `loctt export [--format csv|json] [--query <q>] [--view <v>]
 *   [--project <p>] [--columns <a,b,c>] [--body] [--archived]
 *   [--output <file>]`
 *
 * Task export as CSV or JSON, mirroring the web list-view export
 * (`handleExportTasks`). K30/F4 builds this on the CLI so a scripted
 * or spreadsheet workflow does not have to run the web server.
 *
 * The column set, formula-injection escaping and array handling all
 * come from the same core functions the web handler uses, so a CSV
 * produced here is byte-identical to one downloaded from the UI for
 * the same rows.
 *
 * Unreadable tasks are *named* rather than silently dropped:
 * a truncated export that omits a bad row with no mention is the one
 * outcome the export must not produce. The names go to stderr so the
 * export itself stays pipeable on stdout.
 */
const TASK_EXPORT_FLAGS: readonly string[] = [
  "--format", "--query", "--view", "--project",
  "--columns", "--body", "--archived", "--output",
];

export async function exportTasks(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_EXPORT_FLAGS);
  const locttDir = resolveLocttDir(root);

  const format = (getArg(args, "--format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "json") {
    throw new UsageError(`--format must be csv or json, got: ${format}`);
  }

  const includeArchived = hasFlag(args, "--archived");
  const includeBody = hasFlag(args, "--body");
  const columnsArg = getArg(args, "--columns");
  const columns = columnsArg
    ? columnsArg.split(",").map(c => c.trim()).filter(Boolean)
    : undefined;

  const { tasks, unreadable } = await loadAllTasksDetailed(locttDir);
  const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);

  const baseQuery = getArg(args, "--query");
  const view = getArg(args, "--view");

  // Resolve `--project <name|id>` to an id the same way `list` does:
  // tasks reference their project by ULID (P-2), so a bare name would
  // never match and the export would come back empty rather than
  // filtered.
  const projectArg = getArg(args, "--project");
  let projectFilter: string | undefined;
  if (projectArg !== undefined) {
    const projectsConfig = await loadProjectsConfig(locttDir);
    projectFilter = resolveProjectIdFromInput(projectsConfig, projectArg, {
      includeArchived,
    });
  }

  const result = listTasks({
    tasks,
    options: {
      ...(baseQuery !== undefined ? { query: baseQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(projectFilter !== undefined ? { project: projectFilter } : {}),
      // The archived filter is applied by filterForExport below, matching
      // the web handler, so the query filter is left wide open (K107: the
      // `all` scope injects no archived term).
      archivedScope: "all",
      ...(today !== undefined ? { today } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    },
    ...(queriesConfig !== undefined ? { queriesConfig } : {}),
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    ctx: buildListContext(tasks),
    onWarning: err => {
      process.stderr.write(`Warning: saved view "${view ?? ""}" — ${err.message}\n`);
    },
  });

  const filtered = filterForExport(result, includeArchived);
  const opts = {
    ...(columns ? { columns } : {}),
    ...(includeBody ? { includeBody: true } : {}),
  };
  const body = format === "json"
    ? exportTasksToJSON(filtered, opts)
    : exportTasksToCSV(filtered, opts);

  const output = getArg(args, "--output");
  if (output !== undefined) {
    await writeFile(resolvePath(root, output), body, "utf-8");
    process.stderr.write(
      `Exported ${filtered.length} task(s) to ${output} (${format}).\n`,
    );
  } else {
    process.stdout.write(body);
    // A trailing newline for JSON keeps stdout tidy when piped to a
    // terminal; CSV already ends in one.
    if (format === "json") process.stdout.write("\n");
  }

  // An export that dropped an unparseable task without a word is a
  // spreadsheet short by a row that reconciles against nothing.
  // The paths go to stderr so the export body on stdout is unpolluted.
  if (unreadable.length > 0) {
    process.stderr.write(
      `Warning: ${unreadable.length} task(s) could not be read and were ` +
      `omitted from the export:\n` +
      unreadable.map(u => `  ${u.path}`).join("\n") + "\n",
    );
  }
}

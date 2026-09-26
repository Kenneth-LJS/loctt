/**
 * Top-level `loctt` usage text. Printed on `help`, `--help`, `-h`,
 * or any unrecognized command.
 *
 * Lives in its own module so adding a new command means touching
 * (at most) two files: the command implementation under
 * `commands/` and the relevant line here.
 */

export function usage(): void {
  console.log(`Usage: loctt [--root <dir>] <command> [options]

Global options:
  --root <dir>                     Operate against the tracker rooted
                                   at <dir> instead of the current
                                   working directory. Canonical name;
                                   also accepted on 'ui' and 'mcp'.
  --cwd <dir>                      Back-compat alias of --root. If both
                                   are given they must point at the same
                                   directory.
                                   (env LOCTT_ROOT is used when no flag
                                   is given; an explicit flag wins.)
  --version                        Print the installed version and exit.

Commands:
  init [--repair] [--prefix <prefix>] [--project-label <label>] [--no-docs]
                                   --repair: restore files missing from an existing
                                   .loctt/ without touching what survived
                                   [--timezone <IANA tz>]  Workspace timezone; defaults to this
                                   machine's zone. Decides what "today" means in queries.
  info
  doctor [--rebuild-index]         Run diagnostic checks; with --rebuild-index, rebuild
                                   the key-lookup cache after out-of-band frontmatter edits
  views [--archived <active|archived|all>]
                                   List saved views from queries.yaml
                                   --archived: active (default, hides archived)
                                   | archived (only) | all (both)
  schema                           Show the workflow config (statuses, priorities, etc.)
  project <list|create|edit|archive|unarchive|delete|set-default> ...
                                   list [--archived <active|archived|all>]: default active
                                   hides archived (--all = deprecated alias for 'all')
                                   delete: permanent (remap_to required if tasks exist; use 'archive' for soft)
  user <list|current|switch|create|edit|archive|unarchive|delete|settings> ...
                                   list [--archived <active|archived|all>]: default active
                                   hides archived (--all = deprecated alias for 'all')
                                   delete: permanent (use 'archive' for the reversible alternative)
  label <list|create|edit|archive|unarchive|delete> ...
                                   list [--archived <active|archived|all>]: default active
                                   hides archived (--all = deprecated alias for 'all')
                                   delete: permanent (drops key from every task; use 'archive' for soft)
  palette [list] [--format <table|json>]
                                   List the built-in colour palette (ids + light/dark values)
                                   for use as --color palette:<id>
  milestone <list|create|edit|archive|unarchive|delete> ...
                                   list [--archived <active|archived|all>]: default active
                                   hides archived (--all = deprecated alias for 'all')
                                   delete: permanent (clears milestone field on tasks; use 'archive' for soft)
  sprint <list|create|edit|archive|unarchive|delete|burndown> ...
                                   list [--archived <active|archived|all>]: default active
                                   hides archived (--all = deprecated alias for 'all')
                                   delete: permanent (clears sprint field on tasks; use 'archive' for soft)
                                   burndown <key> [--format <table|json>]
  calendar show                   Print the calendar config (timezone, working days, holidays)
  status <list|add|edit|rm|reorder> ...
                                   Edit workflow statuses. add <key> --label --category
                                   <pending|active|completed|discarded> [--default][--icon][--color];
                                   rm <key> [--remap-to <key>]; reorder <key,key,...>
                                   --color takes #rrggbb, palette:<id> (see 'loctt palette'),
                                   or light:#rrggbb,dark:#rrggbb; '-' clears it on edit
  priority <list|add|edit|rm|reorder> ...
                                   Edit workflow priorities (NO --value; reorder sets value).
                                   rm <key> [--remap-to <key>]; reorder <key,key,...>
  task-type <list|add|edit|rm|reorder> ...
                                   Edit workflow task types. rm <key> [--remap-to <key>]
  relationship <list|add|edit|rm> ...
                                   Edit workflow relationships (no reorder). add <key> --label
                                   [--kind <directional|symmetric>][--inverse][--inverse-label]
                                   [--graph <none|acyclic|tree>][--ranked]; rm <key> [--remap-to <key>]
  custom-field <list|add|edit|rm|value> ...
                                   Edit custom fields. add <key> --label --type
                                   <string|number|date|boolean|enum> [--multi][--searchable]
                                   [--task-types a,b]; rm <key> (clear-only, NO --remap-to)
                                   value <field> <add|edit|rm|reorder>  (enum values;
                                   rm <key> [--remap-to <key>])
  board-column <list|add|edit|rm|reorder> ...
                                   Edit board columns. add <key> --label --statuses <s,s,..>
                                   [--wip <n>]; reorder <key,key,...>
  estimation <show|set>            Edit estimation config. set [--enabled][--unit <u>]
                                   [--unit-label][--scale <free|linear|fibonacci>]
                                   [--preset a,b,c][--weight key=n]...
  timeline <show|set>              Edit timeline config. set [--dependency-relationship <key|->]
                                   [--default-zoom <day|week|month>][--show-arrows]
                                   [--default-grouping <builtin|field.key>]
  rerank <source> <relationship> <target> [--before <task>] [--after <task>]
  board-rerank <task> [--before <task>] [--after <task>]
  board-move <task> [--status <s>] [--before <task>] [--after <task>]
                                   moves column and position in ONE write
  create <title> [--project <key>] [--status <s>] [--priority <p>] [--type <t>]
                                   [--assignee <u>] [--reporter <u>] [--due <d>]
                                   [--start <d>] [--estimate <e>] [--milestone <m>]
                                   [--sprint <s>] [--label <l>]... [--body <text>]
  list [--query <q>] [--view <v>] [--limit <n>] [--archived] [--project <key>]
                                   [--sort <field>] [--dir <asc|desc>] [--offset <n>]
                                   --archived: include archived tasks
                                   (hidden by default; saved views are respected as authored)
  show <task>
  export [--format <csv|json>] [--query <q>] [--view <v>] [--project <key>]
    [--columns <a,b,c>] [--body] [--archived] [--output <file>]
                                   Export tasks as CSV or JSON (default csv).
                                   Filters mirror 'list'; writes to stdout unless
                                   --output is given. CSV is a report, not a backup
                                   (use 'backup' to protect against data loss).
  set <task> <field> <value>
  unset <task> <field>
  link <task> <relationship> <target>
  unlink <task> <relationship> <target>
  archive <task>                   Soft-delete (reversible). Use 'delete' to permanently remove.
  unarchive <task>
  delete <task> [--yes]             Permanent removal; use 'archive' for the reversible alternative
  body <task> [--set <text>] [--append <text>] [--expect <token>] [--token]
                                   --token prints the current body token; pass it back
                                   as --expect to refuse a write that would overwrite a
                                   concurrent edit (off by default)
  log <task> [--limit <n>] [--offset <n>]
  duplicate <task> [--title <t>] [--project <name|id>]
                                   Copy field values and body to a new key.
                                   Relationships and attachments are not copied.
  move <task>[,<task>...] <project>
                                   Reallocate the key under another project; the
                                   old key is retired to key_history and keeps resolving
  comment <task> <text>            Add a comment as the current user
  comments <task>                  List a task's comments, oldest first
  comment-edit <task> <comment-id> <text>
  comment-delete <task> <comment-id> [--yes]
                                   Permanent; the text stays in history (M3)
  attach <task> <file-path> [--force]
  detach <task> <name>
  mcp                              Start the MCP server (stdio)
  ui [--port <n>] [--no-open]      Start the web UI (foreground)
  git <enable|disable|status|publish|sync>
  config <get|set|unset|list> [key] [value]
  config usage                     Count tasks referencing each workflow key
  migrate [--yes] [--dry-run]      Upgrade the tracker schema to the current version
  backup <file> [--no-history]     Write a whole-tracker JSONL backup
  restore <file...>                Restore a backup. Bare refuses a non-empty tracker;
    [--merge | --overwrite]        --merge adds only absent ids, --overwrite replaces
    [--dry-run]                    the ids the backup carries (preserving displaced bodies)

Common flags:
  --yes                            Skip confirmation prompts on destructive operations
                                   (delete, migrate). Required in non-interactive contexts.
  --remap-to <key|id>              On hard-delete of a project/label/milestone/sprint/user,
                                   migrate affected task references to the named target
                                   instead of clearing them.
  --unassign                       On 'loctt user delete', clear assignee/reporter on
                                   affected tasks. Mutually exclusive with --remap-to.
`);
}

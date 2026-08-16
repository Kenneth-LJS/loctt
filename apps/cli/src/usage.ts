/**
 * Top-level `loctt` usage text. Printed on `help`, `--help`, `-h`,
 * or any unrecognized command.
 *
 * Lives in its own module so adding a new command means touching
 * (at most) two files: the command implementation under
 * `commands/` and the relevant line here.
 */

export function usage(): void {
  console.log(`Usage: loctt [--cwd <dir>] <command> [options]

Global options:
  --cwd <dir>                      Operate against the tracker rooted
                                   at <dir> instead of the current
                                   working directory.

Commands:
  init [--repair] [--prefix <prefix>] [--project-label <label>] [--no-docs]
                                   --repair: restore files missing from an existing
                                   .loctt/ without touching what survived
                                   [--timezone <IANA tz>]  Workspace timezone; defaults to this
                                   machine's zone. Decides what "today" means in queries.
  info
  doctor [--rebuild-index]         Run diagnostic checks; with --rebuild-index, rebuild
                                   the key-lookup cache after out-of-band frontmatter edits
  views                            List saved views from queries.yaml
  schema                           Show the workflow config (statuses, priorities, etc.)
  project <list|create|edit|archive|unarchive|delete|set-default> ...
                                   list --all: include archived projects
                                   delete: permanent (remap_to required if tasks exist; use 'archive' for soft)
  user <list|current|switch|create|edit|archive|unarchive|delete> ...
                                   delete: permanent (use 'archive' for the reversible alternative)
  label <list|create|edit|archive|unarchive|delete> ...
                                   list --all: include archived labels
                                   delete: permanent (drops key from every task; use 'archive' for soft)
  milestone <list|create|edit|archive|unarchive|delete> ...
                                   list --all: include archived milestones
                                   delete: permanent (clears milestone field on tasks; use 'archive' for soft)
  sprint <list|create|edit|archive|unarchive|delete|burndown> ...
                                   list --all: include archived sprints
                                   delete: permanent (clears sprint field on tasks; use 'archive' for soft)
                                   burndown <key> [--format <table|json>]
  calendar show                   Print the calendar config (timezone, working days, holidays)
  rerank <source> <relationship> <target> [--before <task>] [--after <task>]
  board-rerank <task> [--before <task>] [--after <task>]
  create <title> [--project <key>] [--status <s>] [--priority <p>] [--type <t>]
  list [--query <q>] [--view <v>] [--limit <n>] [--archived] [--project <key>]
                                   --archived: include archived tasks
                                   (hidden by default; saved views are respected as authored)
  show <task>
  set <task> <field> <value>
  unset <task> <field>
  link <task> <relationship> <target>
  unlink <task> <relationship> <target>
  archive <task>                   Soft-delete (reversible). Use 'delete' to permanently remove.
  unarchive <task>
  delete <task> [--yes]             Permanent removal; use 'archive' for the reversible alternative
  body <task> [--set <text>] [--append <text>]
  log <task> [--limit <n>]
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
  migrate [--yes] [--dry-run]      Upgrade the tracker schema to the current version

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

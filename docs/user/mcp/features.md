# MCP features

A narrative tour of LocTT features through the MCP server — i.e., how an AI coding agent (Claude Code, Cursor, etc.) sees and uses LocTT. For an exhaustive tool list, see [reference.md](reference.md). For how to wire MCP up in the first place, see [Getting Started → MCP Setup](../common/getting-started.md#mcp-setup-ai-agent-integration). To shape your agent's behaviour with project-specific instructions, see [agent-setup.md](agent-setup.md).

For the same features through other interfaces, see [Web UI features](../ui/features.md) or [CLI features](../cli/features.md).

This page is written for two audiences: developers who want to understand what their agent can do, and agents themselves discovering capabilities.

## Tasks

The MCP server exposes structured tools, not raw file access. Agents create tasks with `create_task`, fetch them with `get_task`, list them with `list_tasks`, and update fields with `update_task`. Field validation happens server-side, so an agent can't write an invalid status or unknown priority.

`unset_field` removes a field (the equivalent of `loctt unset` on the CLI).

## Markdown body

There are three distinct tools for the body, chosen deliberately:

- `append_task_body` — adds to the end; safe for collaborative use.
- `replace_task_body` — overwrites entirely; use sparingly.
- (Reading happens via `get_task`.)

Splitting append and replace lets agents extend a task's notes without risk of clobbering human-written context. Treat `replace_task_body` as a destructive operation.

## Relationships

`link_tasks` creates a typed, directed link between two tasks. `unlink_tasks` removes it. `reorder_relationship` reorders a relationship's targets within a task (useful for ordered subtask lists).

The available relationship kinds (`blocks`, `depends_on`, `parent`, plus any custom ones) come from `workflow.yaml`. Agents can discover them via `get_workflow_config`.

## Attachments

`attach_file` adds a file from a path on disk. `detach_file` removes it.

> **Security note.** `attach_file` accepts any absolute path the MCP server process can read — including paths outside the repo. **Do not auto-approve `attach_file` calls in your agent's permission settings.** See [agent-setup.md → Permissions and auto-approval](agent-setup.md#permissions-and-auto-approval).

## Activity log

`get_task_history` returns the audit trail for a task — every field change, link, body edit, archive event, with timestamps and actor.

Agents should use this when answering "what changed?" questions instead of guessing from the current state.

## Archive and delete

Two distinct operations, intentionally separate:

- `archive_task` / `unarchive_task` — soft-delete, reversible. The default move when something is no longer relevant.
- `delete_task` — permanent. Agents should generally not call this without explicit user instruction.

By default `list_tasks` omits archived tasks. Pass an explicit flag to include them.

## Query language

`list_tasks` accepts a `query` parameter using the same expression language as the CLI:

```
status = in_progress and priority = high
text ~ login
assignee = ken and not status = done
```

See [query-language.md](../common/query-language.md) for the grammar. Agents should prefer queries over fetching all tasks and filtering client-side.

## Saved views

`list_views` returns the named queries from `.loctt/config/queries.yaml`. `list_tasks` accepts a `view` parameter to run one by name. Useful when an agent should respect the user's existing filter conventions instead of inventing new ones.

## Projects

Full CRUD via `list_projects`, `create_project`, `edit_project`, `archive_project`, `unarchive_project`, `delete_project`, and `set_default_project`. Each project carries its own key prefix and counter.

When the workspace has multiple projects, agents should ask which one a new task belongs to, or honour the default project.

## Users

`list_users`, `get_current_user`, `switch_user`, `create_user`, `edit_user`, `archive_user`, `unarchive_user`, `delete_user`.

`get_current_user` is particularly useful — agents should call it when handling "my tasks" or "tasks assigned to me" requests rather than asking the user to type their name.

## Labels

`list_labels`, `create_label`, `edit_label`, `archive_label`, `unarchive_label`, `delete_label`. Labels themselves are managed through these tools; applying them to a task happens via `update_task` with a `labels` field.

## Sprints

`list_sprints`, `create_sprint`, `edit_sprint`, `archive_sprint`, `unarchive_sprint`, `delete_sprint`. Sprint state (`future`, `active`, `completed`) is updated via `edit_sprint`. Assignment to a task is via `update_task`.

## Milestones

Same shape as sprints: `list_milestones`, `create_milestone`, `edit_milestone`, `archive_milestone`, `unarchive_milestone`, `delete_milestone`.

## Custom fields

Custom fields show up as regular fields on tasks. Agents discover them via `get_workflow_config`, set them via `update_task`, and query them via `list_tasks` with a query string. No separate tool needed.

## Configurable workflow

`get_workflow_config` returns the live workflow: statuses, priorities, task types, relationship kinds, and custom fields. **Agents should call this at the start of a session** so they use the workspace's actual vocabulary (e.g., the user's `priorities` might not include "medium").

The workflow itself is edited as a YAML file, not through MCP tools — workflow edits are a deliberate human action, not an agent action.

## Calendar

`get_calendar` returns timezone, working days, and holidays. Useful when reasoning about due dates or "by end of week" requests.

## Git sync

`enable_git`, `disable_git`, `get_git_status`, `publish_to_git`, `sync_from_git`.

Agents should generally not publish or sync without explicit user instruction — these are user-facing operations that affect shared state.

## Diagnostics and migration

`doctor` and `info` are exposed as tools. There is no MCP equivalent of `migrate` — schema migrations are an intentional human action gated by version checks.

## Configuration values

`list_config_values`, `get_config_value`, `set_config_value`, `unset_config_value`. These manage the machine-local config (e.g. git sync settings) — not the workspace workflow.

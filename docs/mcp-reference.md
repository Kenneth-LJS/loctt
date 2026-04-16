# MCP Reference

LocTT's MCP server provides structured tools for AI agents to manage tasks via the Model Context Protocol.

## Tools

### Query Tools

#### `get_task`

Get a task by key or ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key (e.g., `T-1`) or ID |
| `include_body` | boolean | no | Include the markdown body (default: `true`) |

Returns frontmatter fields, attachments list, and optionally the body.

#### `list_tasks`

List tasks with optional filtering.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Ad hoc query string |
| `view` | string | no | Named saved view |
| `limit` | number | no | Max results (default: 30) |

Returns key, title, status, and priority for each matching task.

#### `list_views`

List saved views from `queries.yaml`. No parameters.

#### `get_config`

Get the workflow configuration. No parameters.

### Mutation Tools

#### `create_task`

Create a new task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Task title |
| `status` | string | no | Status key |
| `priority` | string | no | Priority key |
| `task_type` | string | no | Task type key |
| `body` | string | no | Initial markdown body |

#### `update_task`

Set a field on a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `field` | string | yes | Field name |
| `value` | any | yes | Value to set |

#### `unset_field`

Remove a field from a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `field` | string | yes | Field to remove |

#### `append_task_body`

Append text to a task's markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `text` | string | yes | Text to append |

#### `replace_task_body`

Replace a task's entire markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `body` | string | yes | New body content |

#### `archive_task` / `unarchive_task`

Archive or unarchive a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |

#### `delete_task`

Permanently delete a task. Requires explicit confirmation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `confirm` | boolean | yes | Must be `true` to proceed |

### Relationship Tools

#### `link_tasks`

Add a relationship between tasks.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Source task key or ID |
| `type` | string | yes | Relationship type (e.g., `parent`, `blocks`) |
| `target` | string | yes | Target task key or ID |

#### `unlink_tasks`

Remove a relationship between tasks. Same parameters as `link_tasks`.

## Agent Guidelines

- Use MCP tools for all metadata operations. Do not edit `task.md` frontmatter directly.
- The markdown body is editable via `append_task_body` and `replace_task_body`.
- If a structured operation fails validation, do not bypass it by editing the file directly.
- Use `get_config` to discover available statuses, priorities, task types, and relationships before setting values.

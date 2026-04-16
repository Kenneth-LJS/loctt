# CLI Reference

## Initialization and Info

### `loctt init`

Set up a new `.loctt/` directory with default configuration.

```
loctt init [--prefix <prefix>] [--no-docs] [--yes]
```

| Flag | Description |
|---|---|
| `--prefix <prefix>` | Key prefix (default: `T-`) |
| `--no-docs` | Skip generating helper docs in `.loctt/docs/` |
| `--yes` | Accept all defaults without prompting |

### `loctt info`

Display tracker status: task count, key prefix, configured statuses, next key number.

### `loctt doctor`

Run diagnostic checks on the `.loctt/` setup. Exits with code 1 if any check fails.

## Task Management

### `loctt create`

Create a new task.

```
loctt create <title> [--status <s>] [--priority <p>] [--type <t>]
```

All flags are optional. Status defaults to `not_started` if omitted.

### `loctt show`

Display a task's full details: metadata, relationships, attachments, and body.

```
loctt show <task>
```

`<task>` can be a key (e.g., `T-1`) or an ID.

### `loctt list`

List tasks with optional filtering.

```
loctt list [--query <q>] [--view <v>] [--limit <n>]
```

| Flag | Description |
|---|---|
| `--query <q>` | Ad hoc query string (see [query-language.md](query-language.md)) |
| `--view <v>` | Named saved view from `queries.yaml` |
| `--limit <n>` | Max results (default: 30) |

Without `--query` or `--view`, lists the most recent 30 tasks.

### `loctt set`

Set a field on a task.

```
loctt set <task> <field> <value>
```

Works for both built-in fields (`status`, `priority`, etc.) and custom fields.

### `loctt unset`

Remove a field from a task.

```
loctt unset <task> <field>
```

### `loctt body`

View or update a task's markdown body.

```
loctt body <task> [--set <text>]
```

Without `--set`, prints the current body. With `--set`, replaces it.

## Relationships

### `loctt link`

Create a relationship between two tasks.

```
loctt link <task> <relationship> <target>
```

Example: `loctt link T-5 blocks T-8`

### `loctt unlink`

Remove a relationship between two tasks.

```
loctt unlink <task> <relationship> <target>
```

## Lifecycle

### `loctt archive`

Archive a task. This is the safe, reversible removal path.

```
loctt archive <task>
```

### `loctt unarchive`

Restore an archived task.

```
loctt unarchive <task>
```

### `loctt delete`

Permanently delete a task. Requires `--force`.

```
loctt delete <task> --force
```

## Git Sync

These commands manage optional git-backed mode. See [git-sync.md](git-sync.md).

```
loctt git enable
loctt git disable
loctt git status
loctt publish
loctt sync
loctt reconcile status
loctt reconcile continue
loctt reconcile abort
```

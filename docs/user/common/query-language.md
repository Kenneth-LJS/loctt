# Query Language

LocTT uses a Jira-inspired query language for filtering tasks.

## Basic Syntax

```
<field> <operator> <value>
```

Examples:

```
status = in_progress
priority != low
due_date < 2026-05-01
text ~ "init"
```

## Operators

| Operator | Description |
|---|---|
| `=` | Equals |
| `!=` | Not equals |
| `<` | Less than |
| `<=` | Less than or equal |
| `>` | Greater than |
| `>=` | Greater than or equal |
| `in` | Value in list |
| `not in` | Value not in list |
| `~` | Contains (text search) |

## Logical Operators

Combine conditions with `and`, `or`, and `not`. Use parentheses for grouping.

```
status = in_progress and priority = high
status in (in_progress, blocked) or priority = high
not archived = true
(status = done or status = discarded) and priority = high
```

## Values

- Strings: `"quoted"` or bare words (e.g., `in_progress`)
- Lists: `(value1, value2, value3)`
- Literals: `true`, `false`, `today`

### `today`

`today` resolves to the current calendar date in the **workspace**
timezone from `.loctt/config/calendar.yaml` — not the timezone of the
machine running the query. Two people in different places get the same
results from the same query, and the CLI, MCP, and web UI all agree.

Trackers without a `calendar.yaml` fall back to UTC. See
[`loctt init --timezone`](../cli/reference.md#loctt-init).

Task dates are plain calendar dates (`YYYY-MM-DD`), so `due_date <
today` compares dates, not instants.

## Special Aliases

| Alias | Description |
|---|---|
| `text` | Full-text search across all searchable fields (title, built-in text fields, searchable custom fields). Does not include attachment contents or filenames. |
| `parent` | Filter by parent task — accepts task keys (e.g., `parent = T-5`) |

## Relationship Filtering

Queries can filter on relationship edges (type and target task):

```
relationship.type = blocks
relationship.target = T-10
```

## Saved Views

Define reusable queries in `.loctt/config/queries.yaml`:

```yaml
queries:
  - name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc
```

Use saved views via CLI (`loctt list --view recent-open`) or MCP (`list_tasks` with `view` parameter).

Sort entries use `field` + `direction` (`asc` or `desc`). Multiple sort fields are applied in order.

## Errors

A query that references something the tracker doesn't have is rejected
rather than quietly matching nothing:

```
$ loctt list --query "stat = done"
Error: unknown field "stat" at position 0 — did you mean "status" or "status_updated_at"?

$ loctt list --query "status = frobnik"
Error: unknown status value "frobnik" at position 0
```

Four cases are distinguished, because they mean different things:

| Situation | Result |
|---|---|
| Unknown field name | Error, with suggestions |
| Unknown `fields.<key>` custom field | Error, listing declared custom fields |
| Known field, unknown enum value | Error, listing valid values |
| Valid query that matches no tasks | **Not an error** — an empty result |

The last row is the point of the other three. Without validation, a
typo and a genuinely empty result look identical, and "no tasks found"
reads as an answer when it's actually a mistake.

Enum values and custom field keys are only checked when workflow config
is available; field names are always checked.

### Saved views

Saved views are more lenient. A view that references a custom field
deleted after the view was written still runs, and reports a warning
instead of failing:

```
$ loctt list --view stale
Warning: saved view "stale" — unknown custom field "gone_field" at position 0
No tasks found.
```

The warning goes to stderr (so piping `loctt list` is unaffected) and
the exit code stays 0. MCP returns the same warning in the response
body. The reasoning: breaking a view that used to work would be worse
than running it, but silently returning fewer results than its author
intended is what the validation exists to prevent.

Passing `--query` alongside `--view` means the query is yours, not the
view's, so a typo in it is an error rather than a warning.

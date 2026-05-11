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

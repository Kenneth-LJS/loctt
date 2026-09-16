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
| `is empty` | The field has no value (unset, empty list, or blank) |
| `is not empty` | The field has a value |
| `is null` | Synonym for `is empty` |
| `is not null` | Synonym for `is not empty` |

To filter by whether a field is set, use `is empty` / `is not empty` —
for example `milestone is empty` (tasks with no milestone) or
`assignee is not empty` (assigned tasks). `is null` / `is not null` are
accepted as synonyms, for anyone who reaches for the SQL/JQL spelling.
These take no value on the right. Writing `field = null` is rejected with
a pointer to `is empty`, because a bare `null` compared with `=` would be
treated as ordinary text and match nothing useful.

## Logical Operators

Combine conditions with `and`, `or`, and `not`. Use parentheses for grouping.

```
status = in_progress and priority = high
status in (in_progress, blocked) or priority = high
not archived = true
(status = done or status = discarded) and priority = high
```

The word forms are the only forms. `&&`, `||` and `!` are rejected, with
a message naming the word to use instead — they are common enough to
reach for that failing silently on them would be worse than failing.

Dates are validated, not just shape-checked: `2024-13-45` is an error,
not a query that matches nothing.

## Values

- Strings: `"quoted"` or bare words (e.g., `in_progress`)
- Lists: `(value1, value2, value3)`
- Literals: `true`, `false`, `today`
- Functions: `currentUser()`; date functions `now()`, `startOfDay()`,
  `startOfWeek()`, `startOfMonth()`, `endOfDay()`, `endOfWeek()`,
  `endOfMonth()`

### `today`

`today` resolves to the current calendar date in the **workspace**
timezone from `.loctt/config/calendar.yaml` — not the timezone of the
machine running the query. Two people in different places get the same
results from the same query, and the CLI, MCP, and web UI all agree.

Trackers without a `calendar.yaml` fall back to UTC. See
[`loctt init --timezone`](../cli/reference.md#loctt-init).

Task dates are plain calendar dates (`YYYY-MM-DD`), so `due_date <
today` compares dates, not instants. A date field that happens to carry
a time (a stored ISO-8601 timestamp) is still compared by its calendar
day, so a task due today at any time matches `due_date = today` and
`due_date <= today`, and is not counted as `due_date > today`.

### `currentUser()`

`currentUser()` resolves to the id of whoever runs the query, so a saved
view like `assignee = currentUser()` means "assigned to me" for each
person who opens it — the web signed-in user, the CLI's configured user
(`loctt whoami` / the current-user file), or the MCP caller. The bare
form `currentUser` (no parentheses) is accepted too.

```
assignee = currentUser()
reporter = currentUser() and status != done
```

When no current user is set, `currentUser()` matches **nothing** rather
than every unassigned task — an empty result is safer than silently
matching the wrong rows.

### Date functions

Date functions resolve against the same workspace clock as `today`, so
they give the same answer on the CLI, MCP, and web UI.

| Function | Resolves to |
|---|---|
| `startOfDay()` / `endOfDay()` | Today's calendar date |
| `startOfWeek()` / `endOfWeek()` | The first / last day of the current week |
| `startOfMonth()` / `endOfMonth()` | The first / last day of the current month |
| `now()` | The current instant (a full timestamp) |

The `startOf`/`endOf` functions resolve to a **calendar date** and are
compared by day, exactly like `today`. `now()` resolves to a **timestamp**
and is meant for the event-time fields (`created_at`, `updated_at`); it is
rejected on calendar-date fields like `due_date` (use `today` or
`startOfDay()` there).

Each `startOf`/`endOf` function takes an optional **signed offset** — a
sign (`+`/`-`), a number, and a unit (`d` days, `w` weeks, `m` months):

```
due_date < today                                        # overdue
due_date >= startOfWeek() and due_date <= endOfWeek()   # due this week
due_date >= startOfMonth() and due_date <= endOfMonth() # due this month
due_date <= endOfWeek("+1w")                            # due by end of next week
updated_at >= startOfDay("-7d")                         # touched in the last 7 days
```

The week's first day comes from `first_day_of_week` in
`.loctt/config/calendar.yaml` (Monday by default), so `startOfWeek()`
respects how the workspace defines a week.

## Special Aliases

| Alias | Description |
|---|---|
| `text` | Substring search across the title, built-in text fields, the task **body**, and custom fields declared `searchable: true`. A custom field with `searchable: false` is excluded — it stays directly queryable by `fields.<key>`. Does not include attachment contents or filenames. Only the `~` operator is supported: write `text ~ term`. Any other operator (`=`, `!=`, `<`, `in`, …) is rejected, because a substring alias has no exact-match or ordering meaning. |
| `parent` | Filter by parent task — accepts task keys (e.g., `parent = T-5`) |

## Relationship Filtering

Two functions cover link queries:

```
has_link("blocks")                 # blocks something
has_link("blocked_by")             # is blocked by something
has_link("blocks", "T-2")          # blocks T-2 specifically
has_link()                         # has any link at all
not has_link()                     # orphan — no links
link_count("child") > 3            # more than 3 children
parent = T-5                       # child of T-5
```

Arity picks the question. `has_link(kind)` tests whether an edge of that
kind exists; `has_link(kind, target)` tests for a **single edge matching
both**.

`link_count(kind)` yields a number, so it takes the numeric operators —
`=`, `!=`, `<`, `<=`, `>`, `>=`. Comparing it against a list
(`link_count("child") in (1, 2)`) is rejected: it could never match, and
before it was rejected it returned nothing, which looks exactly like
"no tasks have that many children".

### One edge, not two

That two-argument form is the point. There is deliberately no way to
write the kind and the target as separate conditions, because doing so
reads as one edge and means something else.

Given a task with `blocks → T-20` and `parent → T-10`:

| Query | Matches | Why |
|---|---|---|
| `has_link("blocks", "T-10")` | no | no single edge is *(blocks, T-10)* |
| `has_link("blocks") and has_link("parent", "T-10")` | yes | and it says so plainly — two separate facts |

The older `relationship.type = blocks and relationship.target = T-10`
matched the task above while appearing to mean "blocks T-10". That form
is removed; queries using it fail with an error naming the replacement.

### Kind names are values, not fields

Kinds are always quoted arguments, never part of the field name. A
workspace may therefore name a relationship `type`, `target`, `count` or
anything else without colliding with the grammar — `has_link("type")` is
an ordinary query.

Targets match on either the stored ULID or the current key, so
`has_link("blocks", "T-10")` works with the reference you actually type.

### Both directions are queryable

**Each task stores its own outbound edges.** Linking `A blocks B` writes a
`blocks` edge on A **and** a `blocked_by` edge on B. So "what blocks T-2"
is an ordinary forward lookup on the inverse key:

- `has_link("blocks")` matches **A only** — B holds `blocked_by`.
- `has_link("blocked_by", "T-2")` finds the tasks blocked by T-2.
- For a symmetric kind (`kind: symmetric`, e.g. `relates_to`) both tasks
  hold the same edge type, so both match. There is no source/target
  distinction to worry about.

Negation composes as normal: `not has_link("blocks", "T-2")` is true when
no edge blocks T-2.

### Not supported

These need either a subquery or a graph walk, and are deliberately out of
scope so evaluation stays per-task:

| Question | Why not |
|---|---|
| "blocks anything still open" | needs a subquery |
| "everything transitively blocked by T-1" | needs a graph walk |
| "epics with at least one blocked child" | needs a cross-task rollup |

## Saved Views

Define reusable queries in `.loctt/config/queries.yaml`:

```yaml
queries:
  - id: 01JCQ8ZKB4D6F8H0K2M4P6R8T0
    name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - id: 01JCQ8ZKD6G8J0L2N4Q6S8U0W2
    name: blocked
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
| `text` with any operator but `~` | Error — `text` is substring search, use `text ~ <term>` |
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

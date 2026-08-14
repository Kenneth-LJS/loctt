# Configuration

All workflow configuration lives in `.loctt/config/workflow.yaml`. LocTT ships with sensible defaults — customize as needed.

## Key Prefix

```yaml
key:
  prefix: T-
```

Change the prefix to suit your project (e.g., `BUG-`, `FEAT-`, `PROJ-`).

## Statuses

Each status has a `key` (stored in task data), a `label` (display name), and a `category` (semantic grouping).

```yaml
statuses:
  - key: not_started
    label: Not started
    category: pending
  - key: in_progress
    label: In progress
    category: active
  - key: in_review
    label: In review
    category: active
  - key: blocked
    label: Blocked
    category: active
  - key: done
    label: Done
    category: completed
  - key: wont_do
    label: Won't do
    category: discarded
```

Categories: `pending`, `active`, `completed`, `discarded`. Every status must belong to one.

## Priorities

```yaml
priorities:
  - key: low
    label: Low
    value: 1
  - key: medium
    label: Medium
    value: 2
  - key: high
    label: High
    value: 3
  - key: critical
    label: Critical
    value: 4
```

The optional `value` field controls sort order. Without it, sorting falls back to alphabetical.

## Task Types

```yaml
task_types:
  - key: task
    label: Task
  - key: bug
    label: Bug
  - key: feature
    label: Feature
```

Task types are lightweight labels. There's no behavioral difference between them — they're for filtering and organization.

## Relationships

```yaml
relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    structural: true
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
  - key: depends_on
    label: Depends on
    inverse: required_by
    inverse_label: Required by
```

Each relationship defines a forward key/label and an inverse. When you `link T-1 blocks T-2`, LocTT stores both the `blocks` edge on T-1 and the `is_blocked_by` edge on T-2.

Setting `structural: true` marks a relationship for tree display (used by `parent`/`child`).

## Custom Fields

Declare custom fields to add project-specific metadata to tasks.

```yaml
custom_fields:
  - key: sprint
    label: Sprint
    type: enum
    multi: false
    searchable: true
    values:
      - key: sprint_1
        label: Sprint 1
        value: 1
      - key: sprint_2
        label: Sprint 2
        value: 2

  - key: team
    label: Team
    type: string
    multi: false
    searchable: true

  - key: story_points
    label: Story points
    type: number
    multi: false
    searchable: false
```

### Field Types

| Type | Description |
|---|---|
| `string` | Free text |
| `number` | Numeric value |
| `date` | Date string |
| `boolean` | `true` / `false` |
| `enum` | Constrained to declared `values` |

### Properties

| Property | Description |
|---|---|
| `multi` | Allow multiple values |
| `searchable` | Include in full-text search (default: `true`) |
| `values` | For `enum` type: allowed values with `key`, `label`, optional `value` |

Custom field values are stored under `fields:` in task frontmatter, separate from built-in fields:

```yaml
fields:
  sprint: sprint_2
  team: platform
  story_points: 5
```

## Saved Queries

Saved queries live in `.loctt/config/queries.yaml`:

```yaml
queries:
  - name: my-tasks
    query: assignee = "alice" and status != done
    sort:
      - field: priority
        direction: desc

  - name: overdue
    query: due_date < today and status != done
    sort:
      - field: due_date
        direction: asc
```

Use them with `loctt list --view my-tasks` or the `list_tasks` MCP tool.

See [query-language.md](query-language.md) for query syntax.

## Calendar

`.loctt/config/calendar.yaml` holds the workspace timezone and the
working-week shading used by the timeline view:

```yaml
timezone: Asia/Singapore
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year's Day
```

Weekday indices are `0..6` with `0 = Sunday`. `holidays` must be
present — use `[]` for none.

**`timezone` affects query results.** It decides what `today` means in
queries like the `overdue` view above, and what date is recorded in
`completed_date` when a task moves to a completed status. Because the
file is shared and committed, everyone on the tracker gets the same
answer regardless of which machine they run from — a colleague eight
hours ahead sees the same tasks in `overdue` that you do.

`first_day_of_week`, `working_days`, and `holidays` are display-only.

`loctt init` writes this file using the initializing machine's timezone;
pass `--timezone` to choose a different one. A tracker with no
`calendar.yaml` falls back to UTC rather than the local machine's zone,
so results don't silently vary per machine.

Per-user timezones on user profiles are separate and do not affect
queries.

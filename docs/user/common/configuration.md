# Configuration

All workflow configuration lives in `.loctt/config/workflow.yaml`. LocTT ships with sensible defaults — customize as needed.

## Key Prefix

```yaml
key:
  prefix: T
```

The prefix is 1–10 uppercase letters with **no dash** — the `-` separator
is inserted at key render, so a stored prefix of `T` produces keys like
`T-1`. Change it to suit your project (e.g., `BUG`, `FEAT`, `PROJ`). A
prefix containing a dash, lowercase, digit, or punctuation is rejected.

## Statuses

Each status has a `key` (stored in task data), a `label` (display name), and a `category` (semantic grouping). One status carries `default: true` — it is the status a new task gets when none is given. This is what `loctt init` creates:

```yaml
statuses:
  - key: backlog
    label: Backlog
    category: pending
    default: true
  - key: in_progress
    label: In progress
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

Listed highest to lowest. The `value` is the numeric weight used for sorting; the Settings UI recomputes these when you drag to reorder. This is what `loctt init` creates:

```yaml
priorities:
  - key: critical
    label: Critical
    value: 4
  - key: high
    label: High
    value: 3
  - key: medium
    label: Medium
    value: 2
  - key: low
    label: Low
    value: 1
```

## Task Types

```yaml
task_types:
  - key: story
    label: Story
  - key: bug
    label: Bug
  - key: task
    label: Task
  - key: spike
    label: Spike
  - key: feature
    label: Feature
```

Task types are lightweight labels. There's no behavioral difference between them — they're for filtering and organization.

## Estimation

A task can carry an `estimate`. Estimation is on by default; the unit and label are configured under the `estimation` block (Settings → Workflow → Estimation in the UI):

```yaml
estimation:
  enabled: true
  unit: points        # points | hours | days | custom_numeric | custom_enum
  unit_label: pts     # display suffix; required for the custom_* units
  scale: free         # free | linear | fibonacci
```

- **`enabled: false`** hides the Estimate field everywhere (task detail, the create dialog, the list column).
- **`unit`** sets what the numbers mean; `unit_label` is the suffix shown beside them.
- **`custom_enum`** takes a `preset_values` list (e.g. `S, M, L, XL`) instead of raw numbers, and an optional `weights` map for weighted burndown.

The `estimate` value itself is **free-form** — LocTT stores whatever you enter and does not check it against the unit or scale. Sprint [burndown](../cli/reference.md#sprints) sums numeric estimates for its chart; a value it can't read as a number simply counts as zero there, so keep estimates in the unit you configured.

## Relationships

This is what `loctt init` creates:

```yaml
relationships:
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
    graph: acyclic
    ranked: true
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    graph: tree
    ranked: true
  - key: clones
    label: Clones
    inverse: is_cloned_by
    inverse_label: Is cloned by
  - key: duplicates
    label: Duplicates
    inverse: is_duplicated_by
    inverse_label: Is duplicated by
  - key: causes
    label: Causes
    inverse: is_caused_by
    inverse_label: Is caused by
  - key: relates_to
    label: Relates to
    kind: symmetric
```

Each relationship defines a forward key/label and an inverse. When you `link T-1 blocks T-2`, LocTT stores both the `blocks` edge on T-1 and the `is_blocked_by` edge on T-2.

`graph` constrains the shape of a relationship's graph:

| Value | Meaning |
|---|---|
| `none` | No restriction. The default when omitted. |
| `acyclic` | Cycles are rejected when linking. |
| `tree` | Cycles are rejected **and** this relationship may be drawn as a tree axis. |

So the default `parent` is a `tree` axis and `blocks` is `acyclic`. Any number of relationships may be `tree`; views pick which axis to draw rather than the config deciding for them. `ranked: true` lets a relationship's targets be ordered relative to each other (see `loctt rerank`).

Symmetric relationships are never `tree`: a symmetric edge is a
two-node cycle by definition.

A relationship is either **directional** — it declares `inverse` and
`inverse_label`, and linking writes an edge on both tasks — or
**symmetric**, declared with `kind: symmetric` and no `inverse`. Declaring
an `inverse` equal to the key is rejected; use `kind: symmetric` instead.

## Custom Fields

Declare custom fields to add project-specific metadata to tasks.

```yaml
custom_fields:
  - key: risk
    label: Risk
    type: enum
    multi: false
    searchable: true
    values:
      - key: low
        label: Low
        value: 1
      - key: high
        label: High
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

  - key: severity
    label: Severity
    type: enum
    multi: false
    searchable: true
    # Scoped: this field appears only on tasks of type `bug`.
    task_types:
      - bug
    values:
      - key: minor
        label: Minor
      - key: major
        label: Major
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

| Property | Required | Description |
|---|---|---|
| `multi` | yes | Allow multiple values |
| `searchable` | yes | Whether the field is exposed to the query DSL |
| `values` | for `enum` | Allowed values with `key`, `label`, optional `value` |
| `task_types` | no | Scope the field to specific task types. Omit it and the field is global (shows for every type). Listed, and it appears only on tasks whose type is in the list. A value already stored in a field that is out of scope for the task's current type is kept and shown read-only — never hidden or auto-removed. |

> `searchable` has **no default** — omitting it is a parse error, so you
> always state whether a field is queryable.

Custom field values are stored under `fields:` in task frontmatter, separate from built-in fields:

```yaml
fields:
  sprint: sprint_2
  team: platform
  story_points: 5
```

## Saved views

Saved views live in `.loctt/config/queries.yaml`:

```yaml
queries:
  - id: 01JCQ8ZK7YV3W5N2M4P6R8T0XA
    name: my-tasks
    query: assignee = "alice" and status != done
    sort:
      - field: priority
        direction: desc

  - id: 01JCQ8ZK9B2H4K6M8P0R2T4V6X
    name: overdue
    query: due_date < today and status != done
    sort:
      - field: due_date
        direction: asc
```

Use them with `loctt list --view my-tasks` or the `list_tasks` MCP tool.

`id` is required and must be unique — it is how a view stays addressable
when two views share a name. Views created through LocTT get one
automatically; hand-written entries need one supplied.

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

**Changing `timezone` rewrites nothing already stored.** Task
`due_date` and `start_date` are date-only fields and are unaffected by
a timezone change; only datetimes such as `created_at` and
`updated_at` change how they are *displayed*. Reverting to the
previous zone restores the previous display exactly.

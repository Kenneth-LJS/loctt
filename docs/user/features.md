# Features

A tour of what LocTT can do, with links to how each feature works in each interface. If you haven't yet, skim [Concepts](common/concepts.md) first — this page assumes you understand what `.loctt/` is and how it's shared.

Each feature heading is followed by per-interface links so you can jump straight to how to use it where you actually work:

> **\[[UI](ui/features.md)\] | \[[MCP](mcp/features.md)\] | \[[CLI](cli/features.md)\]**

---

## Tasks

The core unit. Every task has a stable ULID `id`, a human-friendly `key` (`T-1`), a title, a status, and a free-form markdown body. Optional fields include priority, type, assignee, reporter, start date, due date, parent, custom fields, labels, sprints, milestones, and attachments.

\[[UI](ui/features.md#tasks)\] | \[[MCP](mcp/features.md#tasks)\] | \[[CLI](cli/features.md#tasks)\]

## Markdown body

Each task has a free-form markdown body. Use it for descriptions, notes, checklists, code snippets — whatever you need. No schema. Append-only updates are supported separately from full-body replacement so collaborators (and agents) don't accidentally clobber each other's notes.

\[[UI](ui/features.md#markdown-body)\] | \[[MCP](mcp/features.md#markdown-body)\] | \[[CLI](cli/features.md#markdown-body)\]

## Relationships

Tasks can link to other tasks with typed, directed relationships: `blocks`, `depends_on`, `parent`, or any custom kind you define in `workflow.yaml`. Links survive renames and key reassignment, since they're stored by ULID under the hood.

\[[UI](ui/features.md#relationships)\] | \[[MCP](mcp/features.md#relationships)\] | \[[CLI](cli/features.md#relationships)\]

## Attachments

Attach files to a task — screenshots, logs, spec PDFs, whatever. Files are stored under the task's directory in `.loctt/` and travel with the task.

\[[UI](ui/features.md#attachments)\] | \[[MCP](mcp/features.md#attachments)\] | \[[CLI](cli/features.md#attachments)\]

## Activity log

Every meaningful change to a task is recorded: field updates, link changes, body edits, archive and unarchive, label and assignment changes. View the full history at any time.

\[[UI](ui/features.md#activity-log)\] | \[[MCP](mcp/features.md#activity-log)\] | \[[CLI](cli/features.md#activity-log)\]

## Archive and delete

Archive is a soft-delete: the task is hidden from default lists but fully restorable. Delete is permanent and requires explicit confirmation. Archiving is the safe default for "I'm done with this" or "this is no longer relevant."

\[[UI](ui/features.md#archive-and-delete)\] | \[[MCP](mcp/features.md#archive-and-delete)\] | \[[CLI](cli/features.md#archive-and-delete)\]

## Query language

Filter tasks with expressions like `status = in_progress and priority = high` or `text ~ login`. Supports comparison operators, boolean logic, parentheses, and a text-search operator. See [query-language.md](common/query-language.md) for the full grammar.

\[[UI](ui/features.md#query-language)\] | \[[MCP](mcp/features.md#query-language)\] | \[[CLI](cli/features.md#query-language)\]

## Saved views

Frequently-used queries can be stored in `.loctt/config/queries.yaml` and invoked by name — `recent-open`, `my-blocked`, whatever you set up. Useful when you find yourself typing the same filter every day.

\[[UI](ui/features.md#saved-views)\] | \[[MCP](mcp/features.md#saved-views)\] | \[[CLI](cli/features.md#saved-views)\]

## Projects

One tracker can hold multiple projects. Each project has its own key prefix (`BACKEND-`, `WEB-`, etc.) and its own counter. Useful for monorepos, or for separating client work from internal work in a single tracker.

\[[UI](ui/features.md#projects)\] | \[[MCP](mcp/features.md#projects)\] | \[[CLI](cli/features.md#projects)\]

## Users

User profiles with name, email, timezone, and avatar. Used for assignee and reporter fields. Switching the "current user" affects which user shows up as the actor on log entries. Users can be archived without breaking tasks that reference them.

\[[UI](ui/features.md#users)\] | \[[MCP](mcp/features.md#users)\] | \[[CLI](cli/features.md#users)\]

## Labels

Optional, colour-coded tags applied to tasks. Lightweight, flat (no hierarchy), and configurable per workspace.

\[[UI](ui/features.md#labels)\] | \[[MCP](mcp/features.md#labels)\] | \[[CLI](cli/features.md#labels)\]

## Sprints

Time-boxed groupings of tasks. Each sprint has a name, dates, and a state (future, active, completed). Tasks can belong to a sprint via a field; the sprint definition itself is config you can edit.

\[[UI](ui/features.md#sprints)\] | \[[MCP](mcp/features.md#sprints)\] | \[[CLI](cli/features.md#sprints)\]

## Milestones

Target-date-driven groupings. Use them for releases, deliverables, or any "by date X, these things must be done" planning.

\[[UI](ui/features.md#milestones)\] | \[[MCP](mcp/features.md#milestones)\] | \[[CLI](cli/features.md#milestones)\]

## Custom fields

Define your own fields in `workflow.yaml` — `severity`, `customer`, `estimate`, anything. Custom fields have types and validation, and participate in the query language just like built-in fields.

\[[UI](ui/features.md#custom-fields)\] | \[[MCP](mcp/features.md#custom-fields)\] | \[[CLI](cli/features.md#custom-fields)\]

## Configurable workflow

Statuses, priorities, task types, and relationship kinds are all defined in `.loctt/config/workflow.yaml`. Add a `blocked_external` status, a `severity` priority scale, a `spike` task type — the vocabulary is yours. See [configuration.md](common/configuration.md).

\[[UI](ui/features.md#configurable-workflow)\] | \[[MCP](mcp/features.md#configurable-workflow)\] | \[[CLI](cli/features.md#configurable-workflow)\]

## Calendar

Per-workspace calendar settings: timezone, working days, holidays. Influences how dates are displayed and how date-based queries behave.

\[[UI](ui/features.md#calendar)\] | \[[MCP](mcp/features.md#calendar)\] | \[[CLI](cli/features.md#calendar)\]

## Git sync

Optional mode that publishes tracker state to a dedicated `.loctt` branch in your repo, separate from your code history. Includes 3-way reconciliation for concurrent edits and automatic key-collision handling. See [git-sync.md](common/git-sync.md) for the operational details, or [concepts.md](common/concepts.md) for the mental model.

\[[UI](ui/features.md#git-sync)\] | \[[MCP](mcp/features.md#git-sync)\] | \[[CLI](cli/features.md#git-sync)\]

## Diagnostics and migration

`loctt doctor` checks tracker integrity — missing files, invalid configs, inconsistent state. `loctt migrate` upgrades the tracker schema between LocTT versions with a preview before applying.

\[[UI](ui/features.md#diagnostics-and-migration)\] | \[[MCP](mcp/features.md#diagnostics-and-migration)\] | \[[CLI](cli/features.md#diagnostics-and-migration)\]

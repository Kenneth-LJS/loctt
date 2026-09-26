# CLI & MCP test cases

Acceptance criteria for the two shipped non-UI surfaces, written the same
way as [../ui-test-cases/](../ui-test-cases/): observable behaviour, not
call syntax, so they survive refactors.

These are **gaps only** — behaviour already covered by an existing test is
not restated. Each case states the finding behind it inline, including the
source location it was found at; the audit document they were originally
extracted from has been deleted as stale.

## How to read a case

```
### TSK-C1 · blocker · P4 P10 · CLI MCP
**One-sentence claim.**

- assertion
- assertion

**Given** … **When** … **Then** …
```

- **Severity** — `blocker` / `major` / `minor`, as in the UI docs.
- **Principles** — `P1`–`P10`, defined once in
  [../ui-test-cases/README.md](../ui-test-cases/README.md#first-principles).
  They govern all three surfaces.
- **Surfaces** — which front-ends the case applies to. A case tagged
  `CLI MCP` is *one* requirement verified twice, not two requirements; its
  bullets say where the two must agree and where they may legitimately
  differ (exit codes vs `isError`, flags vs parameters).
- **No milestone tags.** `M1`–`M4` schedule the web UI build. The CLI and
  MCP already exist, so these are scheduled by severity.

IDs are stable. Append, never renumber.

## Flows

Named to match `../ui-test-cases/` file-for-file, so the same feature sits
at the same filename in both trees.

| Flow | Covers | Cases |
|---|---|---|
| [flow-tasks.md](flow-tasks.md) | Create, read, update, unset, duplicate, move, export | 9 |
| [flow-list.md](flow-list.md) | Query DSL, list, sort, pagination, saved views | 6 |
| [flow-relationships.md](flow-relationships.md) | Links, inverse edges, cycle guards, attachments | 5 |
| [flow-comments-activity.md](flow-comments-activity.md) | Comments, body edits, history/activity | 8 |
| [flow-projects-users.md](flow-projects-users.md) | Project & user CRUD, current user, avatars, recents, shortcut switches | 14 |
| [flow-sprints.md](flow-sprints.md) | Sprints, burndown, board reorder | 3 |
| [flow-milestones-labels.md](flow-milestones-labels.md) | Milestones, progress, labels | 3 |
| [flow-settings.md](flow-settings.md) | Workflow config, config get/set, calendar, drift | 5 |
| [flow-onboarding.md](flow-onboarding.md) | Init, schema version, migrate, doctor, info, installing the published packages, security posture | 10 |
| [flow-git-sync.md](flow-git-sync.md) | Enable/disable, publish, sync, reconciliation, branch config | 10 |
| [flow-backup-restore.md](flow-backup-restore.md) | Backup export/import, restore, dry-run, integrity | 24 |
| [flow-degradation.md](flow-degradation.md) | Corrupt-data degradation, CLI & MCP halves | 8 |

**105 cases.**

## Why one tree, not one per surface

An earlier draft split these into `cli-test-cases/` and `mcp-test-cases/`.
That produced near-duplicate pairs — "duplicate and move are reachable from
the CLI" and "duplicate and move tools exist on MCP" are the same gap in
core, and reading either alone told you half the story.

P10 ("three front-ends, one mental model") is the principle most of these
cases defend, and it is a claim *about the relationship between surfaces*.
It cannot be tested from inside one surface's document. So the surface is a
tag on the case, not a directory.

Where a case genuinely applies to one surface only — exit-code ordering is
CLI-specific, tool-description accuracy is MCP-specific — it carries just
that tag.

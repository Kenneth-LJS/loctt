# Phase 7B — corruption full-sweep fan-out plan

Ken: full sweep, file-ownership slicing (1 agent per object-loader + 1
per surface), up to 5 agents concurrent, replenished as they finish.

## The shared contract (already built — DO NOT reinvent)

- **Per-field** corruption (one record, some fields bad): `FieldHealth`
  (`contracts/task.ts`), the tolerant `parseFrontmatter`/`readTask`
  pattern (`core/task/frontmatter.ts`). Object-fatal = identity broken.
- **Per-entry** corruption (a list, some entries bad): `BrokenEntry`
  (`contracts/health.ts`) + `collectValidEntries(rawEntries, schema,
  label, idOf?)` (`core/config/health.ts`). This is VUE-22 generalized.
  Object-fatal = the file is not even a list / outer structure malformed.
- Precedents to match exactly: `config/queries.ts` (BrokenSavedQuery),
  `config/labels.ts` `dropInvalidColors`, `task/health.ts`.

## Ground rules for EVERY agent

1. **Degrade field-local / per-entry corruption; keep object-fatal
   throwing.** One bad entry/field never blanks the whole surface
   (north-star P5). A structurally-broken file (not a list, unparseable
   YAML, broken identity) still throws with an attributed message.
2. **Preserve, never rewrite.** A corrupt value round-trips (value-
   preserved, K27) unless the write targets it. Never drop it silently.
3. **Surface it, don't hide it.** A degraded entry/field must be VISIBLE
   as needing attention on the surface — not merely "loads without
   crashing". A board card / list row / relationship edge for a corrupt
   task shows a marker; a broken config entry is listed as broken.
4. **Cross-surface parity.** Any new capability lands on web AND CLI AND
   MCP where the object is shown, and both reference docs
   (`docs/user/cli/reference.md`, `docs/user/mcp/reference.md`) updated.
5. **Mutation-first tests.** Break the behaviour, watch the test go red,
   restore. A test green with the behaviour deleted asserts nothing.
   If you must edit a green test because behaviour changed, say so.
6. **Never** `git stash`; **never** edit `docs/dev/ui-test-cases/` or
   `docs/dev/surface-test-cases/`.
7. **Stay in your lane.** Edit ONLY the files your assignment names, plus
   their tests. If you find you must touch a shared file another agent
   owns, STOP and report it — do not edit it. Report every file touched.
8. **Do NOT commit.** Leave work staged for the coordinator to verify by
   its own mutation and gate before committing.

## Object-loader agents (make the loader tolerant + surface broken)

Each owns its `config/<x>.ts` + `<x>.test.ts` (+ the contract file if the
result shape needs a `broken?: BrokenEntry[]` field, coordinated). Route
the per-entry parse through `collectValidEntries`; add `broken?` to the
config result (omitted when clean, like `QueriesConfig.broken`); keep
object-fatal + cross-entry (duplicate-id) checks throwing.

- **O1 projects** — `config/projects.ts`. NB K23 (ghost default) already
  degrades; do not regress it.
- **O2 labels** — `config/labels.ts` (already has `dropInvalidColors`;
  generalize to `collectValidEntries`).
- **O3 milestones** — `config/milestones.ts`.
- **O4 sprints-config** — `config/sprints.ts`.
- **O5 users** — `users/…` profile.yaml + settings.yaml. NB
  `.passthrough()` on settings is load-bearing (Group-G finding) — do
  not make it strict.
- **O6 workflow** — `config/workflow.ts` (statuses/priorities/types/
  relationships/custom-fields are sub-lists; a bad status entry should
  not blank the workflow).
- **O7 calendar** — `config/calendar.ts` (holidays list; SET-24
  unresolvable-timezone is object-adjacent — coordinate with existing).
- **O8 list-view** — `config/list-view.ts`.
- **O9 state** — `state.yaml` (key counters). HIGH RISK: state is
  identity-bearing; most of it may be object-fatal by nature. Assess and
  report what is degradable vs not rather than forcing degradation.

## Surface agents (make the render health-aware)

Each owns its render path + tests. A corrupt task (via `task.health`) or
corrupt config entry (via `broken`) must be VISIBLE, not just loaded.

- **S1 board** — `apps/web board` + `core/board/columns.ts`: a card for a
  task with health shows a marker.
- **S2 sprints view** — sprint columns/cards + `core/sprints`.
- **S3 list** — web list, CLI `list`, MCP `list_tasks`: a health marker
  column/indicator.
- **S4 relationship edges** — the gap already found: a related task
  corrupt in `title` shows untitled, object-fatal shows `missing:true`
  (looks deleted). Propagate health so an edge to a corrupt task reads as
  corrupt, distinct from missing. `core/task/show.ts` resolveRelationships
  + the three surfaces' relationship render.
- **S5 timeline** — `apps/web timeline` + `core` timeline.
- **S6 activity/history** — already has MalformedHistoryEntry; confirm the
  feed shows it and a corrupt task's activity opens.
- **S7 attachments** — REL-49 already degrades a bad dir; confirm a
  corrupt task's attachments panel opens.
- **S8 reconcile UI** — a corrupt side in a git reconcile.

## Verification (coordinator, not the agents)

Every agent's central guarantee is re-checked by the coordinator's OWN
mutation before commit — the Phase-7 lesson: a builder's guard test can
be vacuous. Findings that survive verification land; the rest bounce back.

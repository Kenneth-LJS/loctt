# LocTT

Local task tracker — CLI tool, MCP server, and GUI for managing tasks stored as markdown files in `.loctt/`.

## Tech Stack

- Node.js / TypeScript
- Task data: YAML frontmatter + markdown body in `.loctt/tasks/<id>/task.md`
- Config: `.loctt/config/workflow.yaml`, `.loctt/config/queries.yaml`
- State: `.loctt/state.yaml`

## Key Design Decisions

User-facing documentation lives in `docs/`. Developer documentation lives in `docs/dev/`. Cross-reference before implementing:
- `docs/dev/reference/architecture.md` — monorepo layout, data model, task identity
- `docs/dev/reference/schema-reference.md` — file formats (task.md, workflow.yaml, etc.)
- `docs/dev/reference/invariants.md` — **rules a change must not break** (project identity, key allocation, sprint state). Check against this before touching those areas
- `docs/dev/decisions.md` — locked design decisions, incl. things deliberately NOT built
- `docs/dev/process/build-loop.md` — **how a web-UI ticket gets built and verified**; the gates that decide "done"
- `docs/dev/known-gaps.md` — understood defects not yet fixed (and the roster of cases that cannot be satisfied yet); check before reporting one as new
- `docs/dev/reference/corruption-handling-guide.md` — **how to make a new field/object/surface degrade instead of crash**: the field-local-vs-object-fatal decision, the building blocks, per-thing checklists, and what to add to `doctor`. Read before adding a field or config object
- `tests/cases/ui-test-cases/` + `tests/cases/surface-test-cases/` — acceptance criteria (997 cases). Indexed in `tests/cases/case-index.json`; see `tools/README.md`
- `docs/user/cli/reference.md` — CLI commands
- `docs/user/mcp/reference.md` — MCP tools and agent guidelines

**Pre-publish work.** The pre-publish backlog is closed; what remains
before publishing is the release gate: the packaging/security blockers in
`docs/dev/process/release-readiness.md` and the UI-adoption blockers in
`docs/dev/design/design-review.md`. Each item closes only once codified as
a case + `@verifies` test + a `decisions.md` entry, not on a decision
alone. Understood-but-unfixed defects and the unsatisfiable-case roster
live in `docs/dev/known-gaps.md`. (The v1 build's run-scaffolding files
were deleted once resolved; their durable lessons are folded into the
topic docs under `docs/dev/reference/` and `docs/dev/process/`.)

**Recording decisions is part of the work, not paperwork.** A decision
that lives only in a session's context is lost at the next compaction,
and the agent after that will re-derive it differently. Before starting
work, read `decisions.md` (§ 8 agent-made, § 9 Ken's) and
`known-gaps.md`; while working, write back:

| When | Where |
|---|---|
| A call the docs did not settle | `decisions.md` § 8, six fields incl. **To revert** |
| Ken ruled on something | `decisions.md` § 9 — his, not revertible by an agent |
| A defect found but not fixed | `known-gaps.md`, with how to reproduce |
| A case that cannot be satisfied yet | `known-gaps.md` (the unsatisfiable-case entries) |
| Any core change | the CLI **and** MCP reference docs — see below |

**A capability in core is not done until CLI and MCP have it.** Core
exists so two surfaces answer the same question the same way; adding
to it for one surface is drift with a good address — a core export no
surface calls is unfinished, not done.

**Check before claiming something does not exist.** An audit claimed
milestone progress "does not exist anywhere"; it is
`computeProgress` in core, with a CLI flag and an MCP tool. That was
repeated twice before anyone looked.

**Do not stop for things you can decide.** Stop only when a call changes
scope, invents a requirement, violates a P-principle or a recorded
decision, or is load-bearing. Everything
else is decided, recorded in `docs/dev/decisions.md` § 8 with a revert
path, and you continue.

Key points:
- Tasks use `id` (internal, ULID) and `key` (user-facing, e.g. `T-123`)
- Status, priority, task_type, relationships are configurable in `.loctt/config/workflow.yaml`
- Stored enum values use config `key`s, not human labels
- Task body is free markdown; no schema-enforced structure
- MCP uses structured tools for metadata — never edit frontmatter directly
- Git-backed mode is optional; publishes to a `loctt` branch (configurable) via a temporary worktree

## Commands

```bash
npm run build        # Build all workspaces (tsc + tsup for CLI/MCP)
npm run test         # Workspace unit tests only (vitest) — does NOT cover e2e/integration
npm run test:integration  # CLI binary + MCP stdio against a real tracker
npm run test:e2e     # Full user journeys
npm run typecheck    # Type-check all workspaces
npm run lint         # Lint all workspaces (eslint)
npm run lint:fix     # Lint and auto-fix
npm run clean        # Remove dist/ from all workspaces
npx tsc --build      # Build via project references
```

## Architecture

- Monorepo with npm workspaces
  - `packages/contracts` — shared types and API shapes
  - `packages/core` — shared LocTT logic
  - `apps/cli` — CLI interface
  - `apps/mcp` — MCP server
  - `apps/web` — web app (HTTP server + API + UI)
- `.loctt/` — data directory (tasks, config, state)
- Documentation: `docs/` (user-facing), `docs/dev/` (developer)

## Git Commits

- Do NOT add "Co-Authored-By" or any AI/Claude attribution to commit messages. Ever.
- Write commit messages as if a human wrote them. No credits, no signatures.

## Development Workflow

Follow `.claude/housekeeping.md` for all work. Key principles:

1. Understand intent before implementing
2. Investigate impact on existing features
3. Identify edge cases and complications
4. THEN implement

No quick fixes. No workarounds without discussion.

## Disagreeing with a decision

**If you think a decision rests on a false premise, say so BEFORE the
decision is made — never after.**

Raising an objection after the user has chosen is worthless. It doesn't
give them a real say, and it lets you claim you mentioned it. If you catch
yourself writing "recorded for the record", "worth flagging", or "noted
with that understood" *after* an answer, you have already failed — go back
and ask the question properly.

Concretely:

- Put the objection in the question, before they answer. If a premise is
  shaky ("users will be familiar with this", "this is the fast option"),
  state plainly why you doubt it and what it costs, as part of asking.
- Put the cost in the option's own description, not in prose afterwards.
- If you only realise mid-work, **stop and ask** — do not finish and
  append a caveat.
- Once they've decided *with your objection in front of them*, implement
  it. Don't re-raise. Repeating a point you already made is its own
  failure.

The user's decision is final. Your job is to make sure it's an informed
one *at the moment it's made*.

## Recording decisions

**Never infer approval from an adjacent answer.** If you asked a question
and the user replied about something else — raised a concern, changed
scope, asked a follow-up — that question is still open. Re-ask it before
recording anything.

Specifically:

- An answer to "what scope?" is not an answer to "what shape?".
- A user picking option A in one question does not settle a different
  question you asked in the same breath.
- If you find yourself writing a decision into a doc that the user never
  stated in those terms, stop and ask.

When you do record a decision, record *what the user said*, not your
recommendation of it. If your recommendation differed, it does not go in
the file as the decision.

## Reporting your own work

- **"Decided" is not "done".** Never describe work as complete, built, or
  handled when only a decision was recorded. Say exactly what exists:
  code, tests, docs, or a note.
- When summarising a session, separate **implemented** from **recorded**
  from **still open**. If you are unsure which a thing is, check the code
  before writing the summary.
- Defects you introduce go in the summary as prominently as defects you
  found. Do not bury them.
- Verify claims against source before repeating them. An earlier finding —
  yours or an agent's — is a claim, not a fact.

## Testing Philosophy

- Tests catch bugs, not coverage metrics
- Mock only external dependencies (file system, network, timers), never business logic
- Present test strategy before implementing
- Each test should answer: "what regression would this catch?"
- **A new test must be shown to fail.** Break the behaviour it covers,
  watch that test go red, restore. A test that still passes with the
  behaviour deleted asserts nothing — and green is exactly how that hides.
- **Extending code someone else tested? Mutate their tests too.** The
  rule above covers tests you write. It misses a test file that stopped
  covering its subject when the code beneath it grew — nobody wrote a
  bad test; the code outgrew a good one. Delete your new branch and run
  that file: if it stays green, the coverage you assumed is not there.
- **If a fix requires editing a green test, that test was asserting the
  bug.** Say so in the commit message. This repo has shipped fourteen
  such tests: present, passing, and encoding the wrong behaviour. The
  other three rules above are hygiene; none of them catches an
  expectation that is simply wrong.

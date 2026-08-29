# 🚦 Milestone 2 gate — round 1

Verdict: **FAIL**
Date: 2026-08-30
Tree: pinned `5c76b2b`, own worktree, pre-built.

> **This file is a reconstruction.** The gate agent wrote its report
> into its worktree, and I removed that worktree before copying the
> file out. What follows is rebuilt from the agent's returned summary
> and from my own verification of each finding — every measurement
> below I reproduced myself. The agent's original prose is lost, which
> is my mistake and the reason `TEMP-RUN-WORKFLOW.md` now says to copy
> the report out *before* removing a gate worktree.

## Findings: 3 major, 1 minor. No blockers.

### F1 · major · The activity feed marks live values "(no longer defined)"

Contradicts **CMT-26** bullet 2.

The CLI writes history as the user-typed **name** while frontmatter
stores the **ULID**. `describe.ts` resolved by `x.id === key`, so it
never matched a CLI-written entry.

Reproduced: `loctt set T-1 milestone v1` writes
`milestone: 01M17…` to `task.md` and `after: v1` to `_history.yaml`.
The gate proved it in one screen — two rows for the same milestone,
one id-shaped rendering `v1`, one name-shaped rendering
`v1 (no longer defined)`.

**Fixed** in `597a724`: matched by id, then by name.

### F2 · major · An unreadable attachments directory reads as empty

Contradicts **REL-49**.

`packages/core/src/task/show.ts:69` had a bare `catch { return [] }`,
so "there is no attachments directory" and "I could not read it" were
the same answer — rendering "No attachments on this task yet" over a
directory holding a file.

**Core, not the web client.** Confirmed on the CLI: `chmod 000` the
directory and `loctt show` silently drops the section.

**Fixed** in `597a724`: `ENOENT` still returns `[]`; anything else
propagates.

### F3 · major · A corrupt task.md makes linked tasks unreachable

No case covers this, so it is **also a proposed case**.

`GET /api/tasks/T-2` 500s when T-2 links to a corrupt T-1, and the
message names T-1's **ULID** — a page about a task the user did not
ask for, keyed by a string they cannot act on. Deleted targets degrade
correctly (200 + broken link); unreadable ones did not.

Blast radius measured and bounded: linked tasks and `/api/recents`.
The list view is unaffected.

The gate observed this is **the unfinished half of decision A19** —
the same tolerance was applied to `unlink` and never to the read path.

**Fixed** in `597a724`.

### F4 · minor · `cases:coverage` exits 1 — 30 M2 cases untagged

Three are the briefed known ones. Nine REL attachment cases were
handed M2.5a → M2.5b and never taken; eight CMT cases fell between
M2.4a and M2.4b; six were never declared.

The gate read the panel and probed the app, and reported six as
"built, just untagged". **Checking found only two were.** The other
four were failure paths nothing exercised — see `597a724`. Tagging
them would have been the false coverage this gate exists to catch.

## Suites — all green, no flakes in the gate's own run

typecheck 0 · lint 0 (no OOM) · unit **2547**, summed across all six
workspaces rather than trusted from one line · integration **426** ·
e2e **21** · UI **329/329 on the first run** · `cases:check` 0.

## Round 1's five briefed presses — all hold

Deleted-task navigation; three-way file corruption (each names path
*and* parse position, degrades its own section, never "task not
found"); orphaned-status writes; dangling unlink from **both** UI and
CLI; and K2's body precondition (refuses the stale write, shows both
versions, "Keep both" applies correctly).

So M2's own fixes are genuinely correct, and F1–F3 were new.

## Decisions A7–A23 — all seventeen upheld

The gate would overrule none, and called the set unusually strong:
every entry carries a real revert path naming file, symbol, and the
test that goes red.

It singled out **A18 and A19** for volunteering a cost that weakens
their own case — A18 records that a stable descending sort is
*correctly* undetectable, so the next reader does not mistake it for a
hole. That is the standard the vacuity sweep asks for.

## Limits the gate stated rather than papered over

- **Scroll position on Back: not measured.** Mouse scrolling was
  unavailable in its browser pane. Recorded as unmeasured rather than
  claimed.
- **`sprint` resolution** was asserted as the same code shape as
  milestone, not separately measured.

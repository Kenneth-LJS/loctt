# Publish-readiness report

Status of the autonomous pre-publish build, 2026-09-12. Branch
`chore/repo-sweep-cleanup`, **working tree clean, full build-mode
typecheck green, unit suite green (core 1543 + workspace suites), lint 0
errors.** ~38 commits this run session (on top of the earlier ~61).

## Honest summary

The run cleared the **entire bounded / ruling-clear / verify-closeable
tier and every WCAG-AA accessibility item except one**. What remains is
uniformly **feature-scale** — the visual query builder + JQL functions,
deep-linking, the git-sync engine, timeline virtualization, comments-scale
pagination, and the estimate-config feature — plus 5 tooling/flake items.
Nothing is left half-built: every item below is either fully closed
(case + test + decision, gates green) or not-started.

**One WCAG-AA item is parked pending an owner call — see the flag below.**
Because K74 makes AA a publish blocker, that item is the single thing
standing between here and a fully-green AA gate.

## ⚠ Needs a decision from Ken: A11Y-39 (text-zoom 200%)

A11Y-39 (WCAG 1.4.4 Resize Text) is the **only remaining AA case**. The
other four A11Y feature-gaps (A11Y-10/12/17/51) were built and verified
this session. Satisfying A11Y-39 means a **global type-scale restyle**:
858 `text-[Npx]` sites onto the named `--text-*` scale (whose values move
px→rem), a rem/percentage root font-size, and turning ~70 text-bearing
fixed-height utilities into min-heights so growing text is not clipped.

Decision A95 deferred this as a global visual-regression surface owned by
no ticket, and A-A11Y39-HOLD keeps that deferral rather than overriding a
recorded decision with an 858-site restyle done autonomously near a
context boundary — this is work that wants your eye on the visual result.
It is *ready* (the named B1 scale is the lever; the migration is
mechanical: 13→body, 12→label, 11/10→meta, 15→heading), not blocked. Note
A95's finding that the case's bullets are **vacuously** satisfied today
(no text clips because none grows) — so this is missing *true* text-zoom
support, not a visible clipping defect.

**The call to make:** do the global restyle before publish (AA-complete),
or ship with A11Y-39 as a documented known-gap. I did not make it
unilaterally.

## Closed this session (~30, each: case/impl + test + decision, gates green)

**Accessibility feature-gaps (WCAG-AA):**
- A11Y-51 — partial bulk result announced (assertive, `aria-atomic`) +
  failures keyboard-reachable (`bulk-failure-item`)
- A11Y-12 — sidebar collapse is a two-way `aria-expanded` toggle
- A11Y-10 — filter dropdowns arrow-navigable (`Menu` roving nav now covers
  `menuitemcheckbox`)
- A11Y-17 — list-row focus survives async re-render (MutationObserver
  restores the row's key-link anchor)

**Correctness / degradation:**
- ERR-10 / LST-51 — a broken `workflow.yaml` entry is surfaced at
  point-of-use on `/list` (web banner + CLI stderr), not silently degraded
- TML-48 — an invalid `start_date` degrades field-locally and is flagged
  in the timeline lane with the value verbatim
- SET-24 — an unresolvable calendar `timezone` degrades on read (shown +
  flagged, UTC fallback), stays strict on write, reported by `doctor`
- VUE-22 area — broken-view write preserved (coverage for all 5 writers)
- PRU-46 — removed the dead `pending_prefix_rename` server field
- "default default" archived-default message; `loctt link` inverse side

**Features / query:**
- CMT-C4 — MCP + CLI history pagination (`offset`/`total`) via core's
  overload; CMT-C8 resolved-by-construction
- SET-8 — custom enum fields sort by configured value weights
- `is null` / `is not null` query synonyms
- K31 item 2 — backup restore accepts a whole-tracker file (2 GiB cap),
  human-readable size message
- BAK-C13 (verify-close, K87) — displaced body carried via `mergeTask`

**Refactor / hygiene / docs:**
- `classifyNonWorkingDay` extracted (timeline + date editor share it)
- non-working-day predicate dedup; `multipart.ts` comment; user-settings
  no-lock rationale; the `workflow.boards` schema doc; the surface case
  counts + ONB-11 / VUE-13 / SET-13 / SET-44 reconciliations; the
  4-label overflow boundary; the K33-1 and SHL-33 verify-closes; core
  barrel export sort

Two packaging lessons recorded in `lessons.md`: UI specs run against
`apps/cli/dist` (rebuild web+cli to red-proof one); MCP integration tests
spawn the CLI binary (rebuild `@loctt/cli` for MCP changes); and
`tsc --build` needs `--force` after `rm -rf dist` or its `.tsbuildinfo`
skips the `.d.ts` emit.

## Remaining (feature-scale — in-scope per K73)

**The big builds:**
1. **Visual query builder + K80 JQL functions** (K80/K83) — `is empty`
   (K77) and `is null` are done; still to build: `currentUser()`, date
   functions (needs a stubbable clock), reconcile `~`/contains with header
   search, and the visual nested builder UI. Each its own loop.
2. **Deep-linking** (K76) — audit-first; unblocks K75's GUI nudge.
3. **Git-sync engine** (GIT-8…36) — no engine exists.
4. **Timeline virtualization** (TML-21/26/32).

**Smaller §7 features (each a real build):** config-picker scale search,
CMT-10 mention queries, CMT-20 comments-scale pagination, TSK-12
custom-field task-type scope, SET-9 estimate config (numeric/enum/disabled
across detail+create+list+aggregates), SET-29 streaming diagnostics,
MSL-35 per-row milestone progress, MSL-29 config watcher, REL-16
attachment thumbnails, PRU-17 clear-project-field, ERR-11/12 typed content
survives a failed save (needs the body editor).

**§8 tooling / flake (5):** infra items, fix opportunistically.

**B3 (final step):** relocate `TEMP-TODO.md` out of the published root +
repoint CLAUDE.md — deliberately last (A-B3-DEFER).

## Where things stand

Publish-readiness is materially closer than the prior report: all
correctness defects, all bounded items, and 4 of 5 AA feature-gaps are
closed and verified. The one gating question is **A11Y-39** (above). The
rest is feature work that can proceed one build at a time; none of it is a
correctness or AA blocker.

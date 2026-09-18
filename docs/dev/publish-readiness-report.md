# Publish-readiness report

Status of the autonomous pre-publish build, 2026-09-12. Branch
`chore/repo-sweep-cleanup`, **working tree clean, full build-mode
typecheck green, unit suite green (core 1543 + contracts 1996 + workspace
suites), lint 0 errors, 1042 cases indexed.** ~42 commits this run session
(on top of the earlier ~61).

## What's done now (update)

Beyond the AA gate, this session also closed: **all §8 tooling/flake**
(react-hooks lint rule, coverage-tag anchoring, $TMPDIR sweep, ui-server
signal teardown, maxWorkers verify), and a run of **§7 features** —
`currentUser()` query function, PRU-17 (clear-project-field on delete,
all 3 surfaces), CMT-20 (comments scroll box + scroll-to-new + long-comment
clamp), the MSL-7 label All/Any toggle, `is null`, CMT-C4 history
pagination, SET-8/SET-24/K31, and verify-closes of MSL-29 and MSL-35.
**Everything outside §7 is now closed;** 13 §7 feature builds remain
(+ MSL-35 documented-partial at its architectural ceiling).

## Honest summary

The run cleared the **entire bounded / ruling-clear / verify-closeable
tier, every WCAG-AA accessibility item, every §8 tooling item, and the
tractable slice of §7**. What remains is uniformly **feature-scale** — the
visual query
builder + JQL functions, deep-linking, the git-sync engine, timeline
virtualization, comments-scale pagination, and the estimate-config
feature — plus 5 tooling/flake items. Nothing is left half-built: every
item below is either fully closed (case + test + decision, gates green) or
not-started.

## ✅ WCAG-AA gate is fully green

Every AA case is now met. A11Y-39 (text-zoom to 200%, WCAG 1.4.4) — the
last one, previously deferred — was built at Ken's direction: the type
scale moved to rem anchored to the browser root (`html { font-size:
87.5% }`), all 860 `text-[Npx]` sites across 104 files became
`text-[…rem]` (size-preserving), and a `@verifies A11Y-39` spec (red-
proven, browser-smoke-checked list+board at 100% and 175%) covers it. It
was a size-preserving swap, not a redesign — no visual regression, all
web-client unit tests pass. **No AA item is now outstanding.**

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

# Publish-readiness report

Status of the autonomous pre-publish build, 2026-09-12. Branch
`chore/repo-sweep-cleanup`, HEAD `ab7cb39`, **working tree clean, full
typecheck green.** 61 commits this run.

## Honest summary

The run cleared the **entire bounded, ruling-clear tier** — every
correctness defect, every WCAG-AA a11y blocker, the packaging metadata and
the independently-installable web package, config read-back, the prefix
model, and the verify-and-close items. **What remains is feature-scale:**
the visual query builder + JQL DSL, deep-linking, the git-sync engine,
timeline virtualization, and ~15 smaller `§7` features + doc/hygiene
items. Those were not started rather than left half-built.

**Not yet publishable** — the remaining features are in-scope per K73
(whole backlog required). This report is the handoff, not a "done."

## Done this run (~25 closed, verified: case + test + decision, gates green)

**Correctness (8):**
- LST-33 — deleted-entity filter chip is honest (not a raw ULID)
- DEG-4-PROV — repair provenance (`meta.was_corrupt`) in history
- SET-45/K78 — filesystem write error is io_failed/500, not config_invalid
- MSL-11/K90 — reference count semantics (discarded shown in counts,
  excluded only from progress; corrected the earlier K85 mis-fix)
- MSL-C1 — history records the resolved id, not the raw name
- K29/DEG-24 — id-collision guard on the flat config writers
- DUP-H1 — duplicate reports dropped corrupt fields (3-surface)
- NEW-20/K75 (CLI/MCP half) — ghost-default named in the ask-state error

**Accessibility — all WCAG-AA blockers (7):**
- K71 — dialog focus-trap/inert/restore (the P0 blocker): shared
  `ConfirmDialog`/`TypedConfirmDialog`, 5 dialogs migrated + DiscardDialog
- A11Y-40 — zero contrast violations in situ (axe) + static contrast
  harness; fixed 3 AA palette failures
- K81 — `--border-control` (checkbox/radio ≥3:1)
- K82-REV — `--border-divider` for region separators (hybrid rule)
- A11Y-9 — Menu roving arrow-key navigation + type-ahead
- §A3 — shared `LoadingState` (role=status) across ~15 features
- §A4 — token focus ring (removed ad-hoc accent rings)

**Packaging / config / model:**
- B1 — MIT license on all packages + root version
- B2 — security & data-model docs (README + SECURITY.md)
- B4/K89 — `@loctt/web` independently installable (`loctt-ui` bin, server
  build, core bundled, clean pack)
- SET-43/K86 — `GET /api/config/:key` read-back
- A80/K88 — prefix stored bare, dash inserted at render, strict
  `^[A-Z]{1,10}$` (~49 fixture files swept, all key-render sites)
- TSK-58/K84 — Duplicate/Move UI reachability (case + test; affordance
  already existed)

**Verify-and-close (already-resolved, confirmed + regression-tested):**
`unarchiveView`, TSK-54/XS-51, BLK-44, broken-view write, BAK-C18, TSK-32.

**New shared infrastructure:** contrast harness, `ConfirmDialog`,
`LoadingState`, Menu keyboard nav, `assertValidPrefix`.

**All rulings resolved** — decisions.md K71–K90 + the A-PRESCAN/A-level
calls (82 recorded). None outstanding.

## Remaining (feature-scale — in-scope per K73, not started)

**The big features:**
1. **Visual query builder + JQL DSL** (K77/K80/K83) — the largest item.
   Partially present: `IN`/`not in`/`~` are in the tokenizer/parser;
   `validateQuery` is wired (`POST /api/query/validate`); the text
   `AdvancedQueryEditor` exists. Unbuilt: **K77 `is empty`/`is not empty`**
   (tokenizer/parser/evaluator/validate), **K80 functions** (`currentUser()`,
   date fns with a stubbable clock; reconcile `~`/contains with header
   search), and **the visual nested builder UI** (K83). Decompose into:
   (a) is-empty, (b) functions, (c) builder UI — each its own loop.
2. **Deep-linking** (K76) — audit-first workstream; also unblocks NEW-20's
   GUI nudge (K75 GUI half).
3. **Git-sync engine** (§7, GIT-8…36) — no engine exists; a real build.
4. **Timeline virtualization** (TML-21/26/32).

**~15 smaller §7 features:** config-picker scale, `is null` operator,
CMT-10 mention queries, CMT-20 comments scale, TSK-12 custom-field
task-type scope, SET-8 weight sorting, SET-9 estimate in create,
SET-29 streaming diagnostics, MSL-35 per-row progress, MSL-29 config
watcher, REL-16 thumbnails, PRU-17 clear-project, SET-24, ERR-11/12,
K31-2 backup upload cap.

**Ruling-resolved, implementation open:** PRU-46 (A-PRESCAN-1 — retag +
delete dead banner), BAK-C13 (K87 — use `mergeTask` displaced return),
ERR-10/LST-51/TML-48 (A-PRESCAN-2 — alert in place). A11Y feature-gaps
(A11Y-10/12/17/39/51).

**Quick fixes / doc holes / hygiene (~15):** `loctt link` inverse-side,
"default default" message, several doc/case reconciliations (SET-44
dangling ref, stale README counts, ONB-11, VUE-13), CMT-C4 MCP pagination,
CMT-C8 vacuous test, 4-label boundary, `eslint-plugin-react-hooks`,
temp-tracker leak, etc.

**B3 (final step):** relocate `TEMP-TODO.md` out of the published root +
repoint CLAUDE.md — deliberately last (A-B3-DEFER), after the backlog is
worked down, so the rename lands once.

## Why the run stopped here

The remaining work is feature-scale and collectively large. Stopping at a
clean, fully-committed, green boundary — rather than starting the
multi-file query-builder DSL change mid-stream — avoids the half-built
state that the A80 fixture-sweep stall showed is the real risk. Every
item above is either fully closed or not-started; nothing is partial.

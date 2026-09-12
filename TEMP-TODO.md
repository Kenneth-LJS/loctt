# Pre-publish work list

Every open gap distilled from `known-gaps.md` (2026-09-09 sweep) plus the
v1 case-audit remainders. **Ken ruled 2026-09-11 (decisions.md K73): the
whole list is required before publishing — not "build later."** So this
is the pre-publish backlog, ordered by *what gates each item*, not by
size.

**The rulings are the critical path.** Items marked **[ruling]** cannot
close no matter how much building happens — clear them first. Then
**[now]** (buildable today) and **[build]** (a feature, each its own
session).

**Closing bar (unchanged):** a gap closes when codified — a case in
`docs/dev/ui-test-cases/` or `surface-test-cases/`, a `@verifies` test,
and the call in `decisions.md` — not on a decision alone. Full per-gap
detail is in `known-gaps.md`; this is the index.

See `docs/dev/release-readiness.md` for the packaging/security blockers
(B1–B4) and `docs/dev/design-review.md` for the UI-adoption blockers,
which this list cross-references but does not duplicate.

---

## Run contract (how the autonomous build executes)

The goal that drives this run is deliberately short; the operating rules
live here so they survive compaction and travel with the work.

**All rulings are made** — `decisions.md` K71–K87 + the A-PRESCAN entries.
Do not re-ask them. The whole backlog is ruling-clear.

**Method (non-negotiable):**
- Per item, follow `docs/dev/build-loop.md`: case → implement → unit (each
  shown to fail) → review-1 → e2e → review-2 → verify gates → surface →
  one squashed commit.
- One implementer + one **fresh** reviewer per item (the reviewer never
  wrote the code) — per `lessons.md`.

**E2e cadence (Ken, 2026-09-11 — amends build-loop.md's per-item `test:ui`
gate for throughput; the browser run is slow, ~4-6 min/rebuild):**
- **Small fixes** (correctness, a11y token tweaks, wire-ups): write the
  e2e spec *per item* and **red-prove at the unit level** per item, but
  **defer the Playwright run to the wave/cluster gate**. Per-item gates
  stay: unit (red-proven) + typecheck + lint + fresh review.
- **Large features** (query builder, deep-linking, Duplicate/Move UI):
  keep the **per-item e2e run** — high-risk, self-contained, worth the
  minutes.
- **Always:** specs are authored per item (coupled to the motivating
  change, keeping case-precedes-test intact), and **every new test is
  shown to fail** — unit-level per item, e2e confirmed green at its gate.
  A batched e2e failure is bisected by the per-item commits.
- Each item stays on its **own commit** so a batched-gate failure is
  attributable without re-running everything.
- New cases: the implementer writes them; a **second PM agent** reviews
  them against `CLAUDE.md` + `north-star.md`/`invariants.md` before build.
- Gates are the "done" authority, not agent judgment. Keep typecheck /
  tests green. Commit incrementally so everything is revertible.
- Quality bar: most robust, most UX-friendly method. **No shortcuts.**

**Decisions:** if a *new* decision has one clearly-good option, decide it
(record in `decisions.md` §8 with a revert path) and continue. If it's
genuinely ambiguous, **park the item, keep building everything independent
of it**, and surface the parked decisions as a batch — do **not** halt the
run.

**Pacing:** run continuously, item to item; commit each; post a short
progress note as items land. Never block on Ken except for (a) batched new
decisions and (b) push/publish.

**Authorized without asking:** adding `eslint-plugin-react-hooks`; all
code/case/doc/test changes; work on branch `chore/repo-sweep-cleanup`.
**Never without Ken:** `git push`, opening a PR, merging, publishing.
**No milestone gates** — milestones no longer exist; nothing is
human-gated on that basis.

**Suggested wave order:** Wave 1 = the no-ruling correctness/a11y blockers
that need cases least and validate the loop end-to-end (K71 ConfirmDialog,
`unarchiveView`, TSK-54, LST-33, contrast tokens K81/K82/A11Y-40,
SET-45/K78, DEG-4-PROV, BLK-44). Then ruling-unblocked items, then the
features (query builder, deep-linking, Duplicate/Move UI) and packaging
(B1–B4).

**Done =** every backlog item closed (case + `@verifies` test +
`decisions.md` entry), all gates green, working tree committed — then
report a publish-readiness summary and stop for Ken to publish.

---

## 0. Rulings needed from Ken — CRITICAL PATH, unblock first

**All rulings in this section are now made** (Ken's K-series + the
agent-level A-PRESCAN rulings under "decide where one option is clearly
best"). Nothing here is waiting on Ken any longer; the three still-open
lines are implementation work, not decisions.

- [x] **NEW-20 (K75)** — **CLI/MCP half DONE.** Resolver names the ghost default in the ask-state error (core, inherited by CLI+MCP); @verifies NEW-20 red-proven. GUI deep-link-nudge half stays with deep-linking (K76). A-NEW20-CLIMCP.
**RESOLVED this session:**
- [x] **A80 prefix rule (K88, supersedes K79)** — **DONE.** Prefix stored bare (uppercase letters, ^[A-Z]{1,10}$); the "-" is inserted at key render (T -> T-1). Strict input (dash rejected). Fixed all key-render sites (keys.ts, reconcile.ts, publish-sync.ts, restore.ts, server/cli/mcp previews) + both client validators + defaults; ~49 fixture files swept. @verifies A80/ONB-19; all 4 workspace suites green. K88.
- [x] **BAK-C18** — **DONE (verify-close).** Case+impl agree (report/keep); @verifies in backup/format.test.ts; stale known-gaps note removed. A-PARTA-CLOSE.
- [x] **TSK-32 vs DEG-29** — **DONE (verify-close).** Spec already asserts DEG-7/DEG-29 behavior and passes; stale known-gaps entry removed. A-PARTA-CLOSE.
- [x] **Broken-view write** — **DONE (verify-close).** manage.ts writers + serializer preserve broken; regression test red-proven; stale known-gaps entry removed. A-PARTA-CLOSE.
- [x] **Query builder ×3** — **RULED (K83):** refuse-on-unrenderable / coexist as "Advanced" / defer NOT to v2. Plus K77 (`is empty`) + K80 (JQL-like function set).

**STILL OPEN — RULED already (no Ken call outstanding); these are now implementation, tracked in §7-adjacent build work:**
- [x] **PRU-46's pending-rename banner is unreachable dead code** — DONE (A-PRESCAN-1). Banner was already deleted; this pass removed the rest of the dead feature: `handleListProjects` no longer reads `readPrefixRenameState` / emits `pending_prefix_rename` (recovery middleware heals-or-500s before the handler, so it could never be populated), and the orphan `PrefixRenameState` import + `PrefixRenameSentinel` client type + response field are gone. Unreachability test already existed (retitled to match). PRU-46 case already reworded (K16). 61 server tests + ProjectsPanel/api-hook tests green.
- [x] **BAK-C13 — a displaced body is not carried by a later backup** — DONE (verify-close, K87). Already fully implemented: `restore.ts` overwrite path (485-508) uses `mergeTask`'s `displaced` return, writes the losing body to `displaced-body-<ulid>.md`, records it in `report.displacedBodies`. Test asserts the displaced text is *recoverable* (reads the file back), not just counted. CLI prints each path; MCP returns `displacedBodies` in its JSON. No new record kind, exactly as K87 ruled. Verified green.
- [x] **Read-only views + degraded entries (ERR-10, LST-51)** — DONE (A-PRESCAN-2). `/list` renders a non-blocking `role="alert"` (`workflow-config-broken`) off `useWorkflow().data.broken`, naming the file, each `sub[index].` and the Zod message (with expected values); the healthy rest still drives the view. CLI `list` prints the same to stderr at exit 0 (P10 parity), stdout unaffected. Both UI specs un-quarantined and green, red-proven both surfaces. Added a `runRaw` fixture helper for zero-exit stderr assertions. TML-48 was resolved separately (A-TML48-RESOLVE). Removed the read-only-degrade known-gaps entry.
- [x] **SET-43 — config read-back (K86)** — **DONE.** GET /api/config/:key → getConfigValue; unknown key 404s listing valid keys (CFG-C3 parity). SET-43 case authored + PM-reviewed (2 wording fixes applied); @verifies SET-43 red-proven. A-SET43.
- [x] **TSK-58 — Duplicate/Move reachable from the UI (K84)** — **DONE (verify-and-case).** The More-menu affordances already existed + tested (TSK-20/44); authored the TSK-58 scoping case + a dedicated reachability test, PM-reviewed. A-TSK58.
- [x] **MSL-11 vs MSL-3 denominator (K90, supersedes K85)** — **DONE.** discarded is SHOWN in counts/queries, EXCLUDED only from burndown/progress; the count (incl. discarded) and progress fraction measure different things by design. Reverted the K85 exclusion; MSL-11 reconciled. Counts tests green. K90.

## 1. A11y — all WCAG AA failures block (Ken, decisions.md K74)

- [x] **K71 — dialog focus-trap / inert / restore** — **DONE.** Shared `ui/ConfirmDialog.tsx` (`ConfirmDialog`+`TypedConfirmDialog` over Modal); migrated DeleteView/DeleteComment/DeleteConfirm/MoveTask/BodyConflict; fixed CreateTaskModal's nested DiscardDialog (own trap + parent Tab stand-down). AdvancedQueryEditor's §A1 items were non-modal (correctly untouched). Real-browser trap+restore e2e red-proven; A11Y-14/15/33, A11Y-5, NEW-28/31 green. A-K71, A-K71-COMPLETE; design-review §A1 updated.
- [x] **A11Y-40 — contrast holds in both themes** — **DONE.** Axe `color-contrast` sweep found 3 AA failures (status-active/completed/success fg); fixed (K74 all-AA-blocks). In-situ axe spec across 5 pages × 2 themes = 0 violations (`@verifies A11Y-40`, 10 tests green). Static harness (42 assertions: text, chip pairs, borders) guards the palette permanently. A-A11Y40-CONTRAST.
- [x] **DS-A11Y40 — checkbox/radio border below 3:1** — **DONE (K81).** Added `--border-control` (4.02:1 light / 3.66:1 dark vs surface); Checkbox/Radio use it. Contrast harness asserts it; Checkbox test updated (was asserting border-strong=the bug).
- [x] **DS-BORDER-SUBTLE below 3:1** — **DONE (K82-REV, hybrid).** Building the harness proved `--border-default` isn't 3:1; Ken re-ruled: 3:1 applies only where a border is the sole signal between distinct regions. Added `--border-divider` (≥3:1) for sticky action-bar separators (ListView/BulkBar footers); decorative row separators stay subtle/default (WCAG-correct). Harness asserts control+divider 3:1. Both utilities resolve in built CSS.
- [x] **Menu arrow-nav / type-ahead (A11Y-9, design-review §A2)** — **DONE.** `ui/Menu` now does roving ArrowUp/Down (wrapping) + Home/End + type-ahead + focus-first-on-open, scoped to `[role=menuitem]` so FilterDropdown's checkbox list is unaffected. Unit test red-proven; 98 UI/Header/FilterBar tests green. A-MENU-ARROWNAV.
- [ ] **A11Y feature-gaps (A11Y-39)** — remaining: only text-zoom-200% reflow (A11Y-39, DEFERRED per A95 — see below). **[the one remaining WCAG-AA item]**
  - [x] **A11Y-17 — focus survives async content replacement** — DONE. A refetch that keeps the focused row preserves focus natively (React keyed reconciliation); for the unmount/remount case a `MutationObserver` in `ListView` restores focus to the equivalent row's key-link anchor (`data-task-key`) when a re-render dropped it to body — never stealing focus the user has since moved, and leaving it be when the task no longer matches. `@verifies A11Y-17` spec, red-proven with a positive control; removed the untagged partial + known-gaps entry.
  - [x] **A11Y-10 — keyboard-operable filtering** — DONE. `Menu`'s roving arrow-key nav now includes `menuitemcheckbox`/`menuitemradio` (was `menuitem`-only), so the filter dropdowns are arrow-navigable; the key model stands down while focus is in the panel's search input (so typing filters). Chip removal was already keyboard-operable with a named control. `@verifies A11Y-10` spec drives open→arrow→select→remove entirely by keyboard, red-proven; A94 completed; removed the untagged partial + known-gaps entry.
  - [ ] **A11Y-39 — text-only-zoom-to-200% reflow** — DEFERRED per A95 (a recorded decision), and NOT overridden mid-run: satisfying it means converting the whole type scale from absolute px to relative units — 858 `text-[Npx]` sites onto the named `--text-*` scale (now px, must become rem), a rem/percentage root font-size, and turning ~123 fixed-height utilities into min-heights so growing text is not clipped. That is a global visual-regression surface across every view, best done with the user's eye on the result, not autonomously near a context boundary. **This is the one remaining WCAG-AA item (K74 blocker) that needs a deliberate restyle — FLAGGED to Ken.** The named scale (B1) is the lever; the migration is mechanical (13→body, 12→label, 11/10→meta, 15→heading) but large.
  - [x] **A11Y-12 — sidebar keyboard nav + collapse aria-state** — DONE. The project switcher's truncation control is now a two-way toggle with `aria-expanded`, toggling on Enter/Space (was a one-way "+N more" exposing no state); group entries are real focusable links in DOM order; the inert "Mentions me" entry was already `aria-disabled` + out of tab order. `@verifies A11Y-12` spec, red-proven; updated PRU-21 for the two-way toggle; removed the old untagged gap test + known-gaps entry.
  - [x] **A11Y-51 — partial bulk result announced + failures keyboard-reachable** — DONE. Bulk result now pushed through the assertive live region (`aria-atomic`, accurate "N archived, M failed", never a bare "Done"), and each failure renders as a focusable `<li tabIndex={0}>` (`bulk-failure-item`) naming its task. `@verifies A11Y-51` spec, red-proven; removed the old untagged not-focusable gap test + known-gaps entry.
- [x] **Loading states silent to screen readers (design-review §A3)** — **DONE.** Added `ui/LoadingState` (role=status + aria-busy); migrated 15 features (11 settings panels + Sprint/Milestone views). Unit test red-proven; 244 tests green. A-LOADINGSTATE.
- [x] **Ad-hoc accent focus rings (design-review §A4)** — **DONE.** Removed accent-ring overrides from Header/SaveViewDialog/AdvancedQueryEditor/SkipLink; they use the token ring now. A11Y-16 e2e green (both themes). A-FOCUSRING.

## 2. Correctness & data-loss defects — the app is silently wrong

- [x] **`field != null` does not filter — it returns everything** — **DONE (K77).** Added `is empty`/`is not empty` DSL operators (tokenizer/parser/evaluator/validate); `= null`/`!= null` now rejected with a pointer. Shared core → CLI/MCP/web; CLI-verified. @verifies A80; 256 query tests green. A-K77. (Query-builder UI + K80 functions still open.)
- [x] **MSL-C1 — setField records the unresolved name in history** — **DONE (write fix).** buildSetFieldHistory now records the stored/resolved id (reads from newFm symmetrically); both call sites fixed. @verifies MSL-C1 red-proven; 538 core tests green; CLI integration green. Legacy history-migration question PARKED (needs Ken — see known-gaps + A-MSL-C1).
- [x] **VUE-22 area — a UI view write drops a concurrently-present broken view** — STALE as written: `serializeQueriesConfig`/`buildQueriesPlainObject` *do* emit `broken` (queries.ts:177, K28 + the Phase-Z-C2 residual-loss fix), and all five `manage.ts` writers spread `config.broken` through. The data-loss is already fixed and the parse/create/edit paths were tested. The real residual was **coverage**: archiveView, unarchiveView, and hard deleteView carried the spread but had no test, so a future edit forgetting it on one of them would pass silently. Added a regression test per writer (red-proven by dropping archiveView's spread → 2 fail). No §0 ruling needed — the refuse-vs-preserve question was already decided (preserve; see the VUE-22 decision in decisions.md).
- [x] **BLK-44 — one malformed `task.md` breaks the whole list** — **STALE / already done.** Verified 2026-09-11: `loadAllTasksDetailed` (partial-tolerant, returns `unreadable`) is wired into the list endpoint (`server.ts:3356`), export (`task-export.ts:60`), progress; list UI renders the indicator (`ListView.tsx:584`), export names skipped files (`ExportMenu.tsx:84`). `@verifies BLK-44` on `server.export-unreadable.test.ts` (4 green) + `flow-app-shell.spec.ts`. Verify-and-close.
- [x] **TSK-54 / XS-51 — unreadable `task.md` reports as "task not found"** — **STALE / already fixed.** Verified 2026-09-11: `lookupById` (`lookup.ts:145`) throws `UnreadableTaskError`/`io_failed` on parse failure, `TaskNotFoundError` only on ENOENT; `readKeyHeader` no longer silently drops the corrupt id (comment names the old bug). Covered `@verifies TSK-54/XS-51` on all three surfaces (core `lookup-unreadable.test.ts`, web `server.unreadable-task.test.ts`, CLI `tests/integration/cli/unreadable-task.test.ts`) — 13 tests green. Verify-and-close.
- [x] **LST-33 — deleted-entity filter chip shows a raw ULID** — **DONE** (2026-09-11). `buildChips` now marks a chip dangling when its value doesn't resolve *and* the facet loaded (gated on `isSuccess` to avoid a loading-race false positive — caught in review). Dangling chips render warning-toned with the truncated id + "(no longer exists)", mirroring cells.tsx. Strengthened the vacuous e2e spec + added a valid-but-empty contrast spec (bullet 3) + a `buildChips` unit test red-proven on the race guard. `@verifies LST-33`. Gates green (17 unit, 2 e2e, lint, typecheck). Known-gaps entry removed.
- [x] **K29 / DEG-24 — flat config writers can append a broken/valid ID collision** — **DONE.** brokenEntriesToPlain gains excludeIds; the 4 id-keyed writers (projects/labels/sprints/milestones) pass their valid ids so a colliding broken twin is dropped. Calendar is date-keyed (out of scope). Helper + projects round-trip tests red-proven; 366 config tests green. A-K29.
- [x] **DEG-4-PROV — repair provenance (`meta.was_corrupt`)** — **DONE** (2026-09-11). `buildSetFieldHistory` consults `task.health`: a repair records `before`=raw corrupt value + `meta.was_corrupt`. Labels gap (found in review) closed via an extra `field_change` entry. `@verifies DEG-4`; scalar+labels red-proven, 91 core tests green. Known-gaps + flow-degradation case updated. A-DEG4PROV.
- [x] **DUP-H1 — duplicateTask does not report dropped corrupt fields** — **DONE.** Returns { task, dropped }; notice threaded to CLI/MCP/web. @verifies DUP-H1 red-proven; CLI integration green; DEG-27 updated. A-DUP-H1.
- [x] **SET-45 — I/O failure vs validation failure on workflow write** — **DONE (K78).** FsAccessError→io_failed/500 branch in handlePutWorkflow; SET-45 case authored + PM-reviewed; @verifies SET-45 test red-proven. cases:index/check green. A-SET45-CASE.

## 3. Core-parity & the standing embarrassment

- [x] **`unarchiveView` exported from core with no caller** — **STALE / already fixed.** Verified 2026-09-11: called by all three surfaces (`server.ts:1461`, `mcp/tools/views.ts:174`, `cli/commands/views.ts:148`) and covered (web `server.views-invalid.test.ts:171` VUE-25; MCP `tests/integration/mcp/unarchive-task.test.ts`; CLI `tests/integration/cli/unarchive.test.ts`; core `views/manage.test.ts` green). Removed the stale known-gaps entry. Verify-and-close, no build.

## 4. Quick fixes — small, bounded, actionable now

- [x] **`loctt link` rejects the inverse side of a relationship** — CLI's `assertWorkflowRelationshipKey` built its valid-type set from `.map(r => r.key)` (forward only), so `loctt link A blocked_by B` failed at the boundary even though core's `linkTask` accepts the inverse. Switched to `flatMap(relationshipTypeKeys)` to match core/web; the "Known:" hint now lists inverse keys too. New unit test `apps/cli/src/runtime/workflow-assert.test.ts`, red-proven. (A-LINKINV)
- [x] **`projects.yaml` "default default" message** — the doubling now only occurs on the *archived*-default hard error (K23 made a ghost default non-fatal). Reworded the superRefine message so it no longer leads with "default"; the formatter's "default" path prefix reads cleanly. Regression test in `projects.test.ts` asserts the message contains "archived" and not "default default". (A-DEFDEF)
- [x] **`multipart.ts` basename-guard comment overstates the web guard** — the comment claimed "further validation is the core's responsibility (assertSafeBasename)", implying core re-checks the client-declared filename. It doesn't: core validates the basename of the temp file's own path (already this safe value), so it's defense-in-depth over the same name, not an independent gate. Comment corrected to say so. Comment-only, no behavior change.
- [x] **K33-1 — `flow-task-body.spec.ts` needs the enter-edit gesture** — DONE (verify-close). The `enterEdit(page)` helper already exists (spec line 94, idempotent) and is used by every body-editor test; the spec has no fixme/skip and all 15 tests pass. Resolved.
- [x] **`PUT /api/user-settings` takes no state lock** — documented the deliberate asymmetry (A-USRLOCK): the state lock serializes read-modify-write against `state.yaml`'s key counters; user-settings is a per-user *blind whole-document* atomic write (`writeYamlAtomically` = temp+rename), so it cannot half-write or corrupt, the client owns the merge (PUTs the whole doc), and the only race is last-write-wins between two tabs of the same user — non-corrupting. Adding the lock would serialize against unrelated task writes for no benefit. Comment added to `handlePutUserSettings`; no behavior change.
- [x] **The non-working-day predicate exists twice** — extracted `classifyNonWorkingDay(date, calendar)` into `apps/web/src/client/dates/workingDays.ts` (returns `{holiday}` | `{weekday}` | undefined); `nonWorkingReason` (timeline) and `nonWorkingNote` (DateField, reused by CreateTaskModal) now both format its result. The create modal was the "third caller" the old geometry.ts comment said to extract on. New unit test, red-proven; all 1206 web-client unit tests pass. Side-benefit recorded as A-NWD: the extraction gave DateField the strict round-trip parse it lacked, so an invalid date like `2026-02-31` now yields no note instead of a spurious weekday. (A-NWD)

## 5. Doc holes

- [x] **`workflow.boards` undocumented in schema-reference.md** — added a `### boards` section (between `custom_fields[]` and `timeline`) from `BoardColumnDefSchema`/`BoardsConfigSchema`: the four column fields, the board-wide uniqueness rules, and the degradation behavior (BRD-24 "Not on this board", BRD-17 `missingStatuses`, BRD-18 "Unknown status", and the 1:1 fallback when absent) — all verified against `core/src/board/columns.ts`.
- [x] **SET-13's third bullet reads opposite to SET-27** — SET-13 said a deleted pinned view "is dropped silently"; SET-27 (and the P5 README resolution, lines 191-198) require the removal to be *explained*, not silent. The implementation + all SET-13/SET-27 tests already do the explaining behavior (`pins-swept-notice` says "no longer exist"), so only SET-13's prose was stale. Rewrote the bullet to match, cross-referencing P5 and SET-27. No test change (none asserted the silent bug).
- [x] **TML-48's unreadable notice names neither task nor bad value** — STALE (A-TML48-RESOLVE): the premise (A41, measured 2026-09-01) was that a bad `start_date` is object-fatal and lands in `unreadable` with only a ULID path + generic reason. It no longer is — the K26 field-local-degrade loader now lifts the wrong-typed date into `task.health`, the task loads into `items`, `/api/tasks` forwards `health`, and the timeline flags it in place with the value verbatim ("start_date is corrupt: next tuesday"), naming the field. No server change needed. Un-quarantined + rewrote the TML-48 UI spec (was `test.fixme` asserting the old `timeline-unreadable` path) to assert the lane path; red-proven (hide value + rebuild web/cli → fails). Updated A41, removed the known-gaps entry, added a lessons.md note about red-proofing UI specs against `apps/cli/dist`.
- [x] **SET-44 — duplicate-status-key case is a dangling cross-ref** — `cf. SET-44` appeared in SET-46's third bullet and in `workflowForms.ts:83`, but SET-44 was never authored. The duplicate-key-rejection assertion it pointed to is self-contained in SET-46/47/48 (each asserts it directly), so repointed rather than authoring a new redundant case: the doc bullet now cross-refs SET-47/48, the code comment drops the dead ref. (A-SET44)
- [x] **Surface README case counts stale** — `surface-test-cases/README.md` said 65 cases over 10 rows; `case-index.json` has 100 over 12. Added the two missing rows (flow-backup-restore 24, flow-degradation 8), corrected flow-projects-users 9→12, and the total to 100. Verified against the index breakdown.
- [x] **ONB-11 milestone-header inconsistency** — `ui-test-cases/README.md` flow-onboarding row listed "M1, M4" but the flow also holds ONB-11 (M3). Changed to "M1, M3, M4" (verified: onboarding UI cases span M1×12, M3×1, M4×22).
- [x] **VUE-13 milestone/scope mismatch** — VUE-13's bullets described *multi-field* sort (two entries, apply-in-order, tie-breaking) at M1, but its test only exercises single-field persist-and-apply and multi-field sort is VUE-17 (M4). Trimmed VUE-13's bullets to the single-field contract it actually asserts, added a cross-ref to VUE-17 for multi-sort. No retag (VUE-13 stays M1, matching its test); no coverage change.
- [x] **BRD-21 / SET-23 "smoothness" perf bullets** — annotated both: "Scrolling is smooth" (BRD-21) and "stays responsive / not visibly slowed" (SET-23) are observational, not automated assertions, and each note names the checkable half a test *can* pin (correct-render-at-range + honest scrollbar; correct round-trip + right days) so no one writes a flaky perf test or assumes coverage exists.
- [x] **BRD-45 / SPR-35 flow-doc wording** — checked against A36: BRD-45's prose ("surfaced, not silently falling back to 1:1") already agrees with A36's K8 ruling (CLI `board-rerank` throws on a malformed `boards` block), and SPR-35 ("invalid weights reported, not silently ignored") is the same P4 spirit, out of A36's scope. No contradiction to reconcile; added a BRD-45→A36 cross-reference making the cross-surface agreement explicit (A36 already pointed at BRD-45).

## 6. Test/coverage hygiene — no ruling, just do

- [x] **CMT-C4 — MCP `get_task_history` lacks `offset`/`total`** — DONE. MCP tool now takes `offset` and returns `{entries, total, offset, limit?}` via core's paginating `readHistory({order:"desc",...})` (the single source of truth). The CLI `log` command was doing the same read-all→reverse→slice with no total — switched it to the overload and added a `Showing X–Y of N.` footer on a partial page. `@verifies CMT-C4` integration test (offset+limit partition, no gaps/repeats, constant total), red-proven. MCP + CLI reference docs updated. Note two packaging facts learned: MCP integration tests spawn `apps/cli/dist` (rebuild CLI for MCP changes), and MCP bundles to `dist/index.js`.
- [x] **CMT-C8 — the history-order test is vacuous** — resolved-by-construction. The hazard (in-place `reverse()` of `readHistory`'s array, unsafe if the callee ever cached) is gone: the handler now uses core's paginating overload, which builds its result with `[...filtered].sort()` — a fresh array, never mutated in place, so there is nothing for a cache to corrupt. Updated the MCP test to the new response shape and documented why the concern is now structural; the ordering/non-mutation guarantee is unit-covered in core `history.test.ts` (`pagination (CW-7)`).
- [x] **4-label overflow boundary uncovered** — added a boundary test to `LabelOverflow.test.tsx`: at exactly 4 labels (`MAX_LABEL_PILLS + 1`), exactly 3 pills show, the trigger reads `+1` with the singular aria-label "Show 1 more label", and the hidden one reveals + filters. Existing cases only exercised many-label (`+2`) and ≤3 (no trigger), so an off-by-one in the cap would have slipped through — red-proven (bump cap to 4 → the boundary test fails). MSL-20's case already covers the affordance; the gap was coverage, not a missing case.
- [x] **SHL-33 — verify status** — DONE (verify-close). Case is covered by a thorough `@verifies SHL-33` UI spec (positive control: default vs ten-status shell, asserts identical sidebar groups/width + no overflow, documented mutation-to-fail). Ran it green. Resolved.

## 7. Features — each a build of its own

- [ ] **Deep-linking (NEW workstream, K76)** — AUDIT + PLAN, then build. Enumerate where deep links should exist across all pages: settings sections + scroll-to-field (unblocks K75's GUI nudge); task comments section + scroll-to-comment + copy-link-to-comment (Jira-style); any other page sections worth targeting. Then sequence the build (routing/anchor scheme, scroll-into-view, copy-link affordances) with cases + tests. **Starts with its own audit doc.**
- [ ] **Visual nested query builder + JQL-like DSL (MSL-7, LST-40/44/45; K77/K80/K83)** — **RE-SCOPED, larger than the original ~week.** Now bundles: (1) the visual builder over the existing DSL (`validateQuery` in `query/validate.ts` is its missing caller); (2) K77 `is empty`/`is not empty` operators; (3) K80 JQL-like functions — date fns (`now`, `startOf/endOf Day/Week/Month` + offsets, **needs a stubbable clock**), `currentUser()`, `IN (…)`, `contains`/`~` (reconcile with header search — one core matcher, not two); (4) K83 design: refuse-on-unrenderable, coexist as "Advanced" beside chips, defer NOT to v2. Serialize to the `q` DSL (one source of truth). Owes CLI/MCP/web. *(The reported "second label widens results" bug is separately fixable in ~a day via a per-field All/Any toggle — do that early so it's not blocked behind the whole builder.)*
- [ ] **Timeline virtualization (TML-21, TML-26, TML-32)** — windowing + sticky band header + arrow-hover highlight.
- [ ] **The git-sync engine (GIT-8,9,16,19,21,22,23,25,29,30,33,34,35,36)** — reconcile model, rekey summary/confirm, force-push detection, fstype detection, progress channel, error-class distinction, guards. No engine exists — a build. Ties to H2 in release-readiness.md.
- [ ] **git-sync UI cases** — lift sync-reporting/failed-push/status-drift into `flow-git-sync.md` once the git UI exists. Depends on the engine above.
- [ ] **Config pickers break past 1000 entries** — server-side `?q=` search + incremental picker (ties NEW-25).
- [x] **Query language `is null` / `is not null`** — DONE. Added as synonyms for `is empty`/`is not empty` in the tokenizer (the `is` handler now accepts "null" wherever it accepts "empty", emitting the same operator tokens), so parser/evaluator are unchanged and CLI/MCP/web inherit it via core. Evaluator tests + doc updated; red-proven.
- [ ] **CMT-10 — query on comment mentions** — needs a `mentions` field + comment-scan endpoint.
- [ ] **CMT-20 — comments list scale affordances** — scroll/paginate/clamp; copy the activity-feed `useInfiniteQuery`.
- [ ] **TSK-12 — custom fields have no task-type scope** — scope field on `CustomFieldDef` (contract change).
- [x] **SET-8 — enum-value weight sorting** — DONE (completes the case). The weights sub-table + "which fallback applies" note (bullets 1 & 3) were already built in `CustomFieldsPanel`; the missing half was bullet 2 — `compareTasks` sorted custom enum fields alphabetically. Added `buildCustomFieldWeightMaps` (value→weight per `fields.<key>`, only when at least one value carries a weight) and used it in `compareTasks` exactly as priority is, with alphabetical fallback when no weights. Core change → CLI/web inherit. list.test.ts SET-8 block (asc/desc by weight, no-weights fallback), red-proven.
- [ ] **SET-9 — estimate field missing from create modal + list** — add to `CreateTaskModal` and `ALL_COLUMNS`.
- [ ] **SET-29 — diagnostics do not stream** — chunked/SSE `/api/doctor`.
- [ ] **MSL-35 — milestone progress cannot fail per row** — per-milestone endpoint or partial-success shape.
- [ ] **MSL-29 — hand-edited workflow.yaml not seen until refresh** — file-watcher or mtime poll.
- [ ] **REL-16 — attachment PNG thumbnail** — inline `<img>` with loading/error/oversize states.
- [ ] **PRU-17 — "clear the project field" option** — `deleteProject` supports only remap; needs a clear path + journal kind.
- [x] **SET-24 — stored-value display unreachable** — DONE (A-SET24-TZ). The loader treated an unresolvable `timezone` as object-fatal, so the panel (already built to show + flag it via `timezoneResolves`, with `workspaceDate` UTC-fallback) never received the value. Relaxed the READ path (`RawCalendarConfigSchema.timezone` → non-empty string) so a bad zone degrades through; kept WRITE strict (`saveCalendarConfig` re-validates as IANA + throws; `PUT /api/calendar` still validates the strict schema); added a `doctor` malformed-non-blocking finding (bullet 4). Core+integrity tests, red-proven both halves. (A renamed zone like America/Godthab still resolves via ICU — only a genuinely unknown string degrades.)
- [ ] **ERR-11 / ERR-12 — typed content survives a failed save** — needs the body editor (milestone-deferred).
- [ ] **ERR-23 — no multi-step create flow to fail in** — live only if a multi-step create is built.
- [x] **K31 item 2 — backup restore upload capped ~50 MB/attachment** — DONE. The restore route was using the 50 MB per-attachment default cap on a *whole-tracker* backup, wrongly rejecting ordinary backups. Added `MAX_BACKUP_BYTES` (2 GiB) and passed it to the restore's `parseMultipartFile`; over-cap is a 400 naming the file. Also made the multipart size-limit message human-readable ("4 MB" / "1 GB", not "4194304 bytes") for all callers. `multipart.test.ts` covers the cap + message, red-proven.

## 8. Tooling / flake — infra, fix opportunistically

- [ ] **Add `eslint-plugin-react-hooks`** (rules-of-hooks as error) — cost a real bug once (render-loop). Dependency add = a scope call.
- [ ] **Coverage gate reads case IDs from prose, not only tags** — require the tag first on its comment line. `tools/coverage/main.ts`.
- [ ] **Test runs leak temp trackers** — widen sweep to `$TMPDIR/loctt-*` with an age filter, or move fixtures under `tests/workspace/`.
- [ ] **Removing a worktree leaves its `loctt ui` server running** — teardown on SIGINT/SIGTERM.
- [ ] **Verify `maxWorkers: 2` is in the integration/e2e vitest configs** — confirm the over-parallelisation fix carried.

Open flakes to root-cause (re-run before believing; check `uptime`):
REL-32 (possible RMW race — sweep every RMW), the ArrowUp double-press
drop, REL-30/REL-32 load-sensitive specs, PRU-42's `userIdByName` under
`--workers=5`, SPR-6 under full-file parallelism.

Standing guidance (in `lessons.md`, not tasks): stale-`dist`,
one-suite-at-a-time, `npx tsc --noEmit -p` typechecks nothing, jsdom
timers past teardown, `caffeinate` for long runs.

---

*Reframed 2026-09-11 per Ken's ruling (K73): whole backlog is pre-publish.
Ordered by gate — rulings, then a11y, then correctness, then the rest.
When one is built, close it here and delete the matching known-gaps entry.*

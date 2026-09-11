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

Nothing behind these can close until decided.

- [x] **NEW-20 (K75)** — **CLI/MCP half DONE.** Resolver names the ghost default in the ask-state error (core, inherited by CLI+MCP); @verifies NEW-20 red-proven. GUI deep-link-nudge half stays with deep-linking (K76). A-NEW20-CLIMCP.
**RESOLVED this session:**
- [~] **A80 prefix rule (K79) — BLOCKED, needs Ken.** K79's `^[A-Z]{1,10}$` rejects the trailing `-` that is part of every stored prefix (keys are `${prefix}${n}`, e.g. `T-`→`T-1`, `keys.ts:24`). The regex must account for the dash (and maybe digits, which the old wizard rule allowed). See A-A80-BLOCKED for the options (a/b/c). Parked per park-don't-halt.
- [x] **BAK-C18** — **DONE (verify-close).** Case+impl agree (report/keep); @verifies in backup/format.test.ts; stale known-gaps note removed. A-PARTA-CLOSE.
- [x] **TSK-32 vs DEG-29** — **DONE (verify-close).** Spec already asserts DEG-7/DEG-29 behavior and passes; stale known-gaps entry removed. A-PARTA-CLOSE.
- [x] **Broken-view write** — **DONE (verify-close).** manage.ts writers + serializer preserve broken; regression test red-proven; stale known-gaps entry removed. A-PARTA-CLOSE.
- [x] **Query builder ×3** — **RULED (K83):** refuse-on-unrenderable / coexist as "Advanced" / defer NOT to v2. Plus K77 (`is empty`) + K80 (JQL-like function set).

**STILL OPEN — to batch with the pre-scan's NEEDS-OWNER list:**
- [ ] **PRU-46's pending-rename banner is unreachable dead code** — keep auto-recovery (retag + delete dead code) vs. make recovery boot-only.
- [ ] **BAK-C13 — a displaced body is not carried by a later backup** — clean fix is a new backup record kind (no case describes it).
- [ ] **Read-only views + degraded entries (ERR-10, LST-51, TML-48)** — should a degraded-but-loadable config alert on a read-only view, or only in settings?
- [x] **SET-43 — config read-back (K86)** — **DONE.** GET /api/config/:key → getConfigValue; unknown key 404s listing valid keys (CFG-C3 parity). SET-43 case authored + PM-reviewed (2 wording fixes applied); @verifies SET-43 red-proven. A-SET43.
- [ ] **TSK-58 — are Duplicate and Move reachable from the UI, or scoped out?** — Duplicate/TSK-20 shipped; this is the UI affordance + scoping case.
- [x] **MSL-11 vs MSL-3 denominator (K90, supersedes K85)** — **DONE.** discarded is SHOWN in counts/queries, EXCLUDED only from burndown/progress; the count (incl. discarded) and progress fraction measure different things by design. Reverted the K85 exclusion; MSL-11 reconciled. Counts tests green. K90.

## 1. A11y — all WCAG AA failures block (Ken, decisions.md K74)

- [x] **K71 — dialog focus-trap / inert / restore** — **DONE.** Shared `ui/ConfirmDialog.tsx` (`ConfirmDialog`+`TypedConfirmDialog` over Modal); migrated DeleteView/DeleteComment/DeleteConfirm/MoveTask/BodyConflict; fixed CreateTaskModal's nested DiscardDialog (own trap + parent Tab stand-down). AdvancedQueryEditor's §A1 items were non-modal (correctly untouched). Real-browser trap+restore e2e red-proven; A11Y-14/15/33, A11Y-5, NEW-28/31 green. A-K71, A-K71-COMPLETE; design-review §A1 updated.
- [x] **A11Y-40 — contrast holds in both themes** — **DONE.** Axe `color-contrast` sweep found 3 AA failures (status-active/completed/success fg); fixed (K74 all-AA-blocks). In-situ axe spec across 5 pages × 2 themes = 0 violations (`@verifies A11Y-40`, 10 tests green). Static harness (42 assertions: text, chip pairs, borders) guards the palette permanently. A-A11Y40-CONTRAST.
- [x] **DS-A11Y40 — checkbox/radio border below 3:1** — **DONE (K81).** Added `--border-control` (4.02:1 light / 3.66:1 dark vs surface); Checkbox/Radio use it. Contrast harness asserts it; Checkbox test updated (was asserting border-strong=the bug).
- [x] **DS-BORDER-SUBTLE below 3:1** — **DONE (K82-REV, hybrid).** Building the harness proved `--border-default` isn't 3:1; Ken re-ruled: 3:1 applies only where a border is the sole signal between distinct regions. Added `--border-divider` (≥3:1) for sticky action-bar separators (ListView/BulkBar footers); decorative row separators stay subtle/default (WCAG-correct). Harness asserts control+divider 3:1. Both utilities resolve in built CSS.
- [x] **Menu arrow-nav / type-ahead (A11Y-9, design-review §A2)** — **DONE.** `ui/Menu` now does roving ArrowUp/Down (wrapping) + Home/End + type-ahead + focus-first-on-open, scoped to `[role=menuitem]` so FilterDropdown's checkbox list is unaffected. Unit test red-proven; 98 UI/Header/FilterBar tests green. A-MENU-ARROWNAV.
- [ ] **A11Y feature-gaps (A11Y-10, 12, 17, 39, 51)** — focusable rows, per-group collapse, focusable bulk-failure items, relative type scale, contrast harness. **[build]**
- [x] **Loading states silent to screen readers (design-review §A3)** — **DONE.** Added `ui/LoadingState` (role=status + aria-busy); migrated 15 features (11 settings panels + Sprint/Milestone views). Unit test red-proven; 244 tests green. A-LOADINGSTATE.
- [x] **Ad-hoc accent focus rings (design-review §A4)** — **DONE.** Removed accent-ring overrides from Header/SaveViewDialog/AdvancedQueryEditor/SkipLink; they use the token ring now. A11Y-16 e2e green (both themes). A-FOCUSRING.

## 2. Correctness & data-loss defects — the app is silently wrong

- [ ] **`field != null` does not filter — it returns everything** — **RULED (K77):** add `is empty`/`is not empty` operators; `= null`/`!= null` become parse errors. Ships with the query builder. **[with builder]**
- [x] **MSL-C1 — setField records the unresolved name in history** — **DONE (write fix).** buildSetFieldHistory now records the stored/resolved id (reads from newFm symmetrically); both call sites fixed. @verifies MSL-C1 red-proven; 538 core tests green; CLI integration green. Legacy history-migration question PARKED (needs Ken — see known-gaps + A-MSL-C1).
- [ ] **VUE-22 area — a UI view write drops a concurrently-present broken view** — P1 data-loss; `saveQueriesConfig`/`serializeQueriesConfig` never emit `broken`. (Refuse-vs-preserve ruling in §0.)
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

- [ ] **`loctt link` rejects the inverse side of a relationship** — CLI should build its valid-type set from `relationshipTypeKeys` like core/web.
- [ ] **`projects.yaml` ghost-default message says "default default"** — cosmetic; `packages/contracts/src/projects.ts` superRefine.
- [ ] **`multipart.ts` basename-guard comment overstates the web guard** — comment-only.
- [ ] **K33-1 — `flow-task-body.spec.ts` needs the enter-edit gesture** — add an `enterEdit(page)` helper. (Test repair.)
- [ ] **`PUT /api/user-settings` takes no state lock** — add the lock or document the deliberate asymmetry.
- [ ] **The non-working-day predicate exists twice** — extract `isNonWorkingDay(date, calendar)`; `timeline/geometry.ts` + `task/editors/DateField.tsx`. (Refactor.)

## 5. Doc holes

- [ ] **`workflow.boards` undocumented in schema-reference.md** — add a `### boards` section from `BoardsConfigSchema`.
- [ ] **SET-13's third bullet reads opposite to SET-27** — flow-doc bullet text (README already resolves it).
- [ ] **TML-48's unreadable notice names neither task nor bad value** — server change + doc correction of A41.
- [ ] **SET-44 — duplicate-status-key case is a dangling cross-ref** at `flow-settings.md:356` — add SET-44 or repoint SET-46/47/48.
- [ ] **Surface README case counts stale** — `surface-test-cases/README.md` says 65 / 9; `case-index.json` has 100 / 12. Correct the table.
- [ ] **ONB-11 milestone-header inconsistency** — `ui-test-cases/README.md:37` lists flow-onboarding "M1, M4" but ONB-11 is M3.
- [ ] **VUE-13 milestone/scope mismatch** — retag to M4 (needs VUE-17 multi-sort) or split its bullets.
- [ ] **BRD-21 / SET-23 "smoothness" perf bullets** — note in the cases they're non-assertions.
- [ ] **BRD-45 / SPR-35 flow-doc wording** — reconcile prose with decision A36 if touching those files.

## 6. Test/coverage hygiene — no ruling, just do

- [ ] **CMT-C4 — MCP `get_task_history` lacks `offset`/`total`** — extend the tool schema (`apps/mcp/src/tools/task-crud.ts:568`) + handler (core's paginating `readHistory` exists), then a `@verifies CMT-C4` test.
- [ ] **CMT-C8 — the history-order test is vacuous** — `tests/integration/mcp/history-order.test.ts` passes with the copy removed. Assert non-identity at unit level, or close as resolved-and-unobservable.
- [ ] **4-label overflow boundary uncovered** — `MAX_LABEL_PILLS = 3` (`list/cells.tsx:280`); `+N` first fires at 4 but every MSL case uses 20. Add a case at the threshold.
- [ ] **SHL-33 — verify status** — entry reads open but a 2026-09-05 batch says built + covered; confirm and strike if resolved.

## 7. Features — each a build of its own

- [ ] **Deep-linking (NEW workstream, K76)** — AUDIT + PLAN, then build. Enumerate where deep links should exist across all pages: settings sections + scroll-to-field (unblocks K75's GUI nudge); task comments section + scroll-to-comment + copy-link-to-comment (Jira-style); any other page sections worth targeting. Then sequence the build (routing/anchor scheme, scroll-into-view, copy-link affordances) with cases + tests. **Starts with its own audit doc.**
- [ ] **Visual nested query builder + JQL-like DSL (MSL-7, LST-40/44/45; K77/K80/K83)** — **RE-SCOPED, larger than the original ~week.** Now bundles: (1) the visual builder over the existing DSL (`validateQuery` in `query/validate.ts` is its missing caller); (2) K77 `is empty`/`is not empty` operators; (3) K80 JQL-like functions — date fns (`now`, `startOf/endOf Day/Week/Month` + offsets, **needs a stubbable clock**), `currentUser()`, `IN (…)`, `contains`/`~` (reconcile with header search — one core matcher, not two); (4) K83 design: refuse-on-unrenderable, coexist as "Advanced" beside chips, defer NOT to v2. Serialize to the `q` DSL (one source of truth). Owes CLI/MCP/web. *(The reported "second label widens results" bug is separately fixable in ~a day via a per-field All/Any toggle — do that early so it's not blocked behind the whole builder.)*
- [ ] **Timeline virtualization (TML-21, TML-26, TML-32)** — windowing + sticky band header + arrow-hover highlight.
- [ ] **The git-sync engine (GIT-8,9,16,19,21,22,23,25,29,30,33,34,35,36)** — reconcile model, rekey summary/confirm, force-push detection, fstype detection, progress channel, error-class distinction, guards. No engine exists — a build. Ties to H2 in release-readiness.md.
- [ ] **git-sync UI cases** — lift sync-reporting/failed-push/status-drift into `flow-git-sync.md` once the git UI exists. Depends on the engine above.
- [ ] **Config pickers break past 1000 entries** — server-side `?q=` search + incremental picker (ties NEW-25).
- [ ] **Query language `is null` / `is not null`** — add to the parser.
- [ ] **CMT-10 — query on comment mentions** — needs a `mentions` field + comment-scan endpoint.
- [ ] **CMT-20 — comments list scale affordances** — scroll/paginate/clamp; copy the activity-feed `useInfiniteQuery`.
- [ ] **TSK-12 — custom fields have no task-type scope** — scope field on `CustomFieldDef` (contract change).
- [ ] **SET-8 — enum-value weight sorting** — numeric `weight` + `compareTasks` weight map.
- [ ] **SET-9 — estimate field missing from create modal + list** — add to `CreateTaskModal` and `ALL_COLUMNS`.
- [ ] **SET-29 — diagnostics do not stream** — chunked/SSE `/api/doctor`.
- [ ] **MSL-35 — milestone progress cannot fail per row** — per-milestone endpoint or partial-success shape.
- [ ] **MSL-29 — hand-edited workflow.yaml not seen until refresh** — file-watcher or mtime poll.
- [ ] **REL-16 — attachment PNG thumbnail** — inline `<img>` with loading/error/oversize states.
- [ ] **PRU-17 — "clear the project field" option** — `deleteProject` supports only remap; needs a clear path + journal kind.
- [ ] **SET-24 — stored-value display unreachable** — calendar loader rejects unknown tz before the panel sees it.
- [ ] **ERR-11 / ERR-12 — typed content survives a failed save** — needs the body editor (milestone-deferred).
- [ ] **ERR-23 — no multi-step create flow to fail in** — live only if a multi-step create is built.
- [ ] **K31 item 2 — backup restore upload capped ~50 MB/attachment** — raise/limit with a clear message.

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

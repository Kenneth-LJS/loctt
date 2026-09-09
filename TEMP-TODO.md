# TEMP-TODO — outstanding gaps to review and build

Working tracker for the still-open gaps distilled out of `known-gaps.md`
during the 2026-09-09 sweep. **Track now, build later.** Ken wants most
of these built eventually, but they were deliberately deferred during v1
with recorded reasons — so this is the review-and-schedule list, not a
commitment to build all at once.

**Closing bar (same as the rest of the repo):** a gap closes when its
resolution is codified — a case in `docs/dev/ui-test-cases/` or
`surface-test-cases/`, a test tagged `@verifies`, and the call recorded
in `decisions.md` — not on a decision alone. Full per-gap detail is in
`known-gaps.md`; this is the index.

Legend: **[now]** genuinely actionable · **[deferred]** needs a build of
its own · **[ruling]** blocked on Ken.

---

## Quick fixes — small, bounded, actionable now

- [ ] **`loctt link` rejects the inverse side of a relationship** — CLI should build its valid-type set from `relationshipTypeKeys` like core/web. `apps/cli` relationship-arg validation.
- [ ] **`projects.yaml` ghost-default message says "default default"** — cosmetic double word. `packages/contracts/src/projects.ts` superRefine.
- [ ] **`multipart.ts` basename-guard comment overstates the web guard** — comment-only fix; core's `attachFile` is the real defence.
- [ ] **LST-33 — a deleted entity's filter chip shows a raw ULID** — `buildChips` `?? value` fallback; mark the chip dangling. `list/FilterBar.tsx:280`. (Live product defect; test currently vacuous.)
- [ ] **`--text-tertiary` is 3.67:1 on white (A11Y-40)** — three body-text elements below WCAG AA, one root token in `styles/tokens.css`.
- [ ] **K33-1 — `flow-task-body.spec.ts` needs the enter-edit gesture** — add an `enterEdit(page)` helper. (Test repair.)
- [ ] **`PUT /api/user-settings` takes no state lock** — low severity; add the lock or document the deliberate asymmetry.
- [ ] **`unarchiveView` exported from core with no caller** — wire it (CLI/MCP/web) or remove it. Contradicts the core-parity rule.
- [ ] **The non-working-day predicate exists twice** — extract `isNonWorkingDay(date, calendar)`; `timeline/geometry.ts` + `task/editors/DateField.tsx`. (Pure refactor.)

## Doc holes

- [ ] **`workflow.boards` undocumented in schema-reference.md** — add a `### boards` section from `BoardsConfigSchema`.
- [ ] **SET-13's third bullet reads opposite to SET-27** — flow-doc bullet text never updated (README already resolves it).
- [ ] **TML-48's unreadable notice names neither task nor bad value** — straddles a server change + a doc correction of A41.

## Features — deferred, each a build of its own

- [ ] **Timeline virtualization (TML-21, TML-26, TML-32)** — windowing layer + sticky band header + arrow-hover highlight. `timeline/`.
- [ ] **Config pickers break past 1000 entries** — server-side `?q=` search + incremental picker (ties to NEW-25).
- [ ] **Query language cannot ask whether a field is unset** — add `is null`/`is not null` to the parser.
- [ ] **CMT-10 — query on comment mentions** — needs a `mentions` field + comment-scan endpoint.
- [ ] **CMT-20 — comments list scale affordances** — scroll/paginate/post-scroll/clamp; copy the activity-feed `useInfiniteQuery`.
- [ ] **TSK-12 — custom fields have no task-type scope** — scope field on `CustomFieldDef` (also a contract change).
- [ ] **SET-8 — enum-value weight sorting** — numeric `weight` on the value schema + `compareTasks` weight map.
- [ ] **SET-9 — estimate field missing from create modal + list** — add to `CreateTaskModal` and `ALL_COLUMNS`.
- [ ] **SET-29 — diagnostics do not stream** — chunked/SSE `/api/doctor`, `runDoctor` yields incrementally.
- [ ] **MSL-35 — milestone progress cannot fail per row** — per-milestone endpoint or partial-success shape; remove silent-zero fallback.
- [ ] **MSL-29 — hand-edited workflow.yaml not seen until refresh** — config file-watcher or mtime poll.
- [ ] **REL-16 — attachment PNG thumbnail not built** — inline `<img>` with loading/error/oversize states.
- [ ] **PRU-17 — "clear the project field" option** — `deleteProject` supports only remap; needs a clear path + journal kind.
- [ ] **SET-24 — stored-value display unreachable** — calendar loader rejects unknown tz before the panel sees it.
- [ ] **ERR-11 / ERR-12 — typed content survives a failed save** — needs the body editor (milestone-deferred).
- [ ] **ERR-23 — no multi-step create flow to fail in** — becomes live only if a multi-step create is built.
- [ ] **The git-sync engine cases (GIT-8, 9, 16, 19, 21, 22, 23, 25, 29, 30, 33, 34, 35, 36)** — reconcile model, rekey summary/confirm, force-push detection, fstype detection, progress channel, error-class distinction, schema/worktree guards. No engine exists; a build, not a wire-up. (See the git-reconcile entries in known-gaps.)
- [ ] **K31 item 2 — backup restore upload capped at ~50 MB/attachment** — raise/limit with a clear over-limit message.
- [ ] **A11Y feature-gaps (A11Y-9, 10, 12, 17, 39, 40, 51)** — Menu arrow-nav/type-ahead, focusable rows, per-group collapse, focusable bulk-failure items, relative type scale, contrast harness.

## Contract changes — schema / core signature / on-disk shape (multi-surface)

- [ ] **An unreadable `task.md` reports as "task not found" in every surface (TSK-54, XS-51)** — 404/500 split in `lookupByKey` violates ERR-1. Core; owes all three surfaces. `task/lookup.ts:120`. **[now]**
- [ ] **DEG-4-PROV — repair provenance (`meta.was_corrupt`) decided but not built** — `buildSetFieldHistory` must consult `health`. `task/update.ts`. **[now, small]**
- [ ] **BLK-44 — one malformed task.md breaks the whole list** — `loadAllTasks` must become partial-tolerant (a data-shape change all three surfaces read); the BLK-44 indicator case also needs writing. `task/load-all.ts:61`.
- [ ] **`setField` records the unresolved name in history, so burndown ignores name-assigned tasks (MSL-C1)** — fix both `buildSetFieldHistory` call sites; raises a migration question for existing history.
- [ ] **A UI view write drops a concurrently-present broken view (VUE-22 area)** — `saveQueriesConfig`/`serializeQueriesConfig` never emit `broken`; P1 data-loss. (Refuse-vs-preserve is a ruling — see below.)
- [ ] **K29 — flat config writers can append a broken/valid ID collision (DEG-24)** — six flat writers lack the `mergeBrokenIntoPlain` guard added for workflow.
- [ ] **DUP-H1 — `duplicateTask` does not report dropped corrupt fields** — return-shape change threaded through CLI/MCP/web.
- [ ] **`field != null` does not filter — it returns everything** — shared-core query-evaluator defect; silent + permissive. Needs a `!= null` semantics call, then a fix in the core evaluator.

## Needs a ruling from Ken — do not build until decided

- [ ] **NEW-20** — should a `default:` naming a nonexistent project be a hard config error (current) or tolerated drift the resolver skips?
- [ ] **`loctt init --prefix` accepts prefixes that break their own task URLs (A80)** — a core validator would break existing trackers → migration decision. Also: where a prefix-format rule lives is unsettled.
- [ ] **PRU-46's pending-rename banner is unreachable dead code** — keep auto-recovery (retag + delete dead code) vs. make recovery boot-only.
- [ ] **BAK-C18 — dangling-reference handling reports rather than refuses** — case says refuse; P-11/P-12 say report. Case-vs-invariant contradiction.
- [ ] **BAK-C13 — a displaced body is not carried by a later backup** — clean fix is a new backup record kind (no case describes it).
- [ ] **Read-only views do not surface degraded entries (ERR-10, LST-51, TML-48)** — should a degraded-but-loadable config alert on a read-only view, or only in settings?
- [ ] **TSK-32 contradicts the DEG-29 "Not recognised" group** — two-case contradiction.
- [ ] **Broken-view write: refuse vs. preserve** — the ruling behind the VUE-22-area contract change above.
- [ ] **DS-A11Y40 checkbox/radio border below 3:1** — deepen `--border-strong` (a global semantics call) or add a `--border-control` token.
- [ ] **DS-BORDER-SUBTLE below 3:1** — strengthen `--border-subtle`, or migrate real-divider call sites to `--border-default`.

## Tooling / flake — infra, not product (fix opportunistically)

Test-infra and environment notes, mostly guidance already followed. The
actionable ones:

- [ ] **Add `eslint-plugin-react-hooks`** (rules-of-hooks as error) — it cost a real bug once (the render-loop). Dependency add = a scope call.
- [ ] **Coverage gate reads case IDs out of prose, not only tags** — require the tag to be the first non-space content of its comment line. `tools/coverage/main.ts`.
- [ ] **Test runs leak temp trackers until the disk fills** — widen the sweep to `$TMPDIR/loctt-*` with an age filter, or move fixtures under `tests/workspace/`.
- [ ] **Removing a worktree leaves its `loctt ui` server running** — fixture should register teardown on SIGINT/SIGTERM.
- [ ] **Verify `maxWorkers: 2` is actually in `vitest.integration.config.ts` / `vitest.e2e.config.ts`** — the over-parallelisation fix; confirm it carried.

Open flakes still to root-cause (re-run before believing; check `uptime`):
REL-32 (a possible read-modify-write race — worth a sweep of every RMW),
the ArrowUp double-press drop (REL-32 area), REL-30/REL-32 load-sensitive
specs, PRU-42's `userIdByName` helper under `--workers=5`, SPR-6 under
full-file parallelism.

Standing guidance (not tasks — captured in `lessons.md`): stale-`dist`,
one-suite-at-a-time, `npx tsc --noEmit -p` typechecks nothing, jsdom
timers past teardown, `caffeinate` for long runs.

---

## Also verify (status ambiguous in the source)

- [ ] **SHL-33** — the entry reads open but a 2026-09-05 batch says it was built + covered; confirm and strike if resolved.

---

*Created 2026-09-09 during the repo sweep. Roughly 20 features, 8
contract changes, 10 rulings, plus quick fixes and doc holes. When one is
built, close it here and delete the corresponding known-gaps entry.*

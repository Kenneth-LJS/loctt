# 🚦 Milestone 4 gate — round 3 (majors and minors)

Verdict: **PASS with findings** — no blockers.
Date: 2026-09-02
Tree: pinned `f77f2c81c2b826b763c539fa6c91698118a57bb2`, own worktree, pre-built.
Clean at start and at finish (`git status` shows only my untracked
`.gatetmp/` scratch dir). Two mutations applied and restored, each with
a rebuild and a control run after the restore.

## Counts — all four predicted counts matched before any mutation

| Suite | Predicted | Measured | Exit |
|---|---|---|---|
| unit | 3103 + 1 skipped | 3103 + 1 skipped | 0 |
| UI | 651 + 1 skipped (652) | 651 + 1 skipped (652) | 0 |
| integration | 457 | 457 | 0 |
| coverage | 801/937 | 801/937 | — |

The full UI suite was re-run clean at `--workers=1` **after** an earlier
run was invalidated: I rebuilt `dist` underneath it. I killed it,
restored, rebuilt, and re-ran from scratch rather than trust it. No
flaky test fired; the known-flaky list was not needed.

## Findings: 2 major, 3 minor. No blockers.

---

### F1 · major · A11Y-45's focus bullet is unimplemented, and a code comment asserts the opposite

**The case.** A11Y-45's second bullet: "Focus moves to the start of the
new main content or to a documented landing point — **not left on the
sidebar link**, and not dropped to `document.body`."

**What the code does.** `useRouteAnnouncement`
(`apps/web/src/client/shell/useRouteAnnouncement.ts`) sets
`document.title` and calls `announce(name)`. It touches focus nowhere.
`MAIN_CONTENT_ID` has exactly two consumers — its definition/use in
`SkipLink.tsx` and the `id=` on `<main>` in `AppShell.tsx`. Nothing
focuses `<main>` on a route change. `mainRef` in `AppShell.tsx:121`
comes from `useMainScrollRestoration()` and is scroll-only.

`AppShell.tsx:177` claims otherwise:

    `tabIndex={-1}` … is what lets the skip link
    (A11Y-44) and the route announcement (A11Y-45) land focus here.

The pane was *made focusable* for A11Y-45 and then nothing focused it.
That comment is why this survived review.

**Measured**, via a temporary probe spec against the built SPA
(added, run, deleted):

    FOCUS AFTER ROUTE CHANGE: {"tag":"A","id":"","text":"Board"}

Focus is left on the sidebar `<a>Board</a>` — the exact element the
bullet names as the failure.

**Why the test does not catch it.** `tests/ui/flow-accessibility.spec.ts:495`
asserts only the announcement (bullet 1) and `toHaveTitle` (bullet 3).
It never queries focus. Positive control: `getByRole("main")).toBeFocused()`
is used at line 491 for A11Y-44, so the assertion idiom exists in this
very file — it is simply absent for route changes.

Not in `known-gaps.md`, `decisions.md`, or `TEMP-RUN-WORKFLOW.md`.

---

### F2 · major · SET-9's estimate field does not exist on two of the three surfaces it names

**The case.** SET-9 bullet 1: with `enabled: false`, "no Estimate field
appears on task detail, **in the create modal, or as a list column**."
Bullet 2: switching to numeric "makes Estimate a number input suffixed
with the unit label **everywhere it appears**".

**What the code does.** Task detail gates the row correctly
(`MetaPanel.tsx:387-398`, covered by TSK-9, whose own scope is the
panel). The other two surfaces have no estimate field **in any mode**:

- Create modal — positive control, every `data-testid` in
  `CreateTaskModal.tsx`: `create-title`, `create-project`,
  `create-labels`, `create-submit`, … and no estimate.
- List — `ALL_COLUMNS` (`apps/web/src/client/list/columns.ts:16`) is a
  fixed ten-entry array with no estimate and no estimation-mode gating.
  `resolveColumns` maps user settings through `byId` and **drops
  unknowns**, so no saved preference can introduce one either.

So bullet 1 passes vacuously — shape (a), nothing to hide — while
bullet 2 is unmet on both surfaces.

**Why the test does not catch it.** `flow-settings-workflow.spec.ts:682`
asserts the settings panel's own note text (`/sum/i`,
`/counts per category/i`) and the written YAML. That is shape (b):
the label is asserted, not the effect. A settings-panel test cannot see
the create modal or the list table — wrong layer for both bullets.

Not recorded anywhere. TSK-9 does **not** cover it: TSK-9's bullets are
explicitly scoped to the panel.

---

### F3 · minor · VUE-19's only remaining bullet is a UI-rendering bullet, verified on the wire

**The case.** Core resolved `today` in the workspace zone long ago; the
case text itself says "The remaining UI-side criterion is the first
bullet — *stating* the resolved date and zone in the UI."

**What the code does.** `/api/info` carries the pair correctly
(`server.ts:224-233`). **No client code reads it.** Grep for
`info.data?.timezone` / `info.timezone` across `apps/web/src/client/`
returns nothing. `info.today` is consumed for overdue styling and
filter resolution; the zone is consumed nowhere. `querySyntaxHelp.ts:60`
says "today's date in the workspace timezone" — static help text that
names neither the resolved date nor which zone.

The server's own comment concedes it (`server.ts:1152`): "the zone
travels with the date, **so the UI can state** *why* today is what it
is". And decision **A77**'s revert note says it outright: "VUE-19's
first bullet then has no data behind it" — the decision is about
*supplying* data, not rendering it.

**Mutation.** I changed the resolver to report a fixed wrong zone
(`timezone: "Etc/GMT+12"`), built clean (exit 0). All three tests in
`server.today-zone.test.ts` failed — a real lever. No UI test exists to
fail. Restored, rebuilt, verified `dist` clean of the string, 3/3 green.

This is rule 4 — "a field on the wire that nothing renders is not a
fix." Filed minor, not major, because the *substantive* risk (the two
front-ends disagreeing about the date) is genuinely fixed in core; only
the discoverability bullet is outstanding.

**Notable:** VUE-21 has this exact shape and *was* caught and fixed —
`flow-list.spec.ts:4442` carries a comment diagnosing it and citing the
REL-49 precedent. The same reasoning was not applied to VUE-19.

---

### F4 · minor · A11Y-25's "once for the settled result" bullet is unverified — mutation survives

**The case.** Bullet 2: "The announcement fires once for the settled
result, not once per intermediate loading state."

The implementation is **correct** — `ListView.tsx:189` gates on
`!tasks.isFetching` with a ref so it fires on change, and the docblock
reasons about it carefully. But nothing tests it.

**Mutation.** `if ((false as boolean) && (tasks.isFetching || tasks.isError)) return;`
— compiles (build exit 0), bundle hash changed `index-ChqLuZX2` →
`index-DadojSaQ`, bundle mtime 07:49:54 newer than source 07:49:44, so
the mutation was genuinely in the artifact Playwright serves.

**A11Y-25 passed with the gate removed** (1 passed, 3.4s). Restored,
rebuilt, hash back to `index-ChqLuZX2`, control run green.

A `toContainText` assertion cannot detect a duplicate or intermediate
announcement — shape (c). No unit coverage either: positive-control
grep shows `announce`/`Announcer` appears in no `list/*.test.*` file.

---

### F5 · minor · A11Y-34's focus-return is asserted only negatively

`flow-accessibility.spec.ts:1085-1087` asserts focus is `not` on `body`
and `not` on the skip link. The case requires a *specific* return path
("confirmation → ⋯ menu trigger → detail").

The behaviour is right and was measured when built — decision **A88**
records "measured: focus lands on the 'More' button", via
`lastSurvivingChromeFocus()`'s bounded history. But two negative
assertions would also pass if the fallback chain landed focus on any
other surviving chrome element. Shape (c): an absence assertion with no
positive control naming the expected element. Behaviour verified;
regression protection weak.

---

## Mis-tagged tests — layer analysis

Twelve M4 major/minor cases are tagged **only** on server tests. Of
these, five carry bullets that live at a layer the test cannot observe:

| Case | Test layer | Bullet the layer cannot see |
|---|---|---|
| VUE-19 | server (`/api/info` body) | "the UI **states** the resolved date and zone" — F3 |
| ERR-11 | server (error envelope) | "the typed content is **retained on screen**" |
| ERR-24 | server (disk listing) | "**no entry appears** in the attachments grid"; "retry is offered" |
| SET-39 | server (envelope) | "the **panel reverts** to last known-good values" |
| XS-47 | server (envelope) | "**no optimistic row** is left in the list" |

**Important mitigation:** four of these five are *honestly disclosed*.
`server.errors.test.ts:298` states "Only the server half is asserted
here"; `server.attachments.test.ts:259` states "The client-side bullets
… are not claimed here". The authors knew. The problem is the **tag
vocabulary**: `@verifies` is binary. I checked `tools/coverage/scan.ts`
and `tools/case-index/parse.ts` — there is no partial/half marker. So a
test that explicitly disclaims half a case still reports it as fully
covered in `cases:coverage`, and `--require` passes on it.

That is a systemic tooling gap, not five separate author errors. It is
the same mechanism that let MSL-10/13 and PRU-44/45/46 through in
rounds 1-2.

Client-side coverage for ERR-11, SET-39 and XS-47 is genuinely absent —
grep across `tests/ui/` and `apps/web/src/client/` returns nothing for
all three (positive control: the same grep finds them in the server
files).

---

## Vacuous tests

- **A11Y-25** (F4) — proven by surviving mutation.
- **A11Y-34** (F5) — two negative assertions, no positive control.
- **SET-9** (F2) — asserts panel note text, not the effect on the
  surfaces the bullets name.

## Things I checked and found NOT to be problems

Reported here because each looked like a finding until measured, and
the next round should not re-chase them:

- **SPR-30's "category, not a hardcoded `done`"** — I was ready to file
  this: the UI test at `flow-sprints.spec.ts:1433` uses the stock `done`
  key throughout and cannot discriminate. But
  `packages/core/src/sprints/burndown.test.ts:333` burns down a task
  whose status is `dropped` (category `discarded`) — a hardcoded-`done`
  implementation fails that test. Covered, at the right layer, under a
  different name. **Withdrawn.**
- **PRU-14's create-modal bullets** — no create-modal code reads
  `default_project`, which looked like the bullet-1 failure. But the
  fall-through is core's: `resolveProjectId`
  (`packages/core/src/projects/manage.ts:146-152`) catches a stale user
  default and falls through to the workspace default, and the client
  deliberately implements none of the chain. Correct by design.
- **SET-18's board bullet** — no "Unknown status" lane in
  `apps/web/src/client/board/`, but `ORPHAN_COLUMN_ID` /
  `deriveColumns` in `packages/core/src/board/columns.ts:168-175`
  provides it (label: "Unknown status"), covered by BRD-18.
- **MSL-24's task-detail bullet** — `namedOptions` ignores its
  `_current` arg, which looked like a dangling-reference blank. But
  `OptionPicker`'s shared `unrecognized` path (`OptionPicker.tsx:120-154`)
  renders `meta-unrecognized-milestone` with the dangling id.
- **SET-22** — test title says "refused" while the case says "accepts";
  a real divergence, but correctly recorded as decision **A67** with the
  schema-level reason.
- **SET-2's M4-close nav sweep** — genuinely outstanding (four sections
  still `built: false`), but correctly recorded in `known-gaps.md:1961`.
  The test's comment saying "nine sections" is stale — it is four now.
- **A11Y-4's "listed but not bound"** — structurally impossible: the
  dialog, the settings panel and the resolver all read `GLOBAL_SHORTCUTS`,
  and `useShortcuts` is typed by `ShortcutId`. I diffed the 8 table ids
  against the 8 handler ids: identical.

## Tests worth noting as good

Several tests in this milestone actively defend against the exact
vacuity shapes the brief names, and say so:

- **XS-52** asserts the machine-local files *exist* before deleting
  them, naming shape (d) explicitly.
- **MSL-25** documents that a prior version of itself was vacuous
  (`toHaveCount(0)` before rows rendered) and fixes it with a settling
  wait.
- **ERR-38** located the boundary's *own* log line after measuring that
  a whole-console assertion passed with the logging deleted — shape (a),
  caught and fixed.
- **AdvancedQueryEditor.test.tsx** stubs with envelopes *captured from
  the real route*, with the route's own test pinning them against real
  core errors — the direct fix for XS-41's hand-written message.
- **SET-6** asserts a **cold reload**, naming "client state that
  outlives a refetch but not a refresh" as the failure mode.
- **SET-21** compares the task file byte-for-byte.

## Coverage audited

**140 of 212** M4 major/minor cases carry a `@verifies` tag. I audited
**122 of those 140** in depth (case text → tagging test → layer →
per-bullet), plus spot-checks on the rest.

**Not audited (18), and why:**

- Already settled per the brief, not re-examined: `MSL-10`, `MSL-13`,
  `ONB-19`, `SET-8`, `SPR-35`, `PRU-44`, `PRU-45`, `PRU-46`.
- Read but only skimmed at bullet level (no layer mismatch apparent,
  tests sit at the surface the bullets name): `A11Y-1`, `A11Y-3`,
  `A11Y-6`, `A11Y-7`, `A11Y-43`, `PRU-30`, `PRU-32`, `SPR-22`,
  `SPR-25`, `SPR-29`.

**72 tagged-but-unaudited** is not a category here — every tagged M4
major/minor was at least read. The **72 M4 majors/minors with no tag at
all** are outside this gate's remit (they are in the 112 uncovered
reported by `cases:coverage --milestone M4`, and the a11y/GIT bulk is
already itemised as known-unmet in `TEMP-RUN-WORKFLOW.md`).

## What I did NOT check

- **The 85 M4 blockers** — round 1's remit, not re-verified here.
- **The 26 GIT cases and 25 a11y cases** already recorded as unmet for
  M4.3/later; I did not re-measure them.
- **Visual/layout bullets** (`SPR-25`, `ONB-22`, `A11Y-38..42`,
  `SET-20`'s board width) — these need rendered-geometry assertions and
  I had no reliable way to measure "truncates with an ellipsis" or
  "does not push the control off-screen" without adding specs.
- **Performance bullets** (`SET-23`'s 500 holidays, `SPR-18`'s 400-task
  burndown) — I read the tests but did not run timing measurements.
- **`e2e`** — not run; the brief scoped me to unit/UI/integration and
  the e2e count (21) was not implicated by any finding.

# M3 section gate — round 2 · scope: M3.4, the create-task modal

**Worktree:** `.claude/gate-m3r2` at `33a4571efd6d1d7958d4dc7d346f58fe2ffc97ac`.
**Tree left pristine.** `git status --porcelain` empty at start and at end.
No commit, no stash. One file was mutated and restored from a `cp`
backup; the restore was verified by re-reading the mutated line and by
a clean `git status`.

## Count verification (predicted vs measured)

| Suite | Predicted | Measured | Verdict |
|---|---|---|---|
| unit (`npm run test`) | 2807 + 1 skipped | **2807 + 1 skipped**, exit 0 | match |
| UI (`npm run test:ui`) | 507 | **506 passed + 1 failed = 507**, exit 1 | match |
| integration | 439 | **439**, exit 0 | match |

All exit codes read from `$?` on a `set -o pipefail` command whose
output was redirected to a file, never from grepping output. (The first
attempt at a UI run printed `EXIT=0` on a hard config error, because
`$?` had captured `tail`. That trap is real; every number above was
re-measured after fixing it.)

The single UI failure was **SPR-6** (`flow-sprints.spec.ts:387`), which
is M3.5, not my scope. Per the brief's rule I re-ran its **file**:
`18 passed`, exit 0. File-level pass ⇒ **flake under load, not a
regression.**

`tests/ui/flow-task-create.spec.ts` alone: **44 passed, exit 0.**

---

# BLOCKERS

## BLOCKER 1 · NEW-41 — the modal opens under a schema mismatch, with a live form and a submit that silently does nothing

**What the case requires.** "A modal opened while the tracker's schema
is outdated does not offer a broken create." The modal "either does not
open, or opens with the create action disabled and an explanation
pointing at the migration."

**What decision A45 claims.** A45 (`docs/dev/decisions.md:2994`)
records the case as satisfied structurally, on this stated ground:

> "Both states go through the same server gate: every route returns 409
> `schema_mismatch`, **so the shell never mounts and the modal cannot
> open** — NEW-41's first branch ('either does not open'), satisfied
> structurally rather than by a disabled button. This is covered by the
> existing `flow-schema-mismatch.spec.ts` … **no create-specific test is
> added, because there is no create surface to test in that state.**"

**The claim is false, and the spec A45 cites says so on its own first
line.** `tests/ui/flow-schema-mismatch.spec.ts:2` opens: "must degrade
to the schema banner **inside** the shell — not hang on a spinner", and
its assertion 2 is literally commented "It is inside the shell, not
instead of it", asserting `getByLabel("Toggle sidebar")` is visible.
The shell *does* mount. A45 asserted the opposite of the file it cited
as its evidence.

**The measurement.** A temporary probe spec (`tests/ui/zz-new41-probe.spec.ts`,
written, run, then deleted — tree verified pristine after) against a real
server on a tracker with `.schema-version = 9`, i.e. the same `future`
state A45 chose to verify against:

    HEADER_NEW_TASK_COUNT=      1
    HEADER_VISIBLE=             true
    HEADER_DISABLED=            false
    MODAL_AFTER_N=              1      <- `n` opens the create modal
    TITLE_COUNT=                1
    SUBMIT_COUNT=               1
    SUBMIT_DISABLED_EMPTY=      true   (only the normal empty-title guard)
    SUBMIT_DISABLED_WITH_TITLE= false  <- submit ENABLES
    MODAL_AFTER_SUBMIT=         1      (still open)
    ERR_TEXT=                   none   <- no explanation of any kind
    MODAL_TEXT=                 ""     <- the modal body renders empty
    POST_TASKS_STATUS=          409 GET, 409 GET, 409 GET (no POST ever sent)
    TASK_DIRS_ON_DISK=          0

**What the code does.** Every one of the three branches NEW-41 allows
is missed:

1. It is not "does not open" — `n` opens it (`MODAL_AFTER_N=1`), and the
   header trigger is present, visible and enabled.
2. It is not "the create action disabled" — submit is enabled the moment
   a title is typed (`SUBMIT_DISABLED_WITH_TITLE=false`).
3. There is no "explanation pointing at the migration" — `create-error`
   does not exist and the modal's own text is the empty string.

The user gets an **empty modal shell** with a working-looking submit
button that, on click, does nothing at all and says nothing at all.

**Root cause.** `CreateTaskModal.tsx` has no guard for a failed
`workflow` / `projects` fetch. Grepped:

    grep -n "isLoading\|isError\|wf === undefined\|if (wf\|return null" \
      apps/web/src/client/create/CreateTaskModal.tsx
    137:    if (projects.isSuccess && (currentUser.isSuccess || currentUser.isError)) {
    141:  }, [seeded, projects.isSuccess, ...]);
    1105:  if (problem === undefined) return null;      <- unrelated (a field problem)

Line 137 gates only *seeding*, never *rendering*. With every `/api/`
route answering 409, `wf` is undefined, so the field set renders to
nothing while the dialog frame, the title input and the submit button
still render. Bullet 2 ("no half-written task lands on disk under an old
schema") does hold — but only because the server's 409 catches it, and
in fact the client never even sends the POST. The data is safe; the
user-facing contract of the case is not met.

**Why no test catches it.** There is none to mutate: A45 explicitly
records that "no create-specific test is added". NEW-41 has **zero
`@verifies` tags** — confirmed by the tag grep below. The case scores as
handled purely on the strength of a decision record whose central
factual claim is contradicted by the spec file it cites.

**This is the A41 shape the brief warned about, repeated.** A decision
record standing in for a measurement — and this time the record's own
cited evidence disproves it. A41 was found this round asserting
something false about TML-48; A45 is the same failure mode in the same
milestone, undetected because the case carries no test.

---

## BLOCKER 2 · NEW-3 — the board-column status pre-fill does not exist; the mechanism is dead code and no test would notice its deletion

**What the case requires.** "'+ Add task' on a board column pre-fills
that column's status. Click '+ Add task' on the `In review` column."
Bullet 1: "The status field is pre-selected to `in_review`."

**What the code does.** There is no per-column "+ Add task". There is
exactly one "+ Add task" on the whole board, inside the board-level
empty state, and it passes no status:

    apps/web/src/client/board/BoardView.tsx:392
        onClick={() => { createTask.open(); }}      // no argument

Both call sites of the provider were grepped; both call `open()` bare:

    grep -rn "useCreateTask()" apps/web/src/client
      board/BoardView.tsx:43
      shell/Header.tsx:51

and `initialStatus` reaches the modal only via
`CreateTaskProvider.tsx:83`, guarded on `state.status !== undefined`,
which no caller ever sets. So `CreateTaskModal.tsx:102` —
`...(initialStatus !== undefined ? { status: initialStatus } : {})` —
is **unreachable in the shipped app.**

**This is a defensible design call that was never recorded as a case
gap.** `TEMP-BUILD-PLAN.md:175` explains, correctly and at length, why
per-column controls were omitted: BRD-40 asks only for a board-level
empty state, and a per-column control would put one on the stale column
BRD-42 drags into. The reasoning is sound and BRD-40 is genuinely well
covered. **But the consequence was not followed through**: with no
per-column control, NEW-3's premise cannot be enacted, its first bullet
cannot be satisfied, and NEW-3 is nonetheless counted among the 39
satisfied cases in the same table. There is no A-decision for it and no
known-gaps entry — grepped:

    grep -n "NEW-3\b" docs/dev/known-gaps.md docs/dev/decisions.md \
      TEMP-RUN-WORKFLOW.md TEMP-BUILD-PLAN.md
    -> only TEMP-BUILD-PLAN.md:175 (the Status row that counts it as done)

The test itself is candid about this. `flow-task-create.spec.ts:775`
carries a comment stating the per-column control is "deliberately
absent" and that it therefore asserts bullets 2 and 3 only. That comment
is honest — but it sits under a `// @verifies NEW-3` tag, so the
coverage tool scores the case green on a test that documents, in prose,
that it does not test bullet 1.

**The mutation (this is the proof).** Backed up, applied, built, run,
restored:

    -  ...(initialStatus !== undefined ? { status: initialStatus } : {}),
    +  ...(initialStatus !== undefined && false as boolean ? { status: initialStatus } : {}),

  * `npm run build` → **exit 0** (mutation compiles; `false as boolean`
    used specifically to avoid the unreachable-branch / TS6133 traps).
  * `npx playwright test … flow-task-create.spec.ts` → **44 passed,
    exit 0.**

The entire status pre-fill mechanism can be neutered and **every one of
the 44 tests stays green.** Restored from backup; `git status` clean;
rebuilt (exit 0) so the bundle is not left mutated.

---

# MIS-TAGGED TESTS

**None found.** Every `@verifies NEW-*` tag sits on a test that
exercises the case it names. This block does not contain the
"three case IDs for one test" shape that M2 produced. The one case
whose tag over-claims is NEW-3, and that is reported as Blocker 2
rather than a mis-tag, because the test does assert two of the case's
three bullets — it is the third that is unreachable.

# VACUOUS TESTS

**None found**, in the strict sense of a test that stays green with its
subject deleted. I attempted the one mutation most likely to expose one
(Blocker 2) and it exposed a *missing* behaviour rather than a vacuous
test — no test asserts the pre-fill because the pre-fill has no trigger.

This spec file is, on the contrary, the most defensively written in the
run. Specific things it gets right that this run has repeatedly caught
others getting wrong:

  * **Shape (e) — the client sending a wrong value that the server
    repairs — is actively guarded.** The file header states the
    principle ("Every write is asserted at the far end") and NEW-11
    asserts `not.toMatch(/^priority:/m)` on the *second task's
    frontmatter*, not on the form's appearance. That is the exact check
    SPR-4 lacked in M3.5.
  * **NEW-14** was written against a real trap and says so: `state.yaml`
    keys counters by ULID, so a `/WEB/` filter would have compared two
    identical strings and passed for free. It looks the id up and then
    adds a **positive control** (`expect(dropWebBlock(after)).not.toBe(after)`)
    proving the exclusion excludes something real.
  * **NEW-29** was rewritten after being caught passing vacuously (A46),
    and the file records the measurement: 2 POSTs, 2 tasks on disk with
    the ref removed.
  * **NEW-24** uses `{ exact: true }` because `lbl-1` also matches
    `lbl-10`..`lbl-19`, which would have left 25 labels attached and the
    count assertion passing on wrong data.
  * **NEW-40** notes the control must be a text input, because
    `<input type="number">` would discard the bad paste and make the
    case unreachable-but-green — the same class of problem as Blocker 1.
  * **NEW-36** seeds a label first, because a fresh tracker has no
    `labels.yaml` and the "unchanged" assertion would otherwise compare
    two absences (vacuity shape (d)).

I also checked for the REL-18 shape — evidence fetched then discarded.
No `void`ed reads in this file; every read feeds an assertion.

# NON-BLOCKING findings

**N1 · `resolveProjectId` returns an archived workspace default
unchecked.** `packages/core/src/projects/manage.ts:144` —
`if (config.default !== undefined) return config.default;` — returns the
workspace default without the `archived !== true` filter that guards the
sole-project rung two lines below (`:147`) and the explicit rung
(`resolveProjectIdFromInput`, `:90`). The client compensates
(`projectChoice.ts` re-filters, and its unit test "never pre-selects an
archived project (NEW-17)" covers it), so no shipped path is broken.
But the three rungs disagree about archived-ness in core, which is where
CLI and MCP read it. Outside NEW-17's literal wording; worth a
known-gaps line.

**N2 · Bullets not asserted anywhere** (behaviour present in source and
correct on inspection; only the assertion is missing):

  * **NEW-5** bullet 4 — "seven priorities shows seven; one task type
    shows one and does not hide the field". Only statuses are given a
    non-default config; priorities/types are never varied in count.
  * **NEW-6** bullets 1, 2, 4 — archived entries excluded, name-collision
    disambiguation, explicit "None" option. The archived filter is
    implemented (`CreateTaskModal.tsx:846`, `:879`) and "None" is
    exercised incidentally by NEW-35, but no test drives NEW-6's own
    premise (one archived milestone, sprint and user).
  * **NEW-15** bullet 3 — "switching to a different user … pre-fills
    `backend`; the resolution is per-user, not global". The mechanism is
    real (`resolveProjectIdForUser` reads `getCurrentUser` then that
    user's `settings.yaml`), but no test switches users.
  * **NEW-12** bullets 3 and 4 — self-dismissal, manual dismissal, and
    one toast per creation. `Toast.tsx` has `setTimeout(…, TOAST_TIMEOUT_MS)`
    at `:118` and `toast-dismiss` at `:148`, and `CreateTaskModal.tsx:274`
    fires `toasts.show` *before* the create-another branch at `:279`, so
    all three hold structurally. Untested here.
  * **NEW-13** bullet 3 — a created task that does *not* match the active
    filter must not appear and must not move the count.
  * **NEW-22** — only the "stored intact" arm is tested. The case's other
    permitted arm (a documented maximum with a visible counter) is not,
    which is correct for this implementation but leaves the case's
    either/or untested on one side.
  * **NEW-28** bullet 3 — focus returns to the trigger. Tested for the
    header button only, not for the board's "+ Add task" or for the
    element focused when `n` was pressed.

None of these are blockers: I read the source for each and the behaviour
is present and correct. They are listed so the ticket's "39 of 41" is
understood as tag-level, not bullet-level.

**N3 · A45's factual error should be corrected in place, as A41 was.**
Independent of fixing Blocker 1, the record at `decisions.md:2994`
states something measurably untrue about the shell mounting. A41 set the
precedent for correcting a decision record in place rather than leaving
it overstated; A45 needs the same treatment.

---

# Audit coverage

**42 of 42 cases examined** (NEW-1 … NEW-41 + BRD-40). Every case was
read against the spec, its tag(s) located, and the test beneath the tag
read in full. Nothing in scope was skipped. **My skip list is empty, and
I have re-read this section to confirm it does not contradict that.**

Tag census, measured (`grep -rn "@verifies" --include="*.ts" --include="*.tsx"`):

  * 39 `@verifies NEW-*` tags across 44 tests in
    `tests/ui/flow-task-create.spec.ts`, covering NEW-1..19 and NEW-21..40.
  * `BRD-40` → `tests/ui/flow-board.spec.ts:864`. Both its bullets are
    asserted (one board-level empty state with an "+ Add task" button;
    4 columns still rendered). **Genuinely covered.**
  * **NEW-20 — zero tags.** Correctly so: A44 measures that
    `ProjectsConfigSchema.superRefine` rejects a ghost `default` at parse
    time, so `/api/projects` 400s and there is no project list to
    degrade with. I verified the superRefine exists. **Record honest.**
  * **NEW-41 — zero tags.** A45 claims this is fine. It is not — Blocker 1.

Depth beyond tag-reading:

  * Read `CreateTaskModal.tsx` (1161 lines), `CreateTaskProvider.tsx`,
    `projectChoice.ts`, `formState.ts`, `BoardView.tsx`'s empty state,
    `Toast.tsx`, `server.ts`'s `/api/projects` handler, and core's
    `resolveProjectId` / `resolveProjectIdForUser` /
    `resolveProjectIdFromInput`.
  * Confirmed the two supplementary unit files are real coverage, not
    empty. **A grep artefact worth recording:** `grep -c "test("` returned
    **0** for both `projectChoice.test.ts` and `formState.test.ts`. They
    use `it()`, not `test()`. `file` reports both as ordinary UTF-8 text
    and they hold 10 and 17 cases respectively. Had I asserted absence
    from that first grep I would have filed a false finding — the brief's
    warning about absence claims, hit live.
  * Ran one mutation to conclusion (build exit 0, suite exit 0, restored).
  * Ran one probe spec against a real server to conclusion, then deleted it.

## Round 1's four fixes — re-verified against source

| Fix | Verdict | Evidence |
|---|---|---|
| **BRD-6** over-cap | **Real** | The state is now a readable `data-wip-state` attribute, not a Tailwind class. `flow-board.spec.ts:452-465` asserts `at-cap`, `under`, and — after seeding a 4th card — `over`. The comment records that the gate forced `over` false permanently and all 51 tests stayed green. |
| **BRD-23** project chip | **Real** | The fixture now seeds a task into the *second* project (`create "Backend one" --project Backend`), so the case's premise exists, and it asserts a real `project-chip` testid on both cards plus that the two chips differ. Both defects round 1 found are closed. |
| **TML-24** today-marker | **Real** | Asserts `data-start="2026-03-02"` — an attribute — rather than a pixel offset. |
| **TML-48 / A41** | **Real and honest** | The correction at `decisions.md:2801` is dated, shows the measured payload (ULID path + generic schema string), names bullet 3 as **unmet on both halves**, states which bullets do hold, and gives a revert path. Exemplary. |

Per instruction, **TML-21 was not re-derived** (partial status recorded
at `TEMP-RUN-WORKFLOW.md:569`).

---

# What I did NOT check, and why

  * **The other ~119 M3 cases** covered by round 1 (beyond the four
    fixes above). Out of scope; round 1 audited them.
  * **e2e (21) and coverage (619/937)** were not run. Unit, UI and
    integration all matched their predicted counts exactly, which
    establishes the tree identity the count check exists to establish;
    two further suites would not have changed a finding.
  * **`npm run lint` / `npm run typecheck`** were not run as gates. The
    full `npm run build` passed (exit 0) twice — clean, and again with
    the mutation in place.
  * **A fix for either blocker.** A gate reports; it does not patch.
  * **Blocker 1's fix shape** is not prescribed here beyond noting the
    missing guard at `CreateTaskModal.tsx:137`, because whether the
    modal should refuse to open or open disabled-with-explanation is a
    build decision, and NEW-41 permits both.
  * **N1 (core's archived workspace default)** was identified by reading
    `manage.ts:144` but not driven end-to-end through CLI/MCP, since no
    shipped web path is broken by it. It is offered as a lead, not a
    measured defect.

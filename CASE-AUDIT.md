# Case audit — `ui-test-cases/` + `surface-test-cases/`

**Read-only.** Nothing under `docs/dev/ui-test-cases/` or
`docs/dev/surface-test-cases/` was edited, and no source or test was
touched. This file is new.

**Scope actually covered:** the M3/M4 flows the brief prioritised —
board, timeline, sprints, settings, onboarding — plus
milestones/labels, saved views, and all 68 surface cases. See § 5 for
what was skipped and why.

**Ground rule followed:** every claim below names the command run and
its output. Where a previous audit's claim dissolved on measurement,
that is recorded too (§ 2.7, § 3.4) rather than repeated.

**The distinction that matters.** Each item is tagged:

- **CHANGES A TEST** — the case is right; the test is wrong, missing,
  or asserting nothing. Safe to act on.
- **CHANGES THE PRODUCT** — the case implies behaviour that does not
  exist, or two cases require different products. **These need Ken's
  approval before anything is built.** They are collected again in
  § 6 so they cannot be missed.

---

## 1. Contradictions

### 1.1 SET-13 vs SET-27 — and SET-13 vs the README's own P7 amendment

**Severity: blocker (P7).** **CHANGES A TEST.**

`README.md:190-198` amends P7 with "No carve-out for per-user
preference drift", and states the amendment resolves the
"SHL-32 / SET-13 / SET-27 / XS-28 disagreement **in favour of the
explaining cases**", listing SHL-32, PRU-14 and NEW-16 as "corrected".

SHL-32 and PRU-14 did receive the corrective note. **SET-13 did not.**

```
$ grep -n "silently" docs/dev/ui-test-cases/flow-settings.md
118:- A pin referencing a view since deleted from `queries.yaml` is dropped
     silently from both the panel and the sidebar …
233:- The pins panel says the pins were removed because their views no
     longer exist, rather than silently emptying.
```

Line 118 is SET-13; line 233 is SET-27. They are 115 lines apart in the
same file and mandate opposite behaviour for the same event (a pinned
view deleted from `queries.yaml`). SET-13 also directly contradicts the
README amendment that names it.

SHL-32 for comparison (`flow-app-shell.md:245-249`) carries: *"This case
previously asserted the entry was dropped silently. P7 admits no
carve-out…"*.

**Why it is a test change, not a product change:** the README already
recorded the ruling and two of the four cases were updated to match.
SET-13's bullet is an un-applied edit, not an open question. The test
should assert what SET-27 and SHL-32 assert — the pins panel names the
removed view — and SET-13's silent-drop bullet is the one that is
stale.

### 1.2 SPR-1 vs SPR-7 — the sprint route needs a key the schema has no field for

**Severity: blocker (P2 P3).** **CHANGES THE PRODUCT.**

- **SPR-1** (blocker): *"Each column header shows the sprint `name` as
  written in config — **never the ULID `id`**, never a derived slug."*
- **SPR-7** (blocker): *"`/sprints/$key` opens the sprint detail … the
  URL is pasteable and reopens the same sprint."*

`SprintDef` has no key or slug:

```
$ sed -n '23,31p' packages/contracts/src/sprints.ts
export const SprintDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  start_date: IsoDate,
  end_date: IsoDate,
  state: SprintStateSchema,
  goal: z.string().optional(),
  archived: z.boolean().optional(),
}).strict()
```

and `name` is explicitly **not unique** (SPR-24 depends on that), so it
cannot serve as the route key. The API is keyed by id:

```
$ grep -n "SPRINT_KEY_RE\s*=" apps/web/src/server/server.ts
813:const SPRINT_KEY_RE = /^\/api\/sprints\/([^/]+)$/;
$ grep -n "handleUpdateSprint" -A 2 apps/web/src/server/server.ts
1503:  const handleUpdateSprint: RouteHandler = async ({ … captures }) => {
1504:    const id = captures[0] ?? "";
```

So `$key` can only be the ULID today — which SPR-1 forbids surfacing,
and SPR-38 ("an unparseable `/sprints/$key`") assumes is human-typable.

**This is K3's problem, for sprints.** K3 ruled that projects get a slug
field reintroduced because `?project=web` needs one. The identical gap
exists for sprints and **no ruling covers it**. It needs the same
decision: slug generation, uniqueness, rename policy — on a shared
`.strict()` contract.

Note M4.7's ticket already says *"Route `/sprints/$key`"*
(`TEMP-WEB-TICKETS.md:755`), so the build will hit this.

### 1.3 MSL-7 vs MSL-6 — two label chips widen the result set

**Severity: blocker (P2 P10).** **CHANGES THE PRODUCT.**

- **MSL-7**: *"After clicking label A then label B, both chips are
  present and **the result set reflects both predicates**."* Third
  bullet: *"Removing one chip leaves the other applied."*
- **MSL-6** (blocker): *"The filter serializes to the same label
  predicate the CLI accepts, so the equivalent `loctt list` query
  returns **the same tasks**, compared by key."*

Two chips go into one `labels` array param, which serializes to `in`:

```
$ sed -n '753,758p' apps/web/src/server/server.ts
    if (values.length === 1) {
      clauses.push(`${field} = ${dslAtom(first)}`);
    } else {
      clauses.push(`${field} in (${values.map(dslAtom).join(", ")})`);
    }
```

and `in` over an array field is **any-of**
(`packages/core/src/query/evaluator.ts:462-464`).

Measured on a scratch tracker (T-1=alpha, T-2=alpha+beta, T-3=beta):

```
$ loctt list --query 'labels in ("<alpha-id>", "<beta-id>")'
T-3  Task C     T-2  Task B     T-1  Task A          ← 3 rows (OR)

$ loctt list --query 'labels = "<alpha-id>" and labels = "<beta-id>"'
T-2  Task B                                          ← 1 row (AND)
```

Clicking a second label chip **widens** the set from 1 to 3. MSL-7 says
it must "reflect both predicates".

MSL-7's *second* bullet ("AND vs OR are visible in the chip UI") does
leave the semantics open — so OR is arguably permitted. But bullets 1
and 3 are not satisfiable by the current shape either way: one array
param cannot render as two independently-removable chips.

**Why Ken's call:** MSL-6 forbids fixing this by diverging from the CLI
predicate. So it is either (a) MSL-7 means OR, and its bullets are
reworded, or (b) `buildStructuredQuery` gains a repeat-param/AND form
and both chips render separately. (b) changes the URL contract that P2
pins. This is a product decision, not a test fix.

### 1.4 MSL-12 vs MSL-32 — the label DELETE route archives; the CLI hard-deletes

**Severity: blocker (P5 P10).** **CHANGES THE PRODUCT.**

- **MSL-12**: *"On confirm, all 12 tasks are updated on disk and the
  entry is removed from `labels.yaml`. **The same delete via CLI
  produces the same end state.**"*
- **MSL-32**: *"…the attempt is rejected with a message naming the
  label and its reference count… Nothing is written to `labels.yaml`
  on the refused attempt."*

The web route never passes `hard: true`:

```
$ sed -n '1676,1682p' apps/web/src/server/server.ts
  const handleDeleteLabel: RouteHandler = async ({ res, url, … }) => {
    const id = captures[0] ?? "";
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteLabel(locttDir, id, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
```

and core reads a soft delete as *archive*, rejecting `remapTo` outright:

```
$ sed -n '215,221p' packages/core/src/labels/manage.ts
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new LabelError(`--remap-to only applies to --hard delete`);
    }
    await archiveLabel(locttDir, id);
    return { affectedTaskCount: 0 };
  }
```

The CLI always passes `hard: true` (`apps/cli/src/commands/label.ts:120-124`).

So today: `DELETE /api/labels/:id` **archives** (entry stays in
`labels.yaml`, zero tasks touched); `?remap_to=X` **400s**; the CLI
**hard-deletes**. MSL-12's "same end state" is false by construction,
and the archive/delete distinction is the one P10 names explicitly.

This is the **same shape as PRU-33's known `hard:true` gap (B17), but
for labels**, and it is not recorded in `known-gaps.md` or
`PROPOSED-UI-CASES.md`.

---

## 2. Cannot be satisfied as written

### 2.1 BRD-45 — a duplicate-status board config never loads, so there is no board to show the error on

**Severity: major (P4 P7).** **CHANGES THE PRODUCT** (small).

BRD-45: *"Hand-edit `workflow.yaml` so two columns claim the same
status… **The board** shows an explicit configuration-error state
naming the file, the offending column keys, and the duplicated status
key… It does not render a white pane."*

The premise cannot occur. `BoardsConfigSchema.superRefine` rejects it at
parse time, so `workflow.yaml` fails to load **entirely** — there is no
board, no columns, and no per-column error region:

```
$ node -e '<parse defaultWorkflowYaml + duplicate-status boards block>'
DUPLICATE-STATUS (BRD-45) => PARSE THREW: WorkflowConfigError |
  workflow.yaml is not valid: boards.columns[1].statuses[0] status
  'in_progress' already appears in column index 0
```

The failure surfaces as the app-wide `config_invalid` envelope
(`packages/core/src/config/workflow.ts:15-24`), which is a *good*
message — it names the file, the column index and the duplicated key.
But that is the schema banner, not "the board shows a configuration-error
state".

**Why Ken's call:** the case as written requires the board to render
with a per-column notice, which means the board must load a config the
parser refuses. Satisfying it literally means relaxing the schema to
warn-not-reject — a change to a shared contract. Ruling that the
app-level `config_invalid` state *is* the satisfying answer is the
cheaper option, but it is a narrowing of the case and so is Ken's, not
an agent's.

### 2.2 SPR-35 — identical shape: invalid `weights` is a parse failure, not a chart-region error

**Severity: major (P4 P7).** **CHANGES THE PRODUCT** (small).

SPR-35: *"`weights` referencing a value absent from `preset_values`…
The config error is surfaced **where the chart would be**… The chart
either falls back to a task count with that fallback stated, or refuses
to draw."*

```
$ node -e '<parse workflow with preset_values [XS,S,M,L] + weights {XS:1, XXL:8}>'
SPR-35 fixture THREW: WorkflowConfigError | workflow.yaml is not valid:
  estimation.weights.XXL weights key 'XXL' is not in preset_values
```

Validated at `packages/contracts/src/workflow.ts:352-369`. As with
BRD-45, the whole config is unloadable, so there is no sprint detail
page and no chart region. Both options the case offers ("falls back to
a task count" / "refuses to draw") presuppose a loaded config.

Same decision as 2.1, and they should be ruled on together.

### 2.3 BRD-31 — the same-position drop is not a no-op; it bumps `updated_at` and writes history

**Severity: major (P1).** **CHANGES A TEST *and* THE PRODUCT — see below.**

BRD-31: *"Pick up a card and release it back between the same two
neighbours. **No request is issued.** The card's `board_rank` on disk is
unchanged, and **no history entry is written**. **`updated_at` is not
bumped.**"*

Measured against a real tracker, repeating the identical drop:

```
after 1st place-before-T-3  | board_rank: "u" | updated_at: …51:16.374Z | history entries: 2
after REPEAT of same drop   | board_rank: "u" | updated_at: …51:17.503Z | history entries: 3
```

The written entry records a change that did not happen:

```
{"kind":"rank_changed","field":"board_rank","before":"u","after":"u", …}
```

`reorderBoardRank` (`packages/core/src/rank/reorder.ts:196-300`) has no
equality check anywhere: it always computes a rank, writes the file with
a fresh `updated_at`, and appends history.

**The asymmetry is the useful part.** The ordinary field path *does*
have the guard the rank path lacks:

```
$ sed -n '525,527p' packages/core/src/task/update.ts
  const before = readField(oldFm, field);
  if (before === value) return [];
```

Confirmed by measurement — writing the same `due_date` twice appends
**no** second history entry (one `field_change` in `_history.yaml`), but
*does* still bump `updated_at` (…59.316Z → …00.888Z).

**Split verdict, deliberately:**

- **CHANGES A TEST** for bullets 1 and 2 (no request; `board_rank`
  unchanged). "No request is issued" is a *client* obligation — M3.2
  can and should detect the identical drop and not call. `board_rank`
  unchanged already holds. Assert both in the M3.2 test.
- **CHANGES THE PRODUCT** for the history and `updated_at` bullets *if*
  the case is read as binding the server too. Adding an equality guard
  to `reorderBoardRank` makes rank consistent with fields, and is a
  contained core change — but it is a behaviour change to a shared
  write path that the CLI and MCP also use, so it is Ken's.

This also affects **TML-39** (*"Move a bar three days out and back before
releasing. No request is issued. `updated_at` is not bumped."*). For
dates the history half already holds; the `updated_at` half does not.

### 2.4 TML-34 — the settings path erases a dangling `dependency_relationship` silently

**Severity: major (P7).** **CHANGES THE PRODUCT.**

TML-34: *"Setting `dependency_relationship` to a key that does not
exist in `relationships` results in no arrows plus **a visible
configuration notice naming the missing key** — not a silent no-op and
not a crash."*

Two measured paths, and they disagree:

```
relationships: blocks, parent, clones, duplicates, causes, relates_to
timeline before: {"dependency_relationship":"blocks","default_zoom":"week",…}
timeline AFTER deleting 'blocks': {"default_zoom":"week","show_arrows":true,…}
dangling ref PARSE OK -> {"dependency_relationship":"no_such_rel",…}
```

- **Hand-edited file:** parses fine, keeps the dangling key — TML-34 is
  reachable and the notice is buildable. Good.
- **Deleting the relationship through Settings:** the field is **erased
  with no notice**, by design. The code says so:

```
$ sed -n '74,78p' packages/core/src/config/workflow-write.ts
 * Auto-clears `timeline.dependency_relationship` when the referenced
 * relationship key is no longer present … a dangling timeline ref
 * would just render zero arrows anyway, so we silently drop the field
 * rather than failing the write or leaving a misleading config on disk.
```

"Silently drop" is the exact thing P7 forbids, and the README's P7
amendment (§ 1.1) closed the last carve-out for silent pruning. The
user loses a configured setting with no record.

**Why Ken's call:** `autoClearTimelineDependency` is deliberate,
commented, and on the shared write path. Reversing it (keep the key,
surface drift) or keeping it (and reporting the clear) are both product
behaviour, and SET-17's remap-confirm flow is the natural place — which
makes it M4.2 scope, not a test edit.

### 2.5 ONB-16 — an empty `.loctt/` reports `exists: true`

**Severity: major (P6 P7).** **CHANGES THE PRODUCT** (small).

ONB-16: *"Create an empty `.loctt/` directory and load the UI. The app
routes to `/init`…"*

`getTrackerInfo` decides `exists` with a bare `access()` on the
directory (`packages/core/src/diagnostics/info.ts:62-67`), so:

```
--- empty .loctt/ dir (ONB-16) ---
{ "exists": true,  "taskCount": 0, "schemaStatus": {"kind":"missing"}, "workflowConfig": null }
--- no .loctt/ at all (ONB-1) ---
{ "exists": false, "taskCount": 0, "schemaStatus": {"kind":"missing"}, "workflowConfig": null }
```

ONB-1 routes on `exists: false`. An empty `.loctt/` gives `exists:
true`, so it will **not** route to `/init` on that signal — it falls
through to the normal app with no config, which ONB-16 explicitly
forbids ("does not render a generic crash, a schema banner, or a
zero-task list").

**The fix is cheap and the signal already exists:** both states report
`schemaStatus.kind: "missing"`, and `workflowConfig: null`
distinguishes an empty directory from a real tracker. But choosing
which signal `/init` routes on is a product decision that SET-30 also
constrains — SET-30 says for `missing` the banner *"does **not** offer
`loctt init` or reinitialize — a `.loctt/` holding tasks but no version
file is damaged, not empty"*. So ONB-16 (empty → offer init) and SET-30
(missing → never offer init) must be reconciled on the same signal.
That reconciliation is Ken's.

### 2.6 CMT-C8 — the assertion passes whether or not the bug exists

**Severity: minor (P10).** **CHANGES A TEST.**

CMT-C8: *"`get_task_history` does not mutate core's returned array…
**Two consecutive calls return the same ordering.**"*

The mutation is already fixed, and the fixing comment states the
assertion cannot observe it:

```
$ sed -n '458,463p' apps/mcp/src/tools/task-crud.ts
      // Copy before reversing (CMT-C8). `readHistory` re-reads and
      // re-parses the file on every call today, so mutating its result
      // in place currently harms nothing — but that is a property of
      // the callee, not a guarantee to this one.
      const newestFirst = [...entries].reverse();
```

`readHistory` re-reads from disk every call
(`packages/core/src/task/history.ts:195-211`, no memoisation), so "two
consecutive calls return the same ordering" holds identically with or
without the `[...entries]` copy. **This is exactly the CMT-30 pattern**
the brief names: correct, but undetectable.

The test should assert the returned array is not identity-equal to what
`readHistory` handed back, or the case should be closed as
resolved-and-unobservable.

### 2.7 SET-22 / SET-10's working-day assertions — the previous audit's claim is now stale

**Severity: n/a — correction.** **NO CHANGE NEEDED.**

`PROPOSED-UI-CASES.md` lists SET-22 and SET-10 as failing because
*"Working-day assertions have no consumer: nothing in the codebase reads
`working_days` or `holidays`."*

**That is no longer true.**

```
$ grep -rn "working_days\|holidays" apps/web/src/client --include='*.tsx'
apps/web/src/client/task/editors/DateField.tsx:224:  const holiday = calendar.holidays.find(h => h.date === day);
apps/web/src/client/task/editors/DateField.tsx:229:  if (calendar.working_days.includes(weekday)) return undefined;
```

`nonWorkingNote()` (`DateField.tsx:218-231`) consumes both. SET-10's
date-picker bullets are now buildable against a real consumer. SET-22's
"every day non-working" warning still has no consumer, but the premise
is no longer that nothing reads the field.

Flagging this because acting on the stale line would mean building a
consumer that exists.

### 2.8 ERR-30 / the error-envelope claim — also stale

**Severity: n/a — correction.** **NO CHANGE NEEDED.**

`PROPOSED-UI-CASES.md` says ERR-30 *"names 'Something went wrong' as a
failing result; the generic 500 returns literally `"Internal server
error"`… The whole file is structurally unsatisfiable until the error
envelope changes."*

The literal string now survives only in a comment. The catch-all today:

```
$ sed -n '3644,3649p' apps/web/src/server/server.ts
      error(res, `The server failed while handling ${method} ${path}.`, 500, {
        code: "unknown",
        ...(isRead ? {} : { data_state: "unknown" as const }),
        recovery: { kind: isRead ? "retry" : "reload" },
        detail: err instanceof Error ? err.message : String(err),
      });
```

That answers ERR-30's three obligations: what was attempted (`method
path`), what state the data is in (`data_state`), what to do next
(`recovery`). `LocttError.toEnvelope()` is preferred ahead of it
(`:3630-3633`), so attributable causes keep their own message per
ERR-31. `flow-error-handling.md` is **not** structurally unsatisfiable.

### 2.9 CMT-C4 — `offset` and `total` are absent on the MCP half

**Severity: major (P10).** **CHANGES THE PRODUCT.**

CMT-C4: *"An offset skips that many entries from the newest end **on
both surfaces**… **Both report the total** so the caller knows how much
remains."*

The MCP tool has no `offset` and returns no total:

```
$ sed -n '451,454p' apps/mcp/src/tools/task-crud.ts
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      limit: z.number().optional().describe("Max entries to return (default: all)"),
    },
```

Both surfaces call the two-arg `readHistory` overload returning
`HistoryEntry[]` — not the three-arg `ReadHistoryOptions` overload
returning `ReadHistoryPage` with `total`
(`packages/core/src/task/history.ts:186-194`).

Core already has the paginating overload, so this is close to the
"core has it; nothing wired it" category — but adding `offset` to a
published MCP tool schema changes an agent-facing contract, which is
why it is tagged product rather than wire-up.

---

## 3. Gaps — behaviour no case covers

### 3.1 `/api/labels/:id` archives; no case describes the web archive path

Following from § 1.4: the web DELETE performs an **archive**, and no
MSL case describes archiving a label from the UI at all. MSL-10 covers
an archived label's rendering, but nothing covers the UI action that
produces one. Both cases in the area (MSL-12 hard delete, MSL-32
refusal) describe behaviour the route does not perform.

**CHANGES THE PRODUCT** — same decision as § 1.4.

### 3.2 No case covers the `+N` label overflow being non-interactive, nor the 4-label boundary

MSL-20 requires *"The '+N' affordance reveals the remaining labels on
click/hover and each remains individually clickable to filter."* The
implementation is a static `title` tooltip on a `<span>` —
one string, no individual targets (`apps/web/src/client/list/cells.tsx:265-272`).

Separately, `MAX_LABEL_PILLS = 3` (`cells.tsx:193`), so overflow first
fires at **4** labels. Every MSL case is written for the 20-label case;
none covers the boundary where truncation actually begins.

**MSL-20's bullet: CHANGES THE PRODUCT** (a hover-card with clickable
pills does not exist). **The 4-label boundary: CHANGES A TEST** — add a
case at the real threshold.

### 3.3 MSL-11 and MSL-3 disagree on the denominator, and no case names the axis

MSL-11 requires the reference count be *"consistently with the progress
rule in MSL-3"*, but the two functions differ on **discarded** tasks:

- `countTasksByReferences` excludes archived only
  (`packages/core/src/task/counts.ts:60-64`)
- `computeProgress` excludes archived **and** discarded
  (`packages/core/src/task/progress.ts:59`: `const total = tasks.length - discarded;`)

So the same label can read `10` in Settings and `4 / 8` as progress.
The existing test only checks archived parity
(`progress-batch.test.ts:91`).

**CHANGES A TEST or THE PRODUCT** depending on which denominator
Settings should show — **MSL-11 does not say**, which is itself the gap.

### 3.4 SPR-26 and SPR-36's server halves are already met — a correction, not a gap

Two measurements that close previously-open items:

**SPR-36** (drop onto a deleted sprint) — core already refuses with a
named error:

```
$ node -e '<setField sprint = nonexistent ULID>'
REJECTED: SprintError | unknown sprint: 01NONEXISTENTSPRINTID000000
```

**SPR-26 / PRU-12** (archived-reference guard) — wired on the web write
paths: `archivedGuard` is loaded and passed at
`apps/web/src/server/server.ts:2588/2598`, `2742/2755`, `2949/2957`.

**SPR-26's remaining half is a wire-up, not a feature.**
`PROPOSED-UI-CASES.md` calls it *"Unreachable from the UI… there is no
archive/unarchive route (B17)"*. Core has both and the CLI uses them:

```
$ grep -rn "archiveSprint\|unarchiveSprint" packages/core/src apps/cli/src
packages/core/src/sprints/manage.ts:217:export async function archiveSprint(…)
packages/core/src/sprints/manage.ts:231:export async function unarchiveSprint(…)
packages/core/src/index.ts:261:  archiveSprint,
apps/cli/src/commands/sprint.ts:169:        if (sub === "archive") await archiveSprint(locttDir, id);
```

Per `TEMP-RUN-WORKFLOW.md`'s table this is *"Core has it; nothing wired
it → Build it"* — **not scope, no stop needed.** Worth noting because
M3.5's ticket asserts *"**No server work.** … Client-side only"*
(`TEMP-WEB-TICKETS.md:521`), which is wrong for SPR-26: it needs a
route.

### 3.5 Unfalsifiable performance bullets in the M3/M4 flows

The TSK-27 pattern (a perf question with no threshold) recurs:

- **BRD-21**: *"Scrolling is smooth"*
- **SET-23**: *"stays responsive, and the date picker's month render is
  not visibly slowed"*
- **TML-21**: *"interaction is possible within a couple of seconds"* —
  the only one with a number, and it is approximate

These are less severe than TSK-27 because each sits beside a
falsifiable companion bullet (virtualization behaviour, honest counts,
correct dates at range ends). **CHANGES A TEST** — the companion bullets
are what a test should assert; the smoothness clauses should be
understood as non-assertions rather than given a fabricated threshold.

### 3.6 The surface README's case counts are wrong

```
$ for f in docs/dev/surface-test-cases/flow-*.md; do echo "$(grep -c '^### [A-Z0-9]*-C[0-9]*' $f) $f"; done
12 …/flow-projects-users.md      ← README table says 9
…
$ node -e 'console.log(require("./docs/dev/case-index.json").counts)'
{ total: 937, ui: 869, surface: 68, resolved: 3 }
```

The README table says **65 cases** and lists projects-users at **9**;
there are **12**, and the index counts **68**. Minor, but the README is
the entry point and `npm run cases:partition` is claimed to enforce
completeness.

**CHANGES A TEST** (documentation only).

---

## 4. Milestone-tag problems

### 4.1 VUE-13 is tagged M1 but needs multi-field sort, which only M4 builds

**CHANGES A TEST.**

VUE-13 (M1): *"Saving a view with sort `priority desc` **then**
`updated_at desc` writes both entries in that order to `queries.yaml`…
Ties within a priority are broken by `updated_at` descending."*

Assigned to M1.3, which builds single-column sort:

```
$ sed -n '153p' TEMP-WEB-TICKETS.md
- Sort by column header (single sort, dir indicator)
```

The M1 URL schema holds one field and one direction
(`apps/web/src/client/router/listSearch.ts:102-103`), so
`SaveViewDialog` can only ever write a one-element array
(`SaveViewDialog.tsx:26-29`). The multi-sort editor is **VUE-17, tagged
M4** (M4.5).

Core already supports it (`SavedQuery.sort` is an array, persisted
verbatim by `packages/core/src/views/manage.ts:82`), so this is purely a
tag/scope error. Retag VUE-13 to M4, or split its single-sort bullets
into M1 and move the two-entry bullets to M4.

### 4.2 SPR-26 is tagged M4 but M3.5's ticket claims no server work

**CHANGES A TEST** (ticket text).

Covered in § 3.4. SPR-26 is correctly tagged M4 (it belongs to sprint
detail), but M3.5's *"No server work… Client-side only"* line is what
will mislead a build agent, since the sprint archive route it needs
does not exist and M3.5's SPR-1 depends on `archived` filtering.

### 4.3 ONB-11 is tagged M3 in a doc whose header says M1, M4

`flow-onboarding.md`'s README row reads *"Milestones: M1, M4"*
(`ui-test-cases/README.md`), but ONB-11 is tagged **M3** (it is a board
case living in the onboarding flow). Harmless in itself — the case is
correctly placed in M3.1's list — but the index row is wrong, and the
flow-doc header is what a scoping reader consults.

**CHANGES A TEST** (documentation only).

---

## 5. What I did not audit, and why

A truthful partial audit, as asked. Of 937 cases I examined roughly
340 closely.

**Audited closely (case-by-case, with measurement):**

- `flow-board.md` (49), `flow-timeline.md` (50), `flow-sprints.md`
  (38), `flow-settings.md` (42), `flow-onboarding.md` (35) — the M3/M4
  flows the brief prioritised
- `flow-milestones-labels.md` and `flow-saved-views.md` (delegated,
  then the two load-bearing findings re-verified independently by me —
  § 1.3 and § 1.4)
- all 68 surface cases (delegated, then CMT-C4 and CMT-C8 re-verified
  independently)
- P7 amendment cross-check across all 18 UI flow docs (`grep` for
  "silently"), which is what surfaced § 1.1

**Not audited, and the risk that carries:**

- **`flow-accessibility.md` (54 cases, all M4).** Skipped entirely.
  These need a running app and assistive-tech verification; static
  reading would produce low-confidence claims. **This is the largest
  unexamined block and the one I would audit next.**
- **`flow-bulk.md` (48), `flow-list.md` (52).** M1, already through
  their gate, and heavily covered by `PROPOSED-UI-CASES.md`. Sampled
  for P5 cases only.
- **`flow-tasks.md` (56), `flow-relationships.md` (50),
  `flow-comments-activity.md` (38), `flow-task-create.md` (41).** M2/M3.
  The brief named TSK-27, CMT-30 and REL-31 as already-known examples
  from these files, so re-auditing them was explicitly low-value. I did
  not look for *new* instances in them.
- **`flow-git-sync.md` (38), `flow-cross-surface.md` (66),
  `flow-app-shell.md` (44), `flow-error-handling.md` (45).** Sampled
  only where a finding elsewhere pointed into them (ERR-30 in § 2.8,
  SHL-32 in § 1.1). `flow-git-sync.md` in particular is untouched and
  `PROPOSED-UI-CASES.md` flags real open items there.
- **Runtime verification.** Every measurement above is against core,
  contracts, the CLI, or the server module read directly. I did **not**
  start the web server or drive a browser, so no client-side claim
  (rendering, drag behaviour, optimistic state) was verified by
  execution. Where a finding depends on client behaviour I said so —
  § 2.3's "no request is issued" is the clearest instance.

**One methodological caution.** Two of my own working hypotheses
dissolved on measurement and are recorded as corrections rather than
quietly dropped: § 2.7 (working-day consumers now exist) and § 2.8 (the
error envelope was fixed). A third — that `labels = X` filtering was
broken — turned out to be my own mis-invocation of the CLI (`-q` is
silently ignored; the flag is `--query`), and the finding only survived
because I re-ran it correctly. Claims in `PROPOSED-UI-CASES.md` should
be re-measured before being acted on; several have aged.

---

## 6. The items that need Ken before anything is built

Collected so they are not lost in the detail. Each is either behaviour
that does not exist, or two cases requiring different products.

| # | Item | Why it is Ken's |
|---|---|---|
| § 1.2 | **Sprints need a slug**, exactly as K3 ruled for projects | Shared `.strict()` contract; needs generation, uniqueness, rename policy. No ruling covers sprints. |
| § 1.3 | **MSL-7: two label chips are OR, not AND** | Either MSL-7 is reworded to OR, or the URL/query contract gains a repeat-param AND form. P2 pins that contract. |
| § 1.4, § 3.1 | **`DELETE /api/labels/:id` archives; the CLI hard-deletes** | MSL-12 and MSL-32 cannot both hold. P10's archive/delete distinction. Same shape as PRU-33/B17 but unrecorded. |
| § 2.1, § 2.2 | **BRD-45 and SPR-35 describe error states for configs that never load** | Satisfying them literally means relaxing schema validation to warn-not-reject; the alternative narrows two cases. Rule together. |
| § 2.3 | **`reorderBoardRank` has no same-position guard** (history + `updated_at`) | Contained core change, but on a write path the CLI and MCP share. The field path already has the guard. |
| § 2.4 | **`autoClearTimelineDependency` silently erases a user setting** | Deliberate and commented, but P7's amendment closed the last silent-pruning carve-out. TML-34 requires a notice. |
| § 2.5 | **An empty `.loctt/` reports `exists: true`** | ONB-16 (empty → offer init) and SET-30 (missing → never offer init) must be reconciled on one signal. |
| § 2.9 | **MCP `get_task_history` lacks `offset`/`total`** | Core has the paginating overload; adding the param changes a published agent-facing tool schema. |
| § 3.2 | **MSL-20's `+N` reveal does not exist** (static tooltip) | A clickable hover-card is a new component, not a test fix. |
| § 3.3 | **MSL-11 vs MSL-3 denominators disagree on discarded** | MSL-11 says "consistently" without naming the axis. Needs a ruling on which number Settings shows. |

Everything else in this report is a **test** change: the case is right
and the test is wrong, missing, or asserting nothing.

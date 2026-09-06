# Phase Z Batch 2 — adversarial verification of three findings

Independent re-check of one security finding (two sub-findings), one
data-flow finding and one a11y finding. Nothing in the reports was
taken on trust: each was reproduced against the built code or refuted
by reading the source the report cites. No repo file was edited; the
only scratch artefact (a repro script and four throwaway trackers) lived
in the session scratchpad and has been removed.

| # | Finding | Verdict | Severity (reviewer → verified) |
|---|---|---|---|
| 1 | SEC-1 / SEC-2 backup-restore zip-slip | **CONFIRMED** (all three write sites) | HIGH → **HIGH** (stands) |
| 2 | Milestones web client drops K28 `unreadable` | **CONFIRMED**, one supporting claim corrected | major → **major** (stands) |
| 3 | ReconcilePanel pick-value control unlabelled | **CONFIRMED** | major → **major** (stands) |

---

## 1. SEC-1 / SEC-2 — backup restore writes outside the tracker

**Verdict: CONFIRMED.** All three write sites escape: attachment name
(SEC-1a), user avatar name (SEC-1b), config `path` (SEC-2). Each was
exercised in isolation with a fresh tracker; an untampered control
backup stayed contained.

### Repro

Script (run with `node` against `packages/core/dist`, which is newer
than `src` by mtime, so it is the current code). Per case:

1. `initLoctt` a source tracker, `createTask` one task, `exportBackup`
   it — so the tampered file is a **genuine** backup (real header, real
   `task` record with a real `raw` task.md), not a hand-guessed format.
2. Parse the JSONL, inject one record, re-serialise.
3. `initLoctt` an empty destination at `<sandbox>/tracker/`, run
   `restoreBackup(dstLocttDir, [evil], { mode: "bare" })`.
4. List `<sandbox>/` — anything there other than `src/`, `tracker/` and
   the two jsonl files has escaped the tracker root.

Injections and results:

| Case | Injected record | Escape path | Result |
|---|---|---|---|
| SEC-1a | task `attachments: [{ name: "../../../../../ESCAPE_ATT.txt", bytes }]` | `.loctt/tasks/<id>/attachments/` + 5× `..` → `<sandbox>/` | restore **succeeded**; `<sandbox>/ESCAPE_ATT.txt` = `owned-att` |
| SEC-1b | `{ kind:"user", id:"evil-user", profile, avatar:{ name:"../../../../ESCAPE_AVATAR.txt", bytes } }` | `.loctt/users/evil-user/` + 4× `..` → `<sandbox>/` | restore **succeeded**; `<sandbox>/ESCAPE_AVATAR.txt` = `owned-avatar` |
| SEC-2 | `{ kind:"config", path:"../../ESCAPE_CONFIG.txt", content:"owned-config" }` | `.loctt/` + 2× `..` → `<sandbox>/` | restore **succeeded**; `<sandbox>/ESCAPE_CONFIG.txt` = `owned-config` |
| control | none | — | restore succeeded; nothing escaped |

Every restore reported success — the user gets no signal.

### Source inspection

- `packages/core/src/backup/restore.ts:669` —
  `join(getAttachmentsDir(locttDir, id), att.name)`. `getAttachmentsDir`
  asserts only the **task id**; `att.name` is joined bare.
- `restore.ts:676` — `join(getUserDir(locttDir, id), record.avatar.name)`;
  same shape, user id asserted, avatar name not.
- `restore.ts:552-561` — every config record not already remapped is
  pushed as `{ path: join(locttDir, path) }` into `stagedSwap`. In
  `merge` mode there is an existence check (`:556`) that *skips* an
  existing destination, so merge can only create, not overwrite; `bare`
  and `overwrite` go straight through.
- `packages/core/src/backup/format.ts:74-78, 131-136` —
  `BackupAttachmentSchema.name` and `BackupConfigSchema.path` are both
  `z.string().min(1)`. No segment check.
- `packages/core/src/state/staged-swap.ts` — refuses to replace a
  non-regular file (`:126-134`) and journals for rollback, but never
  confines `dest` to its base dir. It **does** back up and replace an
  existing regular file, so SEC-2 in `bare`/`overwrite` mode overwrites,
  not just creates. Attachments/avatars go through `writeFile`, which
  overwrites in every mode.

**Reviewer's "other path-builders are safe" claim — confirmed.**
`assertSafeBasename` (`packages/core/src/paths/index.ts:36`) rejects
separators, `.`/`..`, null bytes and embedded traversal, and is applied
by every `get*Path`/`get*Dir` helper to the id, and by
`getAttachmentPath(:103-104)` to the **name**. The live attachment write
path (`task/attachments.ts:140`), the web upload/avatar routes
(`server.ts:2567, 4500`) and the CLI attach command
(`cli/commands/task-files.ts:78`) all call it. Restore is the only
writer of attachment/avatar bytes that uses `getAttachmentsDir` +
bare `join` instead of `getAttachmentPath`. So this is genuinely a
restore-only bypass, not a systemic gap.

Note: only `..` escapes. An absolute `path`/`name` does not —
`path.join(locttDir, "/etc/x")` normalises to `locttDir/etc/x`.

### Severity: HIGH is right

- **Not CRITICAL.** There is no network or unauthenticated path.
  `restoreBackup` is reachable from exactly two surfaces
  (`apps/cli/src/commands/backup.ts:87`, `apps/mcp/src/tools/backup.ts:58`);
  the web server exposes no restore route. The user, or an MCP agent
  acting for them, must explicitly restore an attacker-supplied file.
- **Not MEDIUM.** Payoff is arbitrary-content write **and overwrite** of
  any regular file the user can write, with success reported. That is
  one hop from code execution (`.git/hooks/*`, shell rc, `authorized_keys`).
  And restore is precisely the operation in which a user imports a file
  from elsewhere, so a booby-trapped backup is a realistic vector.
- **MCP sharpens it slightly.** The `restore` tool takes arbitrary
  `files` paths resolved against root. An LLM agent driving the MCP
  server can be steered by injected text (e.g. in a task body it reads)
  into restoring a file it was also induced to write. That is a chain,
  not a direct exploit, but it removes the "user must consciously
  import" step the reviewer leaned on for HIGH-not-CRITICAL. HIGH still
  fits; a case could be made for the top of HIGH.

### Minimal fix shape

Two things, in this order, and the first one must be in `restore.ts`
not just the schema:

1. **Refuse before any write, in `restore.ts`.** After `loadBackup`,
   before `stagedSwap`: for every task attachment name and user avatar
   name, `assertSafeBasename(name)`; for every config `path`, check
   `resolve(locttDir, path)` starts with `resolve(locttDir) + sep`
   (and reject absolute paths for clarity). Throw `RestoreRefusedError`
   naming the offending record. It must run **before** `stagedSwap`
   (`:664`) because attachments are written **after** the swap
   (`:667-679`) — a throw mid-loop would leave a half-restored tracker,
   which is exactly what the "one stagedSwap" design promises not to do.
2. **Why the schema alone is the wrong fix.** `read.ts:33-35` records a
   record that fails `BackupRecordSchema` as a lenient `badLine` and
   continues (P-11). A `superRefine` on `name`/`path` would therefore
   silently *drop* the malicious record and report a successful restore
   with one bad line — safer, but it hides the attack. Tighten the
   schema too if wanted, but the refusal is what tells the user their
   backup is hostile.
3. **Defence in depth in `stagedSwap`:** confine every `w.path` to
   `locttDir` (it already receives `locttDir` as its base) and throw
   before step 1. Cheap, and covers any future caller.

Tests: each of the three records above against a fresh tracker,
asserting `RestoreRefusedError` **and** that nothing exists outside the
tracker root **and** that the tracker is unchanged (no partial write).

---

## 2. Milestones web client drops K28 `unreadable`

**Verdict: CONFIRMED.** The server puts `unreadable` on the wire; the
milestones client never reads it; nothing on the milestones page tells
the user a member was dropped from the totals. Severity **major**
stands. One supporting claim in the report is wrong and is corrected
below; it does not change the verdict.

### Inspection

- **Server, milestones:** `apps/web/src/server/server.ts:2037-2050`
  `handleListMilestones` calls `withProgress(... "milestone" ...)` and
  spreads `...(unreadable.length > 0 ? { unreadable } : {})` into the
  JSON at `:2048`. `withProgress` (`:1914-1941`) returns
  `report.unreadable` from `milestoneProgressDetailed`. Confirmed on the
  wire (top-level, sibling of `items`/`broken`, present only when
  non-empty).
- **Server, sprints:** identical at `:1948-1955`.
- **Client hook:** `apps/web/src/client/api/hooks/useMilestoneProgress.ts:39-48`
  types the response as `Page<MilestoneWithProgress>` whose local
  `Page<T>` (`:7-12`) has `items/total/offset/limit` only. The data is
  still in `milestones.data` at runtime — the type just hides it.
- **Client view:** `apps/web/src/client/milestones/MilestonesView.tsx:43-46`
  reads `milestones.data?.items ?? []` and nothing else off the
  response. `grep unreadable|could not be read` over
  `apps/web/src/client/milestones/` returns zero hits (re-run; confirmed).
  No other client code calls `/api/milestones?progress=true`
  (`useMilestoneProgress.ts:44` is the only caller), so no other
  component could be rendering it.
- **No web test covers it.** No `*.test.tsx` under `apps/web/src`
  references `MilestonesView`, and the only web test mentioning both
  `unreadable` and `milestone` is `ActivityPanel.test.tsx` (unrelated).

### Correction to the report

The report says the sprints client "reading the identical wire shape
does render it", citing `SprintsView.tsx:83/383`. That banner is real,
but its `unreadable` comes from **`useTasksFeed`** (`SprintsView.tsx:70`),
i.e. the `GET /api/tasks` page's `unreadable` (typed at
`useTasks.ts:53-57`, produced at `server.ts:3445/3527`) — **not** from
`/api/sprints?progress=true`. In fact no client hook requests
`/api/sprints?progress=true` at all (the only sprints reads are
`sidebarData.ts:160` without progress and `useDataMutations.ts:60` with
`counts=true`). So the "sibling surface consumes the same field"
argument is wrong as written. What remains true: the sprints view
*does* surface unreadable task files to the user by another route, and
the milestones view surfaces them by no route — the asymmetry the
report points at exists, just via a different mechanism. The CLI
(`cli/commands/milestone.ts:59-63`, stderr warning) and MCP
(`mcp/tools/milestone.ts:52-55`, returns `unreadable`) claims were spot-
checked by path and hold.

### Is it purely a client fix?

**Yes.** The bytes are already on the wire; core and server need no
change. Shape:

1. `useMilestoneProgress.ts` — extend the response type to include
   `readonly unreadable?: readonly { id; path; reason }[]` (the same
   shape `useTasks.ts:53` already declares; worth lifting to one shared
   type rather than a third copy).
2. `MilestonesView.tsx` — read `milestones.data?.unreadable ?? []` and
   render the same `role="alert"` banner `SprintsView.tsx:383-392`
   renders, with `data-testid="milestones-unreadable"`, wording that
   says the **totals** are short by that many (this is the progress
   surface, so the number is what is wrong here).
3. Test: a `MilestonesView` render with a mocked response carrying one
   `unreadable` entry asserts the banner; break the fix and watch it
   fail (there is currently no `MilestonesView` test file to extend).

---

## 3. ReconcilePanel pick-value control has no accessible label

**Verdict: CONFIRMED.** Severity **major** stands (A11Y-22 is a
blocker-tier case and names "every settings form").

### Inspection

`apps/web/src/client/settings/ReconcilePanel.tsx`:

- `:376` — `<div className="mb-1 font-medium ...">{conflict.fieldLabel}</div>`.
  A `<div>`, no `id`, so nothing can point at it.
- `:410-421` — enum branch `<select data-testid="git-reconcile-pick-value" value onChange className>`.
  Not inside a `<label>`; no `aria-label`, `aria-labelledby`, `id`, or
  `title`. Its first `<option>` is `Pick a value…` — a placeholder,
  which the A11Y-22 text explicitly disallows as the only label.
- `:426-435` — scalar branch `<input type="text" data-testid=... placeholder="Type a third value…" value onChange className>`.
  Same: no wrapping label, no aria-*, placeholder only.
- `grep -n "aria-\|<label\|htmlFor"` over the **whole file** returns
  nothing. So there is no association anywhere, not merely none nearby.

A screen reader therefore announces "combobox, Pick a value…" /
"edit text, Type a third value…" with no field name; on a multi-field
row set, the two branches are indistinguishable from each other except
by the surrounding visual `<div>`.

The `SideButton`s (`:448-`) have visible text content and are fine, as
the report says.

### "Lone gap" claim — confirmed for `<select>` controls

Every other `<select>` in `apps/web/src/client` (non-test) is labelled:
wrapped in a `<label>` element (`EstimationPanel:78`,
`RelationshipsSettingsPanel:222`, `CalendarPanel:125`,
`DeleteProjectDialog:79`, `SprintMetaHeader:196`, `TimelineView:700`) or
carrying `aria-label` (`PreferencesPanel:164`, `CalendarPanel:156`
"First day of week", `EnumCollectionPanel:297` "Category for <key>",
`CustomFieldsPanel:206`, `MoveTaskDialog:70`) or an `id` with a paired
label (`LinkPicker:117`). The task inline editors the report names do
label meticulously: `task/editors/OptionPicker.tsx:141,181`,
`DateField.tsx:93,126-127`, `TextField.tsx:100,135-137` all set
`aria-label` (and `aria-describedby` where there is an error/note). I
did not sweep every `<input>` in the app; the claim as scoped to
inline editors and selects holds.

### Minimal correct fix

Either works; the first is preferable because it reuses the visible
label rather than duplicating its text:

- **Associate the existing field name.** Give the `:376` div an id
  (`const labelId = useId()`), `<div id={labelId} ...>{conflict.fieldLabel}</div>`,
  and put `aria-labelledby={labelId}` on both the `<select>` and the
  `<input>`. Since both controls sit in the same row and only one
  renders, one id suffices. The accessible name becomes the field
  label ("Due date", "Status"). Optionally add
  `aria-describedby` pointing at a visually-hidden "Pick a third value"
  hint so the *purpose* is also announced.
- **Or** `aria-label={`Pick a value for ${conflict.fieldLabel}`}` on
  each control — one attribute per branch, as the report proposes.

Neither breaks the e2e coverage: `tests/ui/flow-git-reconcile.spec.ts`
(`:151, :198, :289, :320`) locates the control by
`getByTestId("git-reconcile-pick-value")` only. There is no
`ReconcilePanel.test.tsx` unit file. Add an assertion in the flow spec
(or a new unit test) that `getByLabelText(conflict.fieldLabel)` (or
`getByRole("combobox", { name: /Status/ })`) resolves to the control,
and confirm it fails on the current code.

---

## Housekeeping

- Repro ran against `packages/core/dist` (mtime newer than `src`); no
  source, test or dist file was modified.
- Scratchpad: repro script and its four sandbox trackers deleted.
- `git status` after this write: `TEMP-BUILD-PLAN.md` modified and the
  `docs/dev/phase-z-*` docs untracked (pre-existing, other agents'), plus
  this file.

# Review: PROPOSED-degradation-cases.md — comprehensiveness

Adversarial review of the 23 DEG cases against the inventory
(`degradation-test-inventory.md`, B1–B25 + §3 + §4 + §5), the decided
behavior (K21–K27, A135–A139, `corruption-coverage-map.md`, framework
proposal §6/§9/§13.3), the two existing case trees, and — where the
proposal makes a claim about what exists — the code. Review only; no
code or proposal edits.

## Verdict: comprehensive-with-additions

Every one of the inventory's 25 behaviors maps to a DEG case (map below,
0 misses). But the proposal was authored *from the inventory*, and the
inventory is an inventory of what is **tested** — so the inventory's own
blind spots propagated. Five of the twenty decided-but-untested / parity
gaps have no case and no NEW-test note; two `[T]`/`[NEW]` tags are
factually wrong in opposite directions (one behavior marked NEW is already
tested; one marked "untested" is unbuilt); the config-level analogue of
the proposal's own most important task rule (preserve-others on write) is
absent even though the repo already carries a live P1 violation of it;
and the home answer is half-right — the CLI/MCP bullets cannot live in
`ui-test-cases/` under that tree's own scope rule.

Ready to author **after** the additions in § 7. Not before: two of them
(config preserve-others, aggregate surfaces) are data-loss rules with no
spec anywhere today.

---

## 1. B# → DEG# coverage map

| B# | Behavior (short) | DEG | Note |
|---|---|---|---|
| B1 | object-fatal task attributed, blocks nothing | DEG-1 | mixed field-local + object-fatal fails closed (#6) not pinned — add bullet |
| B2 | wrong-typed field degrades | DEG-2 | ✓ |
| B3 | preserve-others on write | DEG-3 | task-level only; see § 7.1 |
| B4 | set-over repairs | DEG-4 | ✓ |
| B5 | unset removes | DEG-4 | ✓ |
| B6 | write guard | DEG-5 | bullet 2 misstates A136.1 — see § 4 |
| B7 | read-to-compute refuses | DEG-6 | `setField(<custom>)` over wrong-typed `fields` map (§13.3) not pinned |
| B8 | idempotency read never refuses | DEG-6 | ✓ |
| B9 | unrecognised key preserved | DEG-7 | ✓ (severity wrong, § 6) |
| B10 | untitled → key | DEG-8 | ✓ |
| B11 | config per-entry broken | DEG-9 | ✓ |
| B12 | config object-fatal attributed | DEG-10 | ✓ |
| B13 | empty ≠ broken ≠ failed | DEG-11 | timeline half (undated ≠ corrupt, #263) is in DEG-17 — fine |
| B14 | dangling scalar ref marked | DEG-14 | "filtering offers only live entities" tagged [T]; no inventory row tests it |
| B15 | edge: 4 target states | DEG-15 | ✓ |
| B16 | invalid enum keeps raw key | DEG-16 | ✓ (hub of CMT-26/GIT-14/#276) |
| B17 | corrupt-dated ≠ undated | DEG-17 | should state `invalid` (TML-48, string) and `corrupt` (lifted) are two classifications, both ≠ undated |
| B18 | malformed history row | DEG-18 | `[NEW web test]` is wrong — already tested, § 2 |
| B19 | backup/restore | DEG-19 | ✓ (severity, § 6) |
| B20 | attachments orthogonal | DEG-20 | ✓ (severity, § 6) |
| B21 | reconcile marks corrupt side | DEG-21 | ✓ |
| B22 | state.yaml object-fatal | DEG-12 | ✓ |
| B23 | profile/settings | DEG-13 | two mechanisms in one case — split, § 4 |
| B24 | saved view w/ dropped field | DEG-22 | ✓ |
| B25 | health on wire | DEG-23 | web wire only; MCP shape (gap §3 #2) belongs here too |

**B# with no case: 0.** The proposal's "covers all 25" claim holds.

---

## 2. Gap coverage — §3 decided-but-untested (10) and §4 parity (9 real rows)

### §3 decided-but-untested

| # | Gap | In proposal? | Finding |
|---|---|---|---|
| 1 | repair provenance (`before`=raw, `meta.was_corrupt`) | DEG-4 bullet 3, tagged `[NEW — decided-but-untested]` | **Wrong tag: it is unbuilt.** `grep was_corrupt` over `packages/` + `apps/` returns nothing; `update.ts:524` calls `buildSetFieldHistory(task.frontmatter, field, value, now)` — frontmatter only, so `before` is `null` for a lifted field, which is exactly the "silent case" §9 says is fixed. The bullet is right; the tag must become "cannot be satisfied yet" (TEMP-RUN-WORKFLOW § Cases that cannot be satisfied yet) and known-gaps needs an entry. Authoring it as a plain `[NEW]` test produces a red test against a decided behavior nobody has scheduled. |
| 2 | MCP `get_task`/`list_tasks` carry `health` | NEW-note under DEG-1/DEG-8 (lumped) | Covered weakly. The *shape* contract (present-when-corrupt, omitted-when-clean, `raw` never sent) is DEG-23, which is web-wire only. Add MCP to DEG-23; the DEG-1/8 note covers rendering, not shape. |
| 3 | CLI `show` "Needs attention" + `list` ⚠ cells | NEW-note under DEG-1/DEG-8 | Covered weakly. A136.4's two specific rules — CLI `show` filters dangling relationship-target findings out of the health block, and truncates any ULID in `rawText` — are pinned nowhere. Add to the CLI case (see § 5). |
| 4 | `classifyTaskHealth` element-indexed finding | NEW-note ("supports DEG-14/15/16") | Named, but owned by no case. Make it a bullet on DEG-14: "a dangling element inside an array field is reported at the element (`labels[2]`), leaving the healthy elements in place" — that is the A137.1 co-existence rule and it is the *reason* DEG-14's row still renders. |
| 5 | unset of a dangling relationship edge routes through `unlinkTask`, inverse stays consistent (§7.3, A135.4) | **absent** | Missing. Belongs on DEG-15 as a repair bullet: "Removing a dangling/corrupt edge from the row removes the inverse too; over an object-fatal `relationships` array the removal refuses (A135.4)." |
| 6 | publish with field-local corruption allowed; object-fatal blocks (A135.2, #187–193) | **absent** | Missing. DEG-18 covers the doctor split for *history files* only. The task.md split (#191 field-local → `malformed`, non-blocking; #192 object-fatal → `unreadable`, blocks publish) and the publish pre-flight itself have no case. Needs its own case — see § 7.3. |
| 7 | identity/directory mismatch | absent | **Correctly out** — not a decided behavior (framework §2.3 lists it as a probe). Should be *named* as excluded in the flow doc's header so the next author does not re-derive it. |
| 8 | `duplicateTask` copies healthy only, refuses on corrupt `project`, lists dropped fields (§13.3; known-gaps DUP-H1) | **absent** | Missing. `duplicate.test.ts` has no corrupt/health test. Two bullets are satisfiable today (healthy-only copy; refuse on corrupt project); the third (dropped-fields notice) is DUP-H1, cannot-be-satisfied-yet. |
| 9 | `mergeTask` health union on 3-way merge (§13.2 B2) | **absent** | Missing. DEG-21 pins *marking* the corrupt side in the reconcile plan; nothing pins what the *merged file* contains when a side carries health (union of raws; winning side's healthy value overrides). This is a write path — a wrong answer here is data loss. |
| 10 | settings panels render `broken` | DEG-11 bullet 3 | ✓ |

### §4 cross-surface parity

| Row | In proposal? | Finding |
|---|---|---|
| field-health in CLI/MCP output | DEG-1/8 note | ✓ (weak, see #2/#3 above) |
| untitled → key CLI/MCP | DEG-8 | ✓ |
| unreadable task in CLI/MCP list | DEG-1 bullet 3 | Named but vague ("attribute the failure the same way"). Framework §6 pins it: CLI `list` trailer "N files could not be read: <path>: <reason>"; MCP `list_tasks` → `unreadable[]`; `get_task` → error envelope. Pin those. |
| config `broken` on CLI & MCP | **absent** | **Missing.** DEG-11's NEW-note covers web settings panels only. Verified: in `apps/cli/src` and `apps/mcp/src` only `views.ts` renders a `broken` list; `sprint list`/`label list`/`milestone list`/`project list` and their MCP twins render valid entries only, so a broken entry is invisible — "one broken sprint reads as no sprint" on two of three surfaces. This is B13 failing on CLI/MCP. |
| repair via wire/CLI/MCP | DEG-3/4 note | ✓ |
| derived-op refusal envelope | DEG-6 note | ✓ |
| malformed-history notice web & MCP | DEG-18 | **Half wrong.** Web: `apps/web/src/client/activity/ActivityPanel.test.tsx` "ActivityPanel — incomplete history (CMT-37 second bullet)" asserts `activity-incomplete` with count — it IS tested; tag `[T]`, `@verifies` already exists via CMT-37. The inventory's "not found in scanned set" was a scan miss, and the proposal repeated it without looking (the CLAUDE.md "check before claiming something does not exist" rule). MCP half: not mentioned anywhere — `get_history`/comments tool output should carry the incomplete count. |
| bulk over object-fatal member | NEW-note "likely its own case DEG-24" | Named; promote to a case (see § 4). |
| reconcile UI | DEG-21 | ✓ |

**Gaps with no case and no NEW-note: 5** (§3 #5, #6, #8, #9; §4 config-broken-on-CLI/MCP). Plus one correctly-excluded gap that should be named as excluded (#7), and two mis-tagged (#1 unbuilt-not-untested; DEG-18 tested-not-NEW).

---

## 3. KIND × OBJECT empty cells — judgment

| Empty cell | Judgment | Why |
|---|---|---|
| **dangling** on labels/milestones/sprints/workflow/queries (config-side reference check) | **Out of scope as cases; one bullet.** | A task pointing at a deleted label is detected task-side (`classifyTaskHealth`, DEG-14); a saved query naming a deleted entity is DEG-22. There is no config-side referent to check except `projects.default` (K23, tested #70). The only real spec point is gap §3 #4 — element-indexed detection — which goes on DEG-14. |
| **missing_required** on user settings | **Correctly n/a.** | Settings has no required key. |
| **missing_required** on sprints / list-view | **Bullet, not case.** | Same loader mechanism as B11; a missing `name` on a sprint is a `BrokenEntry` by construction. DEG-9's setup says "wrong-typed" — broaden to "wrong-typed, missing a required key, or carrying an unknown key" so a test author seeds all three kinds per loader. |
| **unrecognised** per-entry on milestones / calendar | **Bullet with a real decision inside it.** | projects/labels/sprints degrade an unknown per-entry key to `broken`; milestones and calendar are untested and may passthrough or refuse. The spec point: "an unknown per-entry key degrades the same way in every loader — never refused in one file and silently accepted in another." Put it on DEG-9. If a probe shows milestones passthrough today, that is a decision (A#) not a test. |
| **invalid_value / dangling** on projects | **Correctly n/a / covered.** | Projects have no enum; the one dangling reference (`default:`) is K23 #70. |
| **object_fatal** on user settings | **Bullet — and a data-loss boundary.** | Settings degrades per-key by dropping to default; an *unparseable* `settings.yaml` has no test. The risk is not the read — it is the next save: if load returns defaults and save re-emits them, the user's passthrough keys and every setting are gone. Add to the settings case: "an unparseable settings.yaml is reported; the next settings write does NOT overwrite it with defaults." |

Two cells the grid does not name but the row table exposes:

- **labels `#85–86`** — a malformed colour drops *only the colour*, keeping the entry (MSL-22). That is a third degradation shape (sub-field drop, not `broken`, not health) and DEG-9 does not mention it. One bullet: "a label with a malformed colour is a live label without a colour, not a broken entry (MSL-22)."
- **list-view `#135–138`** — removed custom-field keys are *pruned* from `visible`/`hidden` on load and the pruned form is what gets saved. That is a silent drop of a user's stored value on the next write — the opposite of P7 — with no case defending or forbidding it. Worth surfacing as an open decision, not silently canonicalising by omission.

---

## 4. Over/under-specification

**Split:**

- **DEG-13** (profile + settings). Two objects, two mechanisms: profile lifts into `health` with raw preserved (#54–60); settings drops the bad *known* key to default (#61–62) and preserves only *unknown* keys (#63). Nothing asserts a corrupt known setting's raw survives a load→save. Split into DEG-13 (profile) and DEG-13b (settings), and make the settings case pin the round-trip: "a wrong-typed known setting falls back to its default for reading; on save its stored value is preserved / is replaced by the default" — one of those is true today and neither is written down.
- **DEG-18** (malformed history row). Four surfaces of one kind: feed notice (web/CLI/MCP), doctor severity, merge refusal, restore skip. Split read (feed + doctor `malformed`) from write (merge refuses; restore skips and names the line; object-fatal blocks publish). The write half then absorbs gap §3 #6 for history files; task.md's publish gate still needs § 7.3.
- **DEG-6** title says "refuses"; bullet 2 says "never refuses". Both are the operation rule (§13.3), so one case is right, but retitle: "The operation rule: a read-to-compute refuses, a read-for-idempotency repairs." Add the `setField(<custom>)` over wrong-typed `fields` map bullet.
- **Bulk** (NEW-note "likely DEG-24"). Yes, its own case: per-item refusal lands in `failed` with the `CorruptFieldError` message and the rest proceed (#27–28 + framework §6); an object-fatal member reports "could not be read: <path>", not "not found"; `unchanged` (K25/BLK-27) is distinct from `failed`. Three bullets, three surfaces.

**Merge / trim:**

- **DEG-11 bullet 1** restates DEG-9 (#75, sole-entry-corrupt ≠ none, is B11). Keep DEG-11 as the *surface* case (wire `broken`, notice, panels) and drop the loader bullet.
- **DEG-16** is a hub over CMT-26, CMT-27, GIT-14, #276, #295, #300 — all already canonical. Keep it as the cross-surface index but its bullets must be *additive* (picker offers valid only; editing clears the marker; CLI `(?)` and MCP `Known:` hint are the same requirement) and cite the flow cases for the rest, or it forks the spec.

**Bullets too vague to test against:**

- DEG-1 b3 "attribute the failure the same way" — pin per framework §6 (see § 2 table).
- DEG-5 has no setup sentence; b2 says "only a whole-record author may [drop]" — true for rule 2, but A136.1 says rule 1 (no *new* finding) binds whole-record writers too: `createTask` with a bad `due_date` is refused as `validation_failed` 400 (#213), never written as a corrupt task. Add that bullet; it is the one that stops corruption *entering* the tracker.
- DEG-6 has no setup sentence.
- DEG-11 "[T projects #… ]" and DEG-20 "[T web #… attachments]" — unfilled placeholders.
- DEG-21's parenthetical follow-up ("corruption is the ONLY difference — not yet surfaced") should be a `[cannot be satisfied yet]` bullet, not a parenthesis, or it is invisible to the run.
- DEG-22 is missing the write half: known-gaps "A UI view write drops a concurrently-present *broken* view from queries.yaml" is a live P1 violation with no case. Add: "A view write never drops a broken sibling entry from `queries.yaml`" — cannot be satisfied yet; see § 7.1.

---

## 5. Home & format

**One `flow-degradation.md` / `DEG-` — yes, for the web tree. No, for the CLI/MCP bullets.**

The proposal folds CLI/MCP parity into UI cases ("CLI `show`/`list` and MCP … do the same [NEW]"). `ui-test-cases/README.md` says: "Scope is the web UI only … The CLI and MCP appear only where they collide with the UI." The house already has the answer: `surface-test-cases/` mirrors `ui-test-cases/` **file-for-file**, cases are tagged `CLI MCP` as *one requirement verified twice*, carry no milestone, and use a `-C` suffix (`TSK-C1`). So:

- `docs/dev/ui-test-cases/flow-degradation.md` — `DEG-N · M4 · sev · P#` — web + core behavior.
- `docs/dev/surface-test-cases/flow-degradation.md` — `DEG-CN · sev · P# · CLI MCP` — the parity rows: field-health in `show`/`list`/`get_task`/`list_tasks`; untitled → key; unreadable trailer / `unreadable[]`; config `broken` on `sprint list` etc.; repair via `set`/`unset`/`set_field`/`unset_field`; derived-op refusal exit code vs `isError`; A136.4's filter/truncate; history incomplete count; bulk `failed` messages. Roughly 7–8 cases. The bullets say where CLI and MCP must agree and where they may differ (exit code vs `isError`) — exactly the surface tree's convention.

Cases that already exist in a domain flow (TSK-54, PRU-25, PRU-37, REL-24, REL-49, VUE-22, TML-48, CMT-26, GIT-14, SPR-32, XS-62): keep the DEG case as the cross-cutting hub, but its bullets pin only what the flow case does not; cite the flow case for the rest. Two `@verifies` on one test is fine; two *differently-worded* requirements for one behavior is not.

**Format — three departures from house style:**

1. The behavior is in the heading (`### DEG-1 · … — Object-fatal task corruption is attributed…`). Every flow puts the heading as tags only and the bold claim + concrete setup on the next line. Move it.
2. `_B1._`, `[T …]`, `[NEW …]` are authoring scaffolding. No landed flow carries them; strip before landing (keep the B# map in a comment block or in the run plan).
3. Setups are thin or absent (DEG-5, DEG-6) and several are "a task whose X is corrupt" without the concrete edit. House style is `Hand-edit … to \`start_date: "next tuesday"\`` (TML-48) — the setup is reproducible by a stranger.

Also: `docs/dev/case-index.json` is generated from both trees (961 cases today); a new flow file needs the index regenerated per `tools/README.md`.

---

## 6. Severity / milestone

| Case | Tag | Should be | Why |
|---|---|---|---|
| DEG-7 | minor | **major** | Preservation of a hand-added key across a write is P1/P7 data-loss prevention; only the "Not recognised" rendering is polish. |
| DEG-19 | major | **blocker** | "Never overwrite an unreadable destination" is the P-11 rule (#196). A restore that clobbers a file nobody could read is destruction. |
| DEG-20 | minor | **major** | REL-49, the case it restates, is major; "unreadable ≠ empty" is the SPR-32/ERR-1 class. |
| DEG-21 | major | **blocker** | A corrupt value merged as empty is a silent write-path data loss — the same class as ERR-3, which is blocker. |
| DEG-23 | minor | **major** | Every ⚠/`(broken)` marker on every surface depends on `health` travelling; `raw` never leaving is a leak guard. Not polish. |
| DEG-3 / DEG-5 / DEG-12 | blocker | ✓ | Correct. |
| DEG-8 M1, all others M4 | — | **uniform M4** | Milestone = when verifiable; the untitled→key list cell is M1-verifiable but so is DEG-14's cell (tagged M4). The framework landed in Phase 7 after M4 work began; tag all M4 and stop the inconsistency. The surface-tree copies carry no milestone by convention. |

---

## 7. Additions required before authoring

In priority order. 7.1–7.3 are behaviors with **no spec anywhere**; the rest are the mis-tags and homing fixes.

### 7.1 Config-level preserve-others (the most important omission)

DEG-3/DEG-5 pin, for tasks: a write to one field may not drop or alter an untouched degraded sibling. **No case says this for any other object**, yet every config loader now degrades per-entry (A138), every config *writer* re-serialises from the valid set, and one writer already fails the rule: `saveQueriesConfig` drops a `broken` view on any UI view write (known-gaps, P1 violation, found 2026-09-04, unfixed). `serializeQueriesConfig` "never emits broken" (#169) is the mechanism. list-view's prune (#135–138) is the same shape. Projects/labels/milestones/sprints/workflow writers were not checked here and should be presumed identical until a test says otherwise.

New case (DEG-24 or on DEG-9 as a hard bullet): **"A config write never drops a sibling entry it did not touch, broken or not."** Setup: hand-break one sprint; create a second sprint through the UI; the broken entry's raw text is still in `sprints.yaml`. Same for labels, milestones, projects, views, list-view filters. Blocker, P1 P7. Mostly cannot-be-satisfied-yet — which is precisely why it must be written down.

### 7.2 Aggregate surfaces do not silently undercount

Counts, burndown, milestone progress, export, and `list` totals share `loadAllTasks`. A field-local-corrupt task must be *included* (it is a task); an unreadable one must be *reported*, not skipped. known-gaps already records that milestone progress "skips a malformed task rather than throwing on it" — a silent wrong number. No DEG case, no inventory row. New case: "Aggregates count a degraded task and name an unreadable one; a total is never silently short." Major, P1 P5.

### 7.3 Publish / doctor gate

Gap §3 #6. One case: field-local corruption in task.md → doctor `malformed`, non-blocking, publish proceeds (A135.2, #191); object-fatal task.md or history file → `unreadable`, blocks publish, names the path (#187–193); both present → both reported, not collapsed (#193). Blocker, P1 P11.

### 7.4 The other three missing gaps

- `duplicateTask` (§3 #8) — new case; third bullet cannot-be-satisfied-yet (DUP-H1).
- `mergeTask` health union (§3 #9) — bullet on DEG-21 or its own case under the write half.
- unset-dangling-edge = unlink with inverse (§3 #5) — bullet on DEG-15.
- config `broken` on CLI/MCP (§4) — a `DEG-C` case in the surface tree.

### 7.5 Fix the two wrong tags

- DEG-4 b3: `[NEW]` → cannot-be-satisfied-yet + known-gaps entry ("repair provenance decided in §9, not built; `buildSetFieldHistory` reads frontmatter only, `before` is null for a lifted field").
- DEG-18: web `IncompleteNotice` → `[T ActivityPanel.test.tsx, CMT-37]`; add the MCP half as the actual gap.

### 7.6 Homing, format, severity

Per § 5 and § 6: split CLI/MCP bullets into `surface-test-cases/flow-degradation.md`; move claims out of headings; strip scaffolding; fill the two `#…` placeholders; raise DEG-7/19/20/21/23; uniform M4.

---

## Bottom line

The set is a faithful canonicalisation of what is tested. It is not yet a
canonicalisation of what is *decided*, and it repeats two inventory claims
that a one-line grep disproves. Author it after § 7.1–7.5 are added (five
new cases or hard bullets, two re-tags, one homing split). Do not author
DEG-4 b3 as a `[NEW]` test — it will be red on arrival for a behavior
nobody has scheduled, and the run will stop on it for the wrong reason.

# Grounding review — PROPOSED-degradation-cases.md

Independent verification of the `[T]`/`[NEW]` split in
`PROPOSED-degradation-cases.md` against the actual test suite. Every row
below was checked by opening the cited test file and matching the `it(...)`
description verbatim — the proposal's and the inventory's claims were NOT
trusted. Read-only; nothing was edited.

**Method:** grepped each cited `file:testname` for an exact match; ran the
one file whose status was load-bearing (`ActivityPanel.test.tsx`) to confirm
green. Sample spans all four sections: core task record, config loaders,
wire (web API), web-UI, plus the CLI/MCP surface layer.

---

## 1. `[T]` claims verified (sample ≫ 12, all four sections)

| DEG | bullet claim | inventory # | test file : testname | verdict |
|---|---|---|---|---|
| DEG-1 | object-fatal task → UnreadableTaskError, blocks nothing | #17,#18 | core `corruption-audit.test.ts`: "object-fatal (no id) stays UnreadableTaskError (blocks nothing else)" / "object-fatal (YAML syntax) stays UnreadableTaskError" | **backed** |
| DEG-1 | unreadable task named in list affordance | #275 | web `ListView.test.tsx`: "still lists an unreadable task in the affordance and does not crash" | **backed** |
| DEG-1 | …attributed at the **wire** (`server.errors`) | — | `server.errors.test.ts` — NO test seeds an object-fatal task and asserts the API attributes it "unreadable" not "not found" | **OVER-CLAIM (partial)** — see §3 |
| DEG-2 | wrong-typed due_date degrades, task loads | #4 | core `frontmatter.test.ts`: "degrades a wrong-typed due_date into health, lifting it off frontmatter" | **backed** |
| DEG-2 | title/created_at/updated_at degrade too | #3 | core `frontmatter.test.ts`: "degrades a missing title into health rather than throwing (K26)" | **backed** |
| DEG-3 | set one field, corrupt field survives byte-for-byte | #19 | core `corruption-audit.test.ts`: "HANDLED: set status, <col> raw survives byte-for-byte" | **backed** |
| DEG-4 | valid write clears the finding | #20 | core `corruption-audit.test.ts`: "HANDLED: setting a valid due_date clears the wrong_type finding" | **backed** |
| DEG-4 | unset drops field from health + disk | #21,#22 | core `corruption-audit.test.ts`: "HANDLED: unset an unrecognised top-level key removes it" / "unset a wrong-typed known field removes it" | **backed** |
| DEG-5 | write guard refuses new finding / refuses dropping untouched corrupt / whole-record exempt | #29,#30,#31 | core `corruption-audit.test.ts`: "rule 1 … refused" / "rule 2 … refused" / "rule 2 exemption … may author freely" | **backed** |
| DEG-6 | link/unlink refuse over wrong-typed relationships | #23,#24 | core `corruption-audit.test.ts`: "linkTask refuses over a wrong-typed relationships (source)" / "unlinkTask refuses…" | **backed** |
| DEG-6 | archive over corrupt `archived` is no-op/repair, never persists corrupt | #25,#26 | core `corruption-audit.test.ts`: "archive proceeds and repairs a wrong-typed archived" / "unarchive … correct no-op-or-repair" | **backed** |
| DEG-7 | unrecognised key preserved + surfaced | #5 | core `frontmatter.test.ts`: "moves an unrecognised top-level key into health (kind unrecognised)" | **backed** |
| DEG-8 | untitled → key (board + list) | #241,#273 | web `BoardCard.test.tsx`: "falls back to the key for an untitled task…" / `ListView.test.tsx`: "renders a task with no title by its key…" | **backed** |
| DEG-9 | config entry degrades to broken, rest loads; broken omitted when clean | #67,#73 | core `projects.test.ts`: "degrades a project with an empty prefix to a broken entry" / "omits `broken` entirely when every project is valid" | **backed** |
| DEG-10 | config object-fatal throws, file-attributed | #71 | core `projects.test.ts`: "throws YamlSyntaxError on malformed YAML (tagged with file label)" | **backed** |
| DEG-10 | …wire config-errors names file+field, no white-screen | #202,#203 | `server.config-errors.test.ts`: "names the file and the failing field" / "does not take down endpoints that do not read it" | **backed** |
| DEG-11 | broken ≠ empty (projects core; sprints UI) | #75,#257 | core `projects.test.ts`: "degrades even when EVERY project entry is corrupt…" / web `SprintsView.test.tsx`: "does not read as empty when the only sprint is broken…" | **backed** |
| DEG-11 | broken travels on the wire (sprints) | #209 | `server.config-errors.test.ts`: "is distinguishable from a failed fetch and names the broken rule" | **backed** |
| DEG-12 | state.yaml object-fatal, config_invalid, names file+counter | #44,#49 | core `state.test.ts`: "throws on missing keys object" / "carries the config_invalid code, not the unknown/500 fallback" | **backed** |
| DEG-13 | profile degrades all-but-id | #54,#58 | core `profile.test.ts`: "degrades an unknown timezone into health…" / "degrades an unknown key into health (unrecognised)…" | **backed** |
| DEG-13 | settings drop bad known key, keep passthrough | #61,#63 | core `settings.test.ts`: "degrades a wrong-typed known key (theme: 42) to default…" / "preserves unknown passthrough keys even when a known key is corrupt" | **backed** |
| DEG-14 | dangling/unparseable rel target → missing marker | #36,#39,#43 | core `show.test.ts`: "marks a link to an unparseable task as missing…" / "leaves a genuinely-absent target missing but not corrupt" / "marks relationship targets as missing when the task is gone" | **backed** |
| DEG-14 | deleted user → truncated-ULID + (deleted user) | #228 | web `cells.test.tsx`: "AssigneeCell › degrades a dangling user reference to truncated-ULID + (deleted user)" | **backed** |
| DEG-15 | healthy/corrupt/unreadable target distinction (core + UI) | #37,#38,#247 | core `show.test.ts`: "marks a resolved-but-corrupt target as corrupt, not missing" / "marks an unreadable (object-fatal) target as missing AND corrupt"; web `RelationshipRow.test.tsx`: "marks a resolved-but-corrupt target with a corrupt affordance AND keeps the link" | **backed** |
| DEG-16 | enum/workflow drift keeps raw key, marked (core+web+CLI+MCP) | #150,#285,#295,#300 | core `workflow.test.ts`: "degrades one corrupt status to broken…"; web `describe.test.ts`: "keeps the raw key and marks it…"; CLI `history.test.ts`: "marks a value whose key is no longer in the workflow config"; MCP `mcp.test.ts`: "create_task surfaces a 'Known: ...' hint…" | **backed** |
| DEG-17 | corrupt-dated routed to Unscheduled, marked, not dropped | #268 | web `dateProblem.test.ts`: "routes a corrupt-dated task to the Unscheduled lane, marked corrupt and NOT dropped" | **backed** |
| DEG-18 | doctor: malformed non-blocking (named+kept); unreadable blocks | #182,#187 | core `integrity.test.ts`: "names the file and the entry position" / "reports an unreadable history file as blocking" | **backed** |
| DEG-18 | web activity IncompleteNotice for malformed history | (uninventoried) | `ActivityPanel.test.tsx` — **3 passing tests DO cover this**; marked `[NEW web test gap]` | **OVER-CLAIM / mislabel** — see §2 & §3 |
| DEG-19 | restore never overwrites unreadable dest; refuses partial set | #196,#197 | core `backup.test.ts`: "never writes over a _comments.yaml it could not read (P-11)" / "refuses a partial set, names the missing part, and writes nothing" | **backed** |
| DEG-20 | attachments panel health-agnostic; unreadable dir ≠ empty | #280,#282 | web `AttachmentsPanel.test.tsx`: "renders the grid, tiles and count from attachments alone" / "shows the error affordance instead of the 'no attachments' claim" | **backed** |
| DEG-21 | reconcile marks corrupt side (core) | #176 | core `reconcile-plan.test.ts`: "marks a conflict side as corrupt when that side's task has health on the field (Phase-7B)" | **backed** |
| DEG-22 | saved view stays listed/editable/runs with warning | #167,#221 | core `queries.test.ts`: "collects an unparseable query as a broken marker…"; `server.view-warnings.test.ts`: "keeps the broken view listed and editable…" | **backed** |
| DEG-23 | health-on-wire present-when-corrupt / omitted-when-clean | #199,#201 | `server.health.test.ts`: "opens the task (200) and reports the corruption in `health`" / "a healthy task carries no `health` field" | **backed** |

**Tally:** 30 distinct `[T]` bullet-assertions checked. 28 backed by a real
passing test; **2 over-claims** (DEG-1 wire-attribution portion; DEG-18 web
IncompleteNotice bullet).

---

## 2. `[NEW]` claims checked (correctly-new vs under-claim)

| DEG | `[NEW]` claim | check | verdict |
|---|---|---|---|
| DEG-1 / DEG-8 | CLI `show`/`list` + MCP `get_task`/`list_tasks` render corrupt-field health / untitled→key / unreadable affordance | `cli.test.ts` & `mcp.test.ts` grep for health/(broken)/rawText/corrupt/unreadable → only healthy-view controls exist (cli #1314, mcp #780) | **correctly NEW** |
| DEG-3/4/6 | repair (set-over/unset) + derived-op refusal through **web API / CLI / MCP** over a corrupt field | no wire test round-trips a POST set/unset over an on-disk corrupt task; CLI/MCP as above | **correctly NEW** |
| DEG-4 | repair-provenance history entry (`before`=raw, `meta.was_corrupt`) | `grep -rn was_corrupt` across `packages/core/src` + `apps/` → **zero hits, source included** (not implemented, not tested) | **correctly NEW** |
| DEG-11 | labels/milestones/projects **settings panels** render `broken` | `dataPanels.test.tsx` LabelsPanel covers load-failure vs empty vs duplicate, NOT a per-entry `broken` marker (index+text+validator msg) | **correctly NEW** |
| DEG-18 | web activity `IncompleteNotice` for malformed history | `ActivityPanel.test.tsx` has 3 tests ("says the list is incomplete…", "shows the incomplete notice, not the empty message…", "shows no incomplete notice when nothing was dropped") — **all pass** (ran: 4 passed) | **UNDER-CLAIM** — already tested |
| DEG-21 | reconcile-UI corrupt-side rendering | `ReconcilePanel.tsx` exists but has **no test file** (`find apps/web -iname '*econcile*'` → source only) | **correctly NEW** |
| §bottom | `classifyTaskHealth` element-indexed finding | matches inventory §3 gap #4 / A137.1 ("No test asserts an indexed FieldHealth.field") | **correctly NEW** |
| §bottom | bulk over an object-fatal member says "could not be read" | matches inventory §4 (#214-215 use dangling refs, not on-disk object-fatal) | **correctly NEW** |

**Tally:** 8 `[NEW]` groups checked. 7 correctly-new; **1 under-claim**
(DEG-18 IncompleteNotice — wasted work if a new test is written).

---

## 3. Tested-but-uncased behaviors (the gap this exercise closes)

Real degradation tests that **no DEG case covers or cites**:

1. **`ActivityPanel.test.tsx` — malformed-history IncompleteNotice (web-UI).**
   Never scanned by the inventory (it is not in §1's rows and no `#N`
   references it); the inventory's B18/§4 explicitly assert "the
   `IncompleteNotice` rendering path was NOT found asserted in the scanned
   client tests." It **is** asserted — 3 passing tests. So this behavior is
   both (a) an inventory blind spot and (b) uncased: DEG-18 marks it `[NEW]`
   instead of `[T … ActivityPanel.test.tsx]`. **The single highest-value
   finding.**

2. **`relationships/group.test.ts` #250-252 — relationship-*type* drift.**
   "surfaces an edge whose type workflow.yaml does not declare, under its raw
   key" (unrecognised), "does not offer a removed kind in the picker while its
   links still render" (drift), "lists a duplicated edge once and says how
   many copies the file holds" (file drift). DEG-16 covers enum drift on
   *status/priority cells* and DEG-15 covers rel *targets*, but neither
   covers drift on the edge **type**. No DEG case cites #250-252.
   **Uncased.**

3. **`labels.test.ts` #85-86 — malformed hex color (MSL-22).** "keeps a label
   whose hex color is malformed, dropping only the color" / "drops an 8-digit
   hex color rather than rejecting the file." This is a *sub-field* drop that
   **preserves the entry** — distinct from DEG-9's whole-entry→broken-marker
   degradation. DEG-9 folds it silently under "wrong-typed" without citing it,
   losing the "preserve entry, drop only the bad sub-field" behavior.
   **Effectively uncased.**

Borderline (noted, not counted as clean uncased):

- **`dateProblem.test.ts` #260-267 — the invalid/corrupt/undated classifier
  (TML-48).** DEG-17 cites only `#268` (the routing test) via "web timeline
  B17"; the 8 classifier tests that *establish* invalid≠corrupt≠undated are
  the mechanism behind DEG-17 but are uncited. Arguably folded, but the
  distinction DEG-17 asserts rests on tests it does not name.
- **`list-view.test.ts` #135-138 + `columns.test.ts` #238-240 — removed-field
  pruning / stale list_columns.** Not cited by DEG-22 (queries/saved-views)
  nor concretely by DEG-9 (whose "applies to … list-view chip arrays" line
  gestures at it without a `#N`).

---

## 4. "Cases that need a NEW test" bottom list — accuracy

Checked the proposal's closing list against inventory §3 (decided-but-untested)
and §4 (parity gaps):

- **Accurate & genuinely-new:** CLI/MCP parity (§4 rows 1-3), repair/derived-op
  through surfaces (§4 rows 5-6), DEG-4 provenance (§3 #1), DEG-11 settings
  panel (§3 #10), reconcile-UI (§4 row 9), `classifyTaskHealth` indexed finding
  (§3 #4), bulk-over-object-fatal (§4 row 8). All confirmed untested above.
- **Wrong entry:** "**DEG-18:** web activity IncompleteNotice (parity gap)" —
  this behavior is **already tested** (§2, §3.1). It should be struck from the
  NEW list and DEG-18's bullet retagged `[T … ActivityPanel.test.tsx]`.
- **Incomplete:** the list does not surface the tested-but-uncased items from
  §3.2 (relationship-type drift #250-252) and §3.3 (label hex color #85-86).
  These are not "need a new test" — they are "need a case that cites the
  existing test," which is the very purpose of this exercise, so they belong
  in the proposal's traceability even though they are not gaps.

---

## Verdict

The `[T]`/`[NEW]` split is **substantially trustworthy and safe to drive
tagging, with three corrections applied first.** 28 of 30 sampled `[T]`
assertions map cleanly to a real passing test; 7 of 8 `[NEW]` groups are
genuinely untested. The proposal is well-grounded — its authors clearly read
the inventory carefully.

The one systemic weakness is inherited from the inventory, not introduced by
the proposal: **`ActivityPanel.test.tsx` was never scanned**, so the
malformed-history IncompleteNotice is mis-recorded as untested in both docs.
This produces one under-claim (DEG-18 `[NEW]` that would waste a
re-implementation of an existing test) and one over-claim (DEG-18's `[T]`
bullet cites the wrong evidence). Before tagging:

1. Retag DEG-18's web bullet `[T … ActivityPanel.test.tsx]`; strike DEG-18
   from the NEW list.
2. Downgrade DEG-1's "wire `server.errors`" citation — the object-fatal
   *task* attribution is not tested at the wire; only core (#17,#18) and
   web-UI (#275) back it. Either add a `[NEW]` wire bullet or drop the wire
   claim.
3. Add citations (or new cross-ref cases) for the tested-but-uncased
   relationship-type drift (#250-252) and label hex-color (#85-86) behaviors
   so they are not silently dropped.

None of these is a scope or design problem; all three are citation fixes.
The split does not systematically over-claim coverage (the dangerous
direction), so tagging existing tests `@verifies DEG-N` off this proposal
will not create false green — provided the DEG-1 wire line and the DEG-18
retag are handled.

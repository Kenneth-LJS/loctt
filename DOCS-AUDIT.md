# Documentation audit

A five-slice audit of every markdown file in the repo — 60 files, ~18,000
lines. Companion to [`FEATURE-AUDIT.md`](FEATURE-AUDIT.md), which covers
the code.

**Scope.** Root planning docs, `docs/user/**`, `docs/dev/**`, `tests/**`,
`CLAUDE.md`, `.claude/**`. Findings were verified against source; claims
marked **[verified]** were checked by reading the code, not inferred from
the docs.

---

## 1. The three problems

### Duplication caused at least one real defect

`configuration.md` and `schema-reference.md` both document `workflow.yaml`
end to end — and **disagree about `searchable`**. `configuration.md:146`
says it defaults to `true`; it is required, so following that doc is a
parse error. Two docs owning one spec is how that survived. Deleting
configuration.md's Properties table in favour of a link would have
prevented it.

That is the argument for this whole cleanup: not tidiness, but that
duplicated specs drift and the drift ships.

### Docs describe a product that does not exist

`docs/user/ui/features.md`: of 19 sections, **15 are wholly false, 4
overstated, 0 fully true.** Every route except `/list` renders `Stub`
(`apps/web/src/client/router/index.tsx:41-74`;
`routes/Stub.tsx:1-6` says so in as many words). **[verified]**

The reference docs are worse in a subtler way. **66/66 MCP tools and 33/33
CLI commands have doc entries** — nothing phantom, nothing missing. But
**parameter accuracy for entity tools is ~29%**: the entries describe
parameters the tools do not accept. Name coverage is the wrong metric.

### The `key` → `id` migration never reached the docs

The migration landed in `packages/contracts` and both app surfaces. None
of the three reference docs were updated. Stale ranges, all **[verified]**:

| Doc | Stale range | Scope |
|---|---|---|
| `cli/reference.md` | **109–272** | all four entity families |
| `mcp/reference.md` | **241–494** | ~19 tools documenting a `key` param no tool accepts |
| `schema-reference.md` | **402–541** | four config files |

Worst class: `--label` is *silently ignored*, not rejected.
`loctt project create web --prefix WEB- --label "Website"` creates a
project **named `web`** and discards the label (`project.ts:50-66`).

---

## 2. Fix now — copy-pasteable examples that fail

Each is a documented command or config a user would paste and have break.

| # | Doc | Problem | Evidence |
|---|---|---|---|
| **D1** | `uninstall.md:41,43` | Git branch documented as `.loctt`; it is **`loctt`**. The documented command **fails outright**. Wrong in 8 places across 5 files. | `packages/contracts/src/state.ts:37` |
| **D2** | `schema-reference.md:236-241` | The `relates_to` example is now a **hard parse error** — "inverse equal to key — declare it as symmetric instead". | `packages/contracts/src/workflow.ts:107-113` |
| **D3** | `configuration.md:162-175`, `query-language.md:84-99` | Saved-view examples **omit the required `id`**. | `packages/contracts/src/query.ts:61` |
| **D4** | `configuration.md:146` | `searchable` documented as defaulting to `true`; it is **required**. | contradicts `schema-reference.md` |
| **D5** | `cli/features.md:205-206`, `concepts.md:40,41,61` | `loctt publish` / `loctt sync` **do not exist** — they are `loctt git publish` / `loctt git sync`. README and `cli/reference.md` get it right. | `apps/cli/src/index.ts:63-105` |
| **D6** | `development.md:66` | `node apps/web/dist/index.js` — wrong path, command fails. Entry is `dist/server/index.js`. | `apps/web/package.json:6` |
| **D7** | `configuration.md:104-116` | Example custom field named `sprint`, colliding with the built-in frontmatter field. | `packages/contracts/src/task.ts:73` |
| **D8** | `configuration.md:89-92`, `agent-setup.md:119` | Both reference a `depends_on` relationship that does not ship. | |
| **D9** | `cli/features.md:86` | `--include-archived` is never parsed; the real flag is `--archived`, so the documented one is silently ignored. | `apps/cli/src/commands/task-crud.ts:105` |
| **D10** | `schema-reference.md:590-618` | `state.yaml` documented as keyed by project *key*; actually keyed by **id**. | `packages/core/src/init/defaults.ts:132-140` |
| **D11** | `schema-reference.md:187` | Claims missing arrays are "filled with `[]` on read". The schema is `.strict()` — all required. | |
| **D12** | `query-language.md:76,77` | Both `relationship.type` and `relationship.target` examples can never match — the evaluator reads the whole suffix as the relationship *type*. | `packages/core/src/query/evaluator.ts:348` |

---

## 3. Two lines that mislead every AI session

`CLAUDE.md` is injected into every agent session, so errors there compound.

- **`CLAUDE.md:26` says the git worktree is sparse. It is a full worktree.**
  **[verified]** — `publish-sync.ts:256,428` is a plain `git worktree add`,
  and `grep -rn "sparse" packages/core/src/git/` returns **0** hits. Also
  wrong at `architecture.md:201` — which is wrong *twice* in one sentence,
  since it also calls the branch `.loctt` when the branch is `loctt` and
  `.loctt/` is the data directory. That is D1 appearing in a fifth file,
  and the collision between the two names is likely why it spread.
- **`CLAUDE.md:32` describes `npm run test` as "Run tests across all
  workspaces"** without noting it **skips `tests/e2e` and
  `tests/integration`** (separate `test:e2e` / `test:integration`
  scripts). An agent runs it, sees green, and has verified nothing about
  the CLI binary, MCP stdio, or any user journey. `development.md:100-113`
  and `tests/README.md:48-61` both explain the trap; the one doc every
  agent reads does not.

---

## 4. Contradictions

Where two docs, or two cases in one doc, cannot both be right.

### Resolved by the code — no decision needed

**Body save: autosave, not explicit-save.** `markdown-extensions.md:110-120`
mandates explicit-Save/no-autosave; `flow-tasks.md` TSK-15 mandates 1.5s
idle autosave. **The code settles it** **[verified]**:
`packages/core/src/task/history.ts:12` comments the coalesce window as
"Auto-save", and `COALESCEABLE_KINDS` at `:24` contains exactly
`body_edited`. Under explicit-save there is nothing to coalesce — the
window would merge two deliberate saves ten minutes apart. Autosave is
load-bearing across five further cases in `flow-tasks.md`.
**→ `markdown-extensions.md` is wrong; correct it.**

### Need a decision

| # | Contradiction | Note |
|---|---|---|
| **C1** | **CMT-4 vs CMT-35** — same file, ~320 lines apart, two blockers asserting opposite rules. CMT-4: edit/delete offered "only on the current user's own comments". CMT-35: "anyone may edit or delete anyone's comment". | CMT-35 carries a reasoned paragraph and `editors` bookkeeping, so it reads as the later decision. CMT-6 inherits CMT-4's premise and needs rewriting too. |
| **C2** | **SET-3 vs eight others** — SET-3's read-only workflow panel conflicts with SET-5, SET-6, SET-8, SET-9, SET-16, SET-17, SET-19, SET-21, SET-34. | The API (`PUT /api/workflow`) and `workflow-write.ts` (822 lines) support the editable reading. Recommend dropping SET-3. |
| **C3** | `tests/README.md:129-130` documents `delete --hard`; `architecture.md:147` says it does not exist. | `usage.ts:57` confirms: `delete <task> [--yes]`. |
| **C4** | `--status` default — `cli/reference.md:319` and `schema-reference.md:115` make two *different* wrong claims. | Implement or delete both. |
| **C5** | `structural` relationships — `schema-reference.md:325` is unenforced *and* violated by the shipped default. | Spec, validator, and config disagree three ways. `defaults.ts:69,75`. |
| **C6** | Sidebar pin sweep — SHL-32 / SET-13 / SET-27 / XS-28 disagree four ways on whether it is explained or silent. | |
| **C7** | Rollback atomicity — ERR-13 leaves an escape clause BLK-38 slams shut; BLK-28 and BLK-38 disagree. | |

---

## 5. Duplication, quantified

| Where | Duplicated | Recommendation |
|---|---|---|
| **4 × `features.md`** | All 18 headings appear in all four docs in the same order; only 2 headings unique anywhere. ~180 of ~700 lines pure restatement. Calendar list appears **6×**, workflow list **5×**, same two query examples **6×**. | **One `docs/user/features.md` with per-surface columns.** Strip the duplicated prose and the surface docs are ~65 and ~32 lines of pure invocation — a table column, not a narrative. An empty UI cell becomes unmissable, which is the discipline that would have prevented `ui/features.md`. |
| **3 × root UI plan** | ~470 lines triplicated across `TEMP-UI-DISCREPANCIES` / `TEMP-WEB-TICKETS` / `TEMP-IMPLEMENTATION-PLAN`. Eleven surface areas triplicate. `TEMP-WEB-TICKETS:1` already admits it is "Part C of TEMP-UI-DISCREPANCIES". | See §6. |
| **`configuration.md` ↔ `schema-reference.md`** | Both document `workflow.yaml` end to end, and disagree. | Schema-reference is normative; configuration.md links to it. |
| **CLI ↔ MCP reference** | Archive-vs-delete restated **~9× per file**. | One explanation, cross-linked. |
| **README ↔ getting-started ↔ cli/reference** | `README.md:122-207` (86 lines of CLI usage) is a third copy. Feature list appears a 5th and 6th time in README and `concepts.md`. | README 251 → ~130 lines. |
| **`tests/README.md:262-397`** | 136 lines (⅓ of the file) is a completed build plan. | Delete; it is the source of most of that file's drift. |

---

## 6. Root planning docs

2,821 lines. Completion claims were **verified against source**, not taken
at face value.

| Doc | Lines | Status | Action |
|---|---|---|---|
| `TEMP-WEB-TICKETS.md` | 405 | **LIVE** — your M1.3 tracker | **Keep.** Fix the M1.3 status: FilterBar.tsx (286 lines), buildDsl.ts, SaveViewDialog.tsx are built but ticked ⬜ |
| `TEMP-UI-DISCREPANCIES.md` | 952 | Live *as a register*, completed *as a plan* | **Split** — extract Part D, discard the rest |
| `TEMP-IMPLEMENTATION-PLAN.md` | 718 | Superseded **and factually wrong** | Delete after harvesting 4 passages |
| `TEMP-REVIEW-FIXES.md` | 677 | **Completed** — all 4 phases verified true | Delete after harvesting lines 30-52 |
| `TEMP-BUGS-INIT-OPTIONS.md` | 69 | Stale — superseded by FEATURE-AUDIT B13 | Delete |
| `TODO.md` | 11 | Stale — "Active work" is empty | Delete |

**Highest deletion risk: Part D, lines 755-880** — 78 keyed decisions
(D/SV/C/B/Q/P series) that exist nowhere else. Losing C1/C2 means someone
"fixes" the deliberately CLI-only migrate gap; losing B7/B8/B18 makes three
deliberately-dropped features read as merely unbuilt.
**→ Extract to `docs/dev/decisions.md`, keys preserved.**

Two corrections found while verifying:

- **`CW-17 ✅` is false.** `card_layout` as an ordered array exists
  nowhere; the only occurrence is the *old* boolean-map shape in
  `packages/contracts/src/users.test.ts:31`.
- **Eight `CW` items are un-ticked but landed in core.** Any surviving
  register needs two columns — *core landed* vs *surface wired* — or
  ticking Part B wholesale asserts features that do not exist.

**`TEMP-IMPLEMENTATION-PLAN.md` is the root of the `key`/slug confusion.**
It specifies a project `key`/slug that `ProjectDefSchema` (`.strict()`)
does not have — a superseded planning doc that kept seeding wrong
assumptions into the reference docs.

Also: `TEMP-REVIEW-FIXES.md:10` forbids deleting
`TEMP-IMPLEMENTATION-PLAN.md` — a rule from a finished job protecting a doc
that says to delete itself once the UI ships.

---

## 7. UI test-case tree

866 cases across 19 files, counted mechanically. 283 blocker / 415 major /
168 minor.

**The structure is excellent and should not change.** Zero malformed
headers, zero ID collisions across all 19 files, zero numbering gaps —
every file runs 1…N contiguously. Every case carries severity and ≥1
principle. No renumbering hazard anywhere. Keep the by-flow split; it is
the tree's best feature.

**Cases that stop at the UI boundary — 21 total** (2 known, 19 new). A case
that asserts the UI *emitted* something without asserting the far end
*accepted* it. This pattern is why real bugs survived:

- The two known bugs both sit in the weak half.
- It concentrates in flow-list, flow-bulk (export), BRD-10, TML-10, SET-12.
- flow-tasks, flow-relationships, flow-git-sync, flow-task-create are
  rigorous about disk verification.
- Sharpest examples: **TML-9 and TML-11 read the file, TML-10 does not**;
  **PRU-13 checks disk, PRU-27 checks only the request**; **BRD-9 checks
  disk, BRD-10 checks only the payload plus a client re-render.**

**Blast radii were understated across the board:** SET-14's Diagnostics gap
blocks **9** cases (not 3); the `working_days` gap blocks **9** (not 2);
the missing project slug blocks **6** PRU cases (not 4); the
`{error: string}` envelope makes **60+** cases unsatisfiable.

**Correction to `FEATURE-AUDIT.md`:** `bulk_op_id` **does** have a producer
— `task/bulk.ts:95` and `task/move.ts:139` both mint one via `ulid()`
**[verified]**. The real gap is that `apps/web/src/server/server.ts` has
**no bulk route at all** (`grep -c bulk` → 0), so all 48 BLK cases are
unbacked at the HTTP layer, not at core. FEATURE-AUDIT §2 B19 should be
read with that correction.

**Principle hygiene.** No principle is dead (all ≥52 defenders), but **P4
is at 290 — one case in three** — and has stopped discriminating; consider
splitting it into message-content vs data-state-claim. **Four of ten rows
in the README's principle→flow index are wrong**: P3 names flow-tasks (9
cases) while omitting flow-timeline, its heaviest user at 22; P1 omits
flow-board (16); P9 has bulk and list in the wrong order; P6 omits
app-shell.

Also: 5 dangling `§ F` cross-references (the file has only §A/B/C); all 54
A11Y cases tagged M4 despite the file's own preamble saying they apply from
M1; 11 milestone inversions where an M1 case depends on M2–M4 work.

**Consolidation:** ~866 → ~700 cases, ~6,300 → ~4,800 lines, with no
requirement lost — every proposed deletion has a named owner. Merge
flow-task-create into flow-tasks; split the 66-case flow-cross-surface;
mark flow-git-sync and flow-comments-activity as unbuilt (76 cases, 728
lines with zero backing on any surface).

---

## 8. Files to delete outright

| File | Lines | Why |
|---|---|---|
| `.claude/SETUP_GUIDE.md` | 622 | **Scaffolding for a different project.** Zero LocTT content; an i18n decision framework, references to 4 nonexistent files and a nonexistent `prds/` tree, instructions to create 6 skills that already exist. Its stated purpose (`:486-493`) is "copy to new project" — so it belongs in a template repo, not here. |
| `docs/dev/design-suggestions.md` | 59 | **Abandoned.** The lexorank decision it calls blocking shipped and is documented at `architecture.md:176-185`. Dead absolute path, an empty section, orphan numbering ("### 6" with no 3/4/5). |
| `TODO.md` | 11 | Empty. |

---

## 9. Missing

- **No docs index.** `README.md:245-247` lists 3 of `docs/dev/`'s contents,
  missing `markdown-extensions.md`, `design-suggestions.md`, and 28 files
  across `ui-test-cases/` + `surface-test-cases/` — a connected component
  unreachable from any entry point.
- **`architecture.md`'s git section is 3 lines** (`:199-203`) for a
  10-module subsystem. Describes publish only; no mention of
  `three-way.ts`. `README.md:219` and `git-sync.md` are both ahead of it.
- **Undocumented but shipping:** `relationships[].kind` and `timeline`
  (both default-enabled), `list-view.yaml` and `_comments.yaml` (two live
  file formats absent from the file-format spec entirely, including its
  Directory Layout block), `--ids` on four `list` subcommands
  (load-bearing — the only way to discover the ids every ref-taking
  command now needs), and the global `--cwd`.
- **A testing principle about oracle validity.** The current three rules
  are hygiene; none concerns whether an *expectation* is correct — so none
  would have caught the three suites that assert bugs. Suggested addition:
  *when a fix requires editing a green test, that test was asserting the
  bug — record why in the commit.*

---

## 10. Suggested order

1. **§2 (D1–D12)** — broken examples. Each is a small, isolated edit and
   each currently breaks for a user who pastes it. D1 first: the uninstall
   command fails.
2. **§3** — the two `CLAUDE.md` lines. One-line fixes; they mislead every
   session until changed.
3. **§8** — delete the three dead files. No dependencies.
4. **Extract Part D → `docs/dev/decisions.md`**, then §6's deletions.
   Extraction must land first.
5. **§5** — merge the four `features.md` and trim README. Rewrite
   `ui/features.md` as "planned" or delete until the UI exists.
6. **§4 C1–C7** — the contradictions needing your decision.
7. **§7** — UI tree consolidation, and the 21 boundary cases. Largest, and
   safe to defer: the tree is structurally sound.

**Sequencing note:** the working tree is dirty and M1.3 is mid-flight.
Commit before deleting sibling docs.

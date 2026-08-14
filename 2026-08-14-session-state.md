# Session state — 2026-08-14

Where things stand after a code audit, a docs audit, a git data-loss fix,
and a partial pass at the v1 decision backlog.

**Baseline:** `b4f0fbf`. Everything below is uncommitted working-tree
state. `npm run test` → **1,585 passing, 1 skipped**; typecheck and lint
clean. Note `npm run test` does **not** cover `tests/e2e` or
`tests/integration` — those are `npm run test:e2e` and
`npm run test:integration`.

**How to use this doc:** §1 is what changed. §2 is the work queue, ordered
and with dependencies stated. §3 is decisions already made so we don't
relitigate them. §4 is what needs a decision from you. §5 is where the
detail lives.

---

## 1. What was done

### Code

| Change | Files | Tests |
|---|---|---|
| **Git sync 3-way comparison** — replaces a blind branch-over-local mirror that destroyed data. Four reproduced failures fixed: local field edits discarded, locally-created tasks deleted unrecoverably, `.schema-version` overwritten (bricking the tracker), foreign `loctt` branch destroyed on publish. | `git/three-way.ts` (new), `git/publish-sync.ts`, `git/index.ts` | 60 in `git/` (was 41) |
| **Branch-rename coverage** — `git.branch` is configurable; nothing tested a non-default value. Code was already branch-agnostic; now proven. | `git/publish-sync.test.ts` | +3 |
| **`relationship.type` / `relationship.target` DSL** — both documented, both broken; the evaluator read the suffix as a kind name and the validator rejected the reserved names outright. | `query/evaluator.ts`, `query/validate.ts` | +9 |
| **`card_layout` ordered array (CW-17) + `editor_mode` (D17)** — was ticked done while only the superseded boolean-map shape existed in a test fixture. | `contracts/users.ts`, `contracts/index.ts` | +9 |
| **Sync/publish reporting** — CLI and MCP now say what changed ("3 updated, 1 removed") instead of a bare success. | `cli/commands/git.ts`, `mcp/tools/git.ts` | — |

### Docs

- **Merged 4 × `features.md` → 1** with a per-surface support matrix.
  Deleted `docs/user/cli/features.md` and `docs/user/mcp/features.md`;
  their unique content (CLI invocations, MCP tool names, the `attach_file`
  security note) is preserved in the merged doc. `ui/features.md` kept as
  the UI spec.
- **Fixed 12 copy-pasteable examples that failed**, then verified the YAML
  parses against the real schemas. Includes the git branch documented as
  `.loctt` in 9 places (the uninstall command failed outright), a
  `relates_to` example that is now a hard parse error, saved-view examples
  missing the required `id`, and `loctt publish`/`loctt sync` which do not
  exist (they are `loctt git publish` / `loctt git sync`).
- **`CLAUDE.md`**: corrected the sparse-worktree claim, documented the
  `npm run test` trap, linked the new invariants doc.
- **New:** `docs/dev/decisions.md`, `docs/dev/invariants.md`,
  `docs/dev/surface-test-cases/` (65 CLI+MCP cases in 10 files).
- **Audits:** `FEATURE-AUDIT.md`, `DOCS-AUDIT.md`, `PROPOSED-UI-CASES.md`.

### Known defect in the above

`docs/user/common/query-language.md` — I documented
`relationship.blocks = T-10` and
`relationship.type = blocks and relationship.target = T-10` as equivalent.
**They are not.** The shorthand requires one edge to match both; the
conjunction is two independent filters, so two *different* edges can
satisfy it. A task with `blocks → T-20` and `parent → T-10` matches the
second and not the first. The doc has been corrected but **there is no
test locking the distinction in** — that was in progress when this doc was
written. See §2 item 0.

---

## 2. Work queue

Ordered. Dependencies are stated because three items are blocked.

**Phase 2 progress:** 0i, 0e, 0d done. Working order is live bugs first,
then by dependency — next up 0c (hierarchy), which item 0 depends on.

### 0. Relationship query syntax — redesign (Tier 0 + Tier 1)
**Blocked by:** nothing. **Size:** small-medium.

**DECIDED:** scope is **Tier 0 + Tier 1 only** — per-task predicates and
local counts. No subqueries, no recursion (see "Explicitly out").

**SYNTAX: JQL function form**, as approved. Kind names always sit in
quoted value position, so no reserved words are needed and a collision is
structurally impossible whatever a workspace names its relationships.

#### Why the current syntax goes

1. **Dot means value, not field.** Everywhere else `a.b` is field access
   (`status.category`, `fields.impact.severity`). Only here is the segment
   after the dot a *value*.
2. **It looks scalar but is existential.** A task has many edges, so
   `relationship.type = blocks` means "∃ an edge where type = blocks".
   Field syntax hid that, producing the same-edge/different-edge trap.

#### Target syntax

```
has_link("blocks")                     -- blocks something
has_link("is_blocked_by")              -- is blocked by something
has_link("blocks", "T-2")              -- blocks T-2 specifically
has_link("is_blocked_by", "T-1")       -- blocked by T-1 specifically
not has_link()                         -- orphan: no links at all
link_count("child") > 3                -- more than 3 children
parent = T-5                           -- unchanged; this IS core JQL
```

Arity picks the question: `has_link(kind)` tests existence,
`has_link(kind, target)` tests a **single edge** matching both. There is no
way to write kind and target as separate conditions, so the
same-edge/different-edge trap that caused the original defect cannot be
expressed.

**Both directions of every link are queryable as plain predicates**,
because `linkTask` writes the forward edge on A *and* the inverse on B
(`task/relationships.ts:295-298`). "What blocks T-2" is a forward lookup
on the inverse key — in Jira that needs ScriptRunner.

#### No reserved words needed

Because kind names appear only as quoted values, never as field or
sub-field names, a workspace may name a relationship kind `type`,
`target`, `count`, or anything else without breaking queries. This is the
main reason the function form was chosen over a field form.

#### Scope

- **Function-call parsing required.** `parser.ts` knows only
  `field op value` today. The tokenizer already emits
  `FIELD LPAREN … COMMA … RPAREN` for `has_link("blocks", "T-2")` with no
  tokenizer change, so this is a parser addition only. `link_count(...)`
  returns a number and composes with existing comparison operators.
- **Evaluator stays purely per-task.** `evaluateQuery` keeps its current
  signature; no corpus index, no `EvalContext` growth. Every predicate is
  answerable from the task's own frontmatter.

#### Also fold in

- **Remove** `relationship.type` / `relationship.target` (added this
  session, uncommitted, plus 9 tests in `evaluator.test.ts`) — superseded.
- **`validate.ts:174` rejects inverse keys.** It maps `r => r.key` only,
  so `relationship.is_blocked_by = T-1` fails validation though the
  evaluator handles it. `relationshipTypeKeys()`
  (`contracts/workflow.ts:157`) already returns both keys and its
  docstring says it exists for exactly this. **This single line currently
  blocks the reverse-direction queries that are the whole point.**
- **`parent` alias hardcodes the literal kind `"parent"`**
  (`evaluator.ts:305`) instead of reading workflow config. Rename that
  configurable kind and the alias breaks silently while still validating.
  Resolve the structural kind from config instead.
- **Hard break** — old syntax errors with a message naming the new form.

#### Two defects this replaces (both live today)

- **`relationship.blocks = T-10` cannot match any task.** Form A
  (`evaluator.ts:439`) compares the raw ULID `r.target` and never calls
  `ctx.resolveKey`. This is the exact example at `query-language.md:78`
  and `:96`. `evaluator.test.ts:342` quietly confirms it with a raw ULID.
- **Form A and Form B have divergent `!=` semantics.** Form A is "some
  edge differs"; Form B is "no edge matches". Only the latter is
  documented.

#### Explicitly out of scope

Scoped out to keep the evaluator per-task and avoid two-phase evaluation:

| Capability | Example | Needs |
|---|---|---|
| Query-anchored | "blocked by anything still open" | subqueries (T2) |
| Transitive chains | "everything ultimately blocked by T-1" | graph walk (T3) |
| Cross-task rollup | "epics with ≥1 blocked child" | child index (T2/T1+) |
| Siblings | "other children of my parent" | subqueries (T2) |

If these are wanted later, `traversal.ts` already has ~80% of the walk
machinery — `findStructuralCycles` (`:136-225`) is a proper iterative
3-colour DFS with back-edge detection, and `buildTree` (`:71-93`) is
DAG-aware and builds the adjacency map in one corpus pass. Missing:
generalization from `structural` to any kind, a start-set parameter, and a
depth cap. **Note:** `getChildren`/`getParents` are O(n) linear scans, so
recursion must go through `buildTree`'s index, not those.

#### Blast radius: near zero

**Nothing in production uses relationship querying.** Not the default
`queries.yaml` (`init/defaults.ts:109-130`), not the six built-in sidebar
filters, not `buildDsl.ts`, not the CLI usage text, and not one
integration or e2e test — every relationship test under `tests/` covers
link/unlink *storage*, never the DSL. Cost is ~20 unit assertions and ~15
doc lines. **This is the cheapest moment this will ever be.**

#### Capability vs Jira, for the record

| Question | LocTT (T0/T1) | Jira |
|---|---|---|
| Has any link of kind X | `has_link("blocks")` | ScriptRunner |
| What blocks T-2 | `has_link("blocks", "T-2")` | ScriptRunner |
| Orphans (no links) | `not has_link()` | ScriptRunner, awkwardly |
| Child count > N | `link_count("child") > 3` | JQL Search Extensions (3rd add-on) |
| Child of X | `parent = T-5` | **core JQL** — identical spelling |

Core JQL has *no* link-traversal function at all. T0+T1 exceeds what most
Jira installations can do.

### 0b. Status is mandatory, with an explicit default
**Blocked by:** B9 (validateWorkflowConfig never runs on a write path) —
the "exactly one default" rule needs a live validator to enforce it.
**Size:** small-medium.

**Problem.** `cli/reference.md:319` promises "the first status in
`workflow.yaml`"; `schema-reference.md:115` promises "the first `pending`
status". `createTask` (`task/create.ts:81`) implements neither — status is
conditionally spread, so a task created without one has **no `status` key
at all** (`TaskFrontmatterSchema:57` has it optional). Such a task matches
neither `status = backlog` nor `status != done`, so it is invisible to
ordinary filtering. All three surfaces funnel through `createTask`, so all
three produce them.

**DECIDED — the default becomes explicit config, not an implicit rule.**

- Add `default: boolean` to `StatusDefSchema`
  (`contracts/workflow.ts:24-30`, currently `.strict()` with
  `{key, label, category, icon?, color?}`).
- **Exactly one** status carries `default: true`. Marking another
  un-defaults the rest.
- **The default status cannot be deleted** — reassign the default first.
- `createTask` assigns the default when no status is given. Status becomes
  effectively mandatory on the created task.
- Enforced by a Zod refinement **and** `validateWorkflowConfig`, on every
  write path. Reject rather than auto-correct: silently rewriting config
  the user didn't touch is worse than a clear error.

**Shipped set is unchanged — four statuses, not three:**
`backlog` (pending, **default**) · `in_progress` (active) ·
`done` (completed) · `wont_do` (discarded). The fourth exists because
`discarded` is its own category; the built-in "still open" filter is
`status.category not in (completed, discarded)` and depends on the split.

**No backward compatibility needed** — the tracker has no external users,
so no migration for status-less tasks. (Had there been, `migrate.ts`
already has atomic-with-backup machinery.)

**Also:** correct both doc claims to describe the `default: true` rule.

### 0c. Replace `structural` with `hierarchy`
**Blocked by:** nothing. **Size:** small-medium.

**Problem.** `structural: true` silently does two unrelated jobs:

1. **Cycle prevention** (`task/relationships.ts:241`) — gated per
   relationship, so it handles **any number** of structural kinds
   correctly.
2. **Tree display** (`task/traversal.ts:104`) —
   `config.relationships.find(r => r.structural)` takes the **first match
   only** and silently ignores the rest.

The shipped default marks **both** `blocks` and `parent` structural, and
`blocks` is declared first — so **`getChildren` currently builds trees out
of blocking relationships, not parent/child.** A silent wrong answer, not
a documented limitation.

`schema-reference.md:325` used to claim "at most one structural pair",
which the shipped default violated and nothing enforced. That claim has
already been corrected to describe reality; this item replaces the
mechanism.

**DECIDED — drop `structural`, add a `graph` enum.**

Revised during phase 2. The earlier `hierarchy: boolean` decision coupled
two separable things: forbidding cycles, and being drawable as a tree.
`blocks` wants the first and not the second — a blocks cycle is a
deadlock, but nobody draws a blocks tree. A single boolean forces them
together; two booleans make the incoherent combination
(`hierarchy` without `acyclic`) expressible and needing validation.

An enum makes it unspellable instead:

```yaml
graph: none      # no restriction (default; omit the field)
graph: acyclic   # cycles rejected
graph: tree      # cycles rejected AND drawable as a tree axis
```

- `graph?: "none" | "acyclic" | "tree"` on `RelationshipDef`, replacing
  `structural` entirely.
- **Optional.** Absent means `none`, so the four unconstrained shipped
  kinds (`relates_to`, `clones`, `duplicates`, `causes`) need no line —
  the field appears only where a constraint exists, matching how `ranked`
  and `inverse` already behave.
- **Any number of kinds may be `tree`.** The axis is chosen per view, not
  by config order.
- Shipped default: `parent` → `tree`, `blocks` → `acyclic`. So `blocks`
  keeps its deadlock protection but no longer pollutes the tree-axis
  picker.
- **Hard break, no compatibility shim.** `structural` is rejected with an
  error naming `graph` and the value to use. The schema is `.strict()`, so
  an unknown key already fails; the message makes the fix obvious. No
  external users, so no migration — consistent with 0b and item 0.

**Tree axis is a view parameter, not config.** Tree/board/timeline views
take the relationship key to draw; `getChildren` / `getParents` /
`buildTree` take it as a **required** argument instead of searching config
for the first match. No default: an omitted axis is a compile error rather
than a silent guess, which is the failure mode this item exists to remove.
All three are exported from core but called from no production code today,
so making it required costs only test signatures.

**UI consequence:** with no `graph: tree` relationship defined, a tree view
is impossible — **disable the button with a tooltip** explaining that no
tree relationship is configured, rather than rendering an empty tree.

#### Cycles can reach a tree axis regardless of the flag

The cycle guard at `relationships.ts:241` is **link-time only** and reads
the config as it stands at that moment. Three routes get a cycle past it,
and only the first involves anyone doing something questionable:

1. **Config flip** — set `graph: none`, create `A → B → A`, set it back to
   `tree`. Each step is individually legal.
2. **Direct file edit** — `task.md` is text.
3. **Git sync** — two people each add half a cycle offline and the merge
   produces one. *Nobody performed an invalid operation.* This became more
   reachable with the 3-way sync landed in `95fd0e8`.

The docstring at `traversal.ts:126` already acknowledges 2 and 3.

**Verified behaviour on a cycle today** (`A ⇄ B`, axis `parent`):

| | Result |
|---|---|
| `buildTree` | Completes — single pass, no recursion, no hang |
| Roots (`tree.get("")`) | **Empty** — every node has a parent |
| The cycle | Present in the map, intact |

So core does not crash. The trap is downstream: a renderer starting from
roots shows **an empty tree with no explanation**, and one walking from an
arbitrary node **recurses forever**. `buildTree` hands back a map that
looks fine and is not.

**DECIDED — three rulings:**

- **`buildTree` detects and reports cycles.** It returns the adjacency map
  *plus* the cycles found, so a caller cannot forget to ask. Costs one
  extra O(n) DFS over the map it already built — the same walk
  `findStructuralCycles` does. Leaving it to the caller is the shape that
  produced this defect in the first place.
- **The tree view renders the acyclic part and banners the cycle**,
  naming the tasks involved and linking to them. The user keeps a usable
  view and learns exactly what to fix. Refusing to render would take a
  whole tree away over one bad edge that may have arrived via a merge the
  user never made. Consistent with P7 and with 0k.
- **Setting `graph: tree` on a relationship whose data already contains a
  cycle warns but is allowed.** Blocking would strand a user who wants the
  guard active *while* they clean up. This is a rule spanning config and
  task data, so it needs the write path to run it — **B9**.

**Also fixes:** the `parent` alias hardcoding `"parent"`
(`evaluator.ts:305`) gets a config-driven source — already noted in item 0.

**Verified before starting:** `parseWorkflowConfig(defaultWorkflowYaml())`
→ `relationships.find(r => r.structural).key === "blocks"`, so on a
default tracker `getChildren` really does return blocked tasks rather than
children. Not user-visible yet: `getChildren`, `getParents` and
`buildTree` are exported from core and called from **no production code** —
only tests. This is fix-before-first-use, not a live defect.

### 0m. B9 — cross-field config validation never runs on a write
**Blocked by:** nothing. **Blocks:** 0b, and the config-vs-data warning in
0c. **Size:** small-medium.

Two validators exist and only the weaker one guards writes:

| | Checks | Runs on write? |
|---|---|---|
| `parseWorkflowConfig` (Zod) | Shape of each entry, unknown keys | ✅ `workflow-write.ts:88` |
| `validateWorkflowConfig` | Rules **spanning** entries — duplicate keys, dangling references | ❌ only `doctor.ts:78` |

Zod validates each relationship independently, so it cannot see that two
entries collide. That is what `validateWorkflowConfig` is for, and it has
exactly one production caller: `loctt doctor`.

**Demonstrated:** built a config with a duplicate `blocks` relationship,
confirmed `validateWorkflowConfig` returns errors for it, called
`saveWorkflowConfig` — and `workflow.yaml` came back with `key: blocks`
twice. `doctor` reports it only afterwards.

**Why it matters beyond tidiness:** every rule of the form "exactly one X"
or "this must reference a real Y" is unenforceable at write time. 0b's
"exactly one status has `default: true`" is precisely that shape, which is
why 0b is blocked here.

**Fix:** call `validateWorkflowConfig` inside `saveWorkflowConfig` and
reject on errors. Check the callers first — `workflow-write.ts` performs
per-collection remaps, so a save that is mid-remap may transiently look
invalid; validation must run against the final config, not an
intermediate.

### 0d. Delete the superseded root planning docs — ✅ DONE (`781e9a1`)
**Blocked by:** committing the extraction first. **Size:** trivial.

**Outcome:** five deleted as decided. `temp-ui-mockups/` kept and given a
README — every reference to it lived in a deleted doc except
`TEMP-WEB-TICKETS.md`, which said to delete it. Corrected. All 39 app
design tokens originate there, so it is a live upstream source.

**DECIDED — delete all five, in two commits.**

1. **Commit the extraction** — `docs/dev/decisions.md` and
   `docs/dev/invariants.md`.
2. **Then delete**, as a separate commit, so a miss is a two-commit revert
   rather than archaeology through a combined diff.

| Doc | Lines | Why it goes |
|---|---|---|
| `TEMP-UI-DISCREPANCIES.md` | 952 | Part D extracted; the rest is a superseded plan |
| `TEMP-IMPLEMENTATION-PLAN.md` | 718 | Superseded **and actively wrong** — specifies a project `key`/slug that `ProjectDefSchema` (`.strict()`) does not have. Root of the stale key-era spec that infected three reference docs. |
| `TEMP-REVIEW-FIXES.md` | 677 | All 4 phases **verified DONE** against source |
| `TEMP-BUGS-INIT-OPTIONS.md` | 69 | Superseded by FEATURE-AUDIT B13 (wider scope — see 0e) |
| `TODO.md` | 11 | "Active work" explicitly empty |

`TEMP-WEB-TICKETS.md` (405) **stays** — live M1.3 tracker.

**Extraction accounting:** of Part D's 78 keyed decisions, 46 are
preserved (19 deliberately-not-built, 8 unbuilt-and-unticketed, 7
superseded, 11 invariants). The other 32 are decisions whose outcome is
visible in code — duplicating them would create a second thing to drift.
Git history preserves everything regardless.

### 0e. Init silently drops `--project-key` / `--project-label` — ✅ DONE (`009a3b7`)
**Blocked by:** nothing. **Size:** small.

**Outcome:** `--project-label` implemented (maps to core's `projectName`);
`--project-key` removed everywhere and now rejected with exit 2 via a new
`rejectUnknownFlags` helper. Covered on CLI and MCP.

Lifted out of `TEMP-BUGS-INIT-OPTIONS.md` before that file is deleted, so
the bug does not vanish with its note. **Wider than that note claims** —
it says "CLI only"; it is on **all three surfaces**:

- `apps/cli/src/commands/init.ts` — reads both flags, forwards neither
- `apps/mcp/src/tools/tracker.ts:86-92` — same conditional spread
- `apps/web/src/server/server.ts:1405-1406` — same

`InitRequestSchema` (`contracts/service-schemas.ts:75-80`) **declares**
`projectKey`/`projectLabel` as public API while its docstring claims it
"Mirrors core's `InitOptions`" — it does not, and because it is
`.strict()` it rejects unknown keys while accepting and discarding these
two. Verified: `initLoctt({projectLabel:"Bug tracker"})` yields
`name: "Tasks"`.

The worked example at `docs/user/cli/reference.md:44` is a command where
two of three flags are no-ops. Zero tests repo-wide mention any spelling
of the option.

**Recommended resolution** (from the audit): **remove `--project-key`**
entirely — `projects.yaml` has no slug field, so it can never be honoured
— and **implement `--project-label`** so the documented example works.

### 0f. Correct `TEMP-WEB-TICKETS.md` status marks
**Blocked by:** nothing. **Size:** trivial (edits), pending verification.

This is the one planning doc being **kept**, so a wrong tick misleads
every future session.

**M1.3 — mark 🔨 in-progress, not ✅.** The work exists untracked:
`FilterBar.tsx` (286 lines), `FilterBar.test.tsx`, `buildDsl.ts`,
`buildDsl.test.ts`, `SaveViewDialog.tsx`, `FilterDropdown.tsx`,
`useCreateView.ts`, `ui/Modal.tsx`. **But it is built incorrectly:**
`buildDsl.ts:39` emits `field in [a, b]` with square brackets and the
tokenizer has no `[` token, so the generated DSL cannot be parsed
(blocker **B8**). `buildDsl.test.ts:26` asserts the broken output, so the
test passes while encoding the bug.

Ticking it ✅ would repeat the CW-17 failure — marked done while never
built. Note the B8 dependency on the ticket itself, since M1.4 and the
milestone-1 review gate both read this file.

**All other ✅ marks are being verified against source** (Phase 0, M1.1,
M1.2, and any ticked M2–M4 items). Results pending; corrections to be
applied from that verification.

### 0g. Resolve UI test-case contradictions
**Blocked by:** nothing. **Size:** small (doc edits).

**CMT-4 vs CMT-35 — CMT-35 wins.** "Anyone may edit or delete anyone's
comment." Drop CMT-4; **rewrite CMT-6**, which inherits CMT-4's ownership
premise.

Rationale: `comments.ts` already stores an `editors` provenance array — a
field that only makes sense if someone other than the author can edit. And
LocTT deliberately has **no roles or permissions** (Q25), so an ownership
check would be the product's only permission rule, incoherent with
everything else.

**SET-3 vs nine others — drop SET-3.** Workflow panels are editable.
SET-5, SET-6, SET-8, SET-9, SET-16, SET-17, SET-19, SET-21 and SET-34 all
assume editing, and `PUT /api/workflow` plus `config/workflow-write.ts`
(822 lines, full per-collection remap) exist to support it. SET-3 reads
as an early read-only-first draft that was superseded and never removed.

**A fresh contradiction sweep across all 18 flow docs is running** — the
earlier pass found six (the two above plus the sidebar-pin four-way, the
ERR-13/BLK-38 rollback pair, BLK-28/BLK-38 atomicity, and SHL-37 making
A11Y-49 untestable). Results pending; those six also need resolving.

### 0h. Fix the 21 UI cases that stop at the UI boundary
**Blocked by:** nothing. **Size:** small (one bullet per case).

**The pattern.** A case asserts the UI *emitted* something — a URL param,
a request payload, a control appearing — without asserting the far end
*accepted* it. Two live bugs hid in exactly this gap:

- **LST-16** checks `field.team=platform` reaches the URL and a chip
  appears. It never checks the result set narrows. `useTasks.ts:53-69`
  strips every `field.*` key, so the case passes while the filter does
  nothing.
- **VUE-6** checks `queries.yaml` gains an entry and the view runs. It
  never re-reads the file. `config/queries.ts:42` rejects the **entire
  file** on one bad entry, so a malformed save silently destroys every
  other view.

**This is inconsistency, not house style.** Adjacent cases get it right:
TML-9 and TML-11 read the file, **TML-10 does not**. BRD-9 checks disk,
**BRD-10 checks only the payload plus a client re-render**. PRU-13 checks
disk, **PRU-27 checks only the request**. SET-11 and BRD-4 are complete;
SET-12 is not.

**DECIDED — add the missing far-end assertion to all 21**, and add a rule
to `ui-test-cases/README.md`: *a case asserting a write must assert the
far end — the file on disk, or a read-back through a different surface.
Asserting that the UI sent something is not asserting that anything
happened.*

**The 21, with the assertion each needs:**

| Case | Add |
|---|---|
| LST-16 | Result set narrows to matching tasks |
| VUE-6 | `queries.yaml` still parses **as a whole** after the write |
| LST-9 | Result-set narrowing for the other 8 facets, not just `status` |
| LST-3 | The request carried the sort (else a client-side sort passes) |
| LST-17 | Same **rows**, not same row count |
| BLK-14 | The 37 exported rows are the same 37 tasks |
| BLK-37 | Compare exported file **content**; no filter dropped server-side |
| BRD-10 | Re-read `task.md` (BRD-9 does) |
| TML-10 | Re-read the file (TML-9 and TML-11 do) |
| SPR-4 | Overview column count changes after refetch |
| SET-6 | Order survives a **cold reload**, not just next render |
| SET-12 | The write landed in `settings.yaml` (SET-11 does) |
| PRU-2 | The server actually filtered by `project` |
| PRU-27 | What landed **on disk** at `users/<id>/avatar.<ext>` |
| MSL-6 | The CLI returns the **same tasks**, not just accepts the predicate |
| MSL-8 | `labels.yaml` still parses as a whole |
| CMT-2 | Reloading shows the comment (only the failure path checks disk) |
| CMT-5 | Say "verified by re-reading the comments file" |
| REL-13 | Compare other edges' `rank` before/after |
| NEW-11 | Cleared fields are **absent from the second task's frontmatter** |
| VUE-14 | Assert specific params; cold load returns the same rows |
| A11Y-28 | The atomic write landed (pair with BRD-9's disk check) |

**Weak flows** (where the sweep should be mechanical): flow-list,
flow-bulk export, flow-board, flow-timeline, flow-settings. **Already
rigorous:** flow-tasks, flow-relationships, flow-git-sync,
flow-task-create.

### 0i. B8 — three sites emit unparseable list syntax — ✅ DONE (`36c8872`)
**Blocked by:** nothing. **Size:** small. **This is a live 500, not future work.**

**Outcome:** all three sites emit `(...)`. Four tests asserted the broken
output and were corrected; each generator now also parses its own output
through the real tokenizer, and a route test covers the multi-value
request end to end. A fourth site — `builtinFilters.test.ts` — was not in
the original list and also had to change.

`buildStructuredQuery` (`apps/web/src/server/server.ts:449`) is called from
**two live route handlers** (`:1571`, `:1640`). Single-value params use
`=` and work; multi-value emit `in [...]`, and the tokenizer has no `[`
token (`ONE_CHAR_OPS`, `query/tokenizer.ts:53-61`, lists only
`= < > ~ ( ) ,`; `parser.ts:174` `parseList()` expects `LPAREN`).

**`GET /api/tasks?status=todo,in_progress` returns 500 today.** The
single-value path is what tests exercise, which is why it survived.

**DECIDED — all three sites move to `(...)`:**
- `apps/web/src/server/server.ts:449`
- `apps/web/src/client/list/buildDsl.ts:39`
- `apps/web/src/client/sidebar/builtinFilters.ts:54,112`

Also fix `buildDsl.test.ts:26` and `FilterBar.test.tsx:122`, which assert
the broken output — **they will turn red, which is the point.**

Three independent sites chose brackets, so someone's mental model of the
grammar says `[...]`. Settling on parens once, in one commit, prevents the
fix landing three times in three shapes.

**Consequence:** M1.1's claim that "5 built-ins are fully live" is false —
all five resolvers include `status.category not in [completed, discarded]`,
so count badges and click-through both error at runtime.

### 0j. `TEMP-WEB-TICKETS.md` — verification results
**Blocked by:** nothing. **Size:** trivial.

**No phantom ✅.** Every ticked item has real code behind it — the CW-17
failure did not repeat. The drift is a different shape: **built but
broken.**

**DECIDED — add a ⚠️ "built but defective" mark.** The legend defines 🔵
but every ticket is ✅ or ⬜, and that binary is exactly what let
"built but broken" hide. With ⚠️, **✅ means built and working**, which is
what a reader assumes it means.

| Ticket | Was | Becomes | Why |
|---|---|---|---|
| M1.1 | ✅ | ⚠️ | "5 built-ins fully live" is false — all five error on B8 |
| M1.2 | ✅ | ⚠️ | Its own data path has the B8 defect (`server.ts:449`) |
| M1.3 | ⬜ | ⚠️ | All six bullets implemented, but B8 + `POST /api/views` does not validate the query (`server.ts:735-741`), so bad views persist silently |

**Stack section drift:** TipTap, CodeMirror 6 and Playwright are all
listed as stack — **none is installed**, none appears in code. Four
milestone review gates have `**E2E**` bullets depending on Playwright.
Check what root `package.json`'s `test:e2e` actually runs before M1's gate
relies on it.

**Obsoleted by later decisions:** the migration lines (tracker 114-116 and
342-346, plus the stale comment at `contracts/service.ts:119`) — migration
is no longer CLI-only. M4.5's acceptance criteria are pinned to the
`relationship.*` grammar being redesigned in item 0.

### 0k. UI principle rulings
**Blocked by:** nothing. **Size:** small (README + case edits).

**P1 — optimistic rendering is allowed, but must be visually distinct and
must not survive a reload.** BRD-48, TML-44 and BRD-43 permit "tentative"
rendering without requiring the visual distinction, so as written they
also pass when unsaved state is shown as if saved — the actual P1
violation. Amend all three: unsaved state renders visibly pending, and a
reload shows server truth. Keeps drag responsive without letting the
browser present its own state as fact.

**P7 — stands as written, no carve-out.** All configuration drift is
surfaced with a visible explanation, **including per-user preference
drift**. A pinned view deleted from `queries.yaml` tells the user it was
removed rather than vanishing silently.

This resolves the SHL-32 / SET-13 / SET-27 / XS-28 four-way in favour of
the explaining cases: **SHL-32 (silent) is wrong** and gets corrected;
**PRU-14 and NEW-16**, which assert preference drift is silently dropped,
also contradict P7 and need correcting. One rule, no exceptions.

### 0l. 15 UI contradictions — ✅ ALL RESOLVED
**Blocked by:** nothing. **Size:** small (doc edits) + two spawned items.

Reviewed one by one. Evidence in
`scratchpad/ui-contradictions-sweep.md`.

**A correction on method.** I first presented N1/N4/N6 as "settled by
code". That conflated *what is true today* with *what is right*. Re-judged
on merit, two of the three flipped:

| # | Contradiction | Resolution |
|---|---|---|
| **N1** | `.schema-version` missing: SHL-34 vs XS-33 vs SET-30 | **SHL-34.** Banner + `loctt migrate`, never reinitialize — a `.loctt/` holding tasks but no version file is *damaged*, not empty, and routing it to an init wizard risks destroying data. **The code is wrong** → item 0n. |
| **N2** | Four schema kinds or five | **Five**: `missing`, `future`, `outdated`, `unknown`, + the sentinel (a blocking screen, not a banner kind). Fix §C.1's heading, A11Y-32's count, repoint ERR-32 at SHL-34–38. |
| **N3** | Selection after a bulk op | **Clear on full success; retain the failed subset otherwise.** `BulkResult` splits `succeeded`/`failed` precisely because partial success is normal. BLK-12/BLK-39 get the qualifier; BLK-48 reworded to be about *reapplying* a stale selection. |
| **N4** | Outdated tracker browsable or gated | **Neither doc was right.** `server.ts:2089` 409s *every* `/api/` route on mismatch. Spec: shell and nav render, banner always visible, every data request 409s as an explained error. Rewrite SHL-13 and XS-34/35. |
| **N5** | Does `c` open create | **`n` only.** Drop `c` from A11Y-1 and A11Y-11. One binding, one action. |
| **N6** | `name`+`id` vs `label`+`key` | **`{id, name}`.** Not merely what the code does: MSL/SPR build real behaviour on id-identity (non-uniqueness, reference counts, remaps) while the other side is status/priority boilerplate. **BLK-8's "writes the config `key`" would produce wrong frontmatter.** |
| **N7** | Project column vs `list_columns` | **Scope-driven exception.** Shown/hidden by active project scope regardless of `list_columns`; the stored setting is never mutated. Explicit carve-out added to LST-6 and LST-2. |
| **N8** | Back from `/list` | Add "while in-app history remains" to SHL-15, matching LST-11. Behaviours already compatible; only the wording was over-broad. |
| **N9** | "Load more" vs numbered pages | **Append (LST-13).** Rewrite BLK-19: after Load more the header checkbox governs all 100 loaded rows, indeterminate at 50/100. Keep LST-30 as URL-robustness, not a UI affordance. |
| **N10** | Body-editor pre-fetch | **Conditional write** — one PUT carrying its base version, rejected server-side on mismatch. Satisfies XS-13, keeps TSK-15's "one save fires" literally true, and has no GET→PUT race window. |
| **N11** | WIP over-cap indicator | Add A11Y-30's warning-glyph requirement to BRD-6; "colour/weight" alone is a weak non-colour carrier. |
| **N12** | Zero-count badge | Drop "or is suppressed by a stated rule" from VUE-1 — no such rule exists anywhere, and it makes SHL-7 and ONB-9 untestable. |
| **N13** | Inline label colour | Inline creation assigns a colour automatically (deterministic from the name). Otherwise MSL-22's drift surface fires on the app's own writes. |
| **N14** | Symmetric relationship config | **`kind: "symmetric"`** is a real discriminator with a `superRefine` enforcing it. REL-3 right; SET-5's checkbox and SET-4's flag list wrong — the latter is rewritten by 0c anyway. |
| **N15** | Bulk-archive Undo durability | Add A11Y-36's durable-fallback requirement to BLK-10. The fallback already exists (TSK-23/LST-12); only the assertion was missing. |

**Fallout still to apply:** CMT-5 inherits CMT-4's ownership premise and
under-specifies the edited marker; SET-4 uses SET-3's read-only "mirror"
vocabulary and needs an editability bullet.

### 0n. SchemaBanner mishandles the `missing` kind
**Blocked by:** nothing. **Size:** small. **Spawned by 0l/N1.**

`SchemaBanner.tsx:22` returns `null` for `missing`, so the case at `:74` is
**unreachable dead code**. Its docstring says missing "means an
uninitialized tracker, which the bootstrap routes to the init wizard" —
but `/init` is `<Stub name="/init" />` (`router/index.tsx:74`), so nothing
routes anywhere.

Per N1, `missing` on a `.loctt/` that holds tasks is a *damaged* tracker.
It must show SHL-34's banner pointing at `loctt migrate`, and must not
offer reinitialize.

- Remove `missing` from the early return so `:74` becomes live
- Correct the docstring
- Confirm no `/init` redirect exists for this state

### 0o. Pre-existing dependency vulnerabilities
**Blocked by:** nothing. **Size:** unknown until triaged.

`npm audit` in `apps/web` reports 8 (1 low, 5 high, 2 critical) — all in
`concurrently`/`shell-quote`, `sharp`, `vite`, `postcss`, `esbuild`,
`undici`. **None from TipTap**, which was installed clean. Noted so the
count is not mistaken for fallout from this session.

### 1. `TaskResponse` carries resolved relationships
**Blocked by:** nothing. **Blocks:** B14, and the UI relationships panel.
`handleGetTask` builds the full show model — including `resolveRelationships`,
which resolves targets to current keys and flags missing ones — then
discards it. `TaskResponse` (`contracts/service.ts:97-107`) has no
relationships field, so the documented Relationships panel is unbuildable.

### 2. CW-4 — bulk operations
**Blocked by:** nothing. **Size:** large.
Core has `bulkSetFields` and `bulkArchive` only, and **no HTTP bulk route
exists at all** (`grep -c bulk apps/web/src/server/server.ts` → 0), so even
those reach no surface. Decided: build in full.
- Core: `bulkLink`, `bulkUnsetField`
- HTTP: bulk routes for all bulk ops
- CLI: `loctt set T-1,T-2 status done` comma-ref syntax
- MCP: `bulk_update_tasks`
- All must return the per-task `succeeded`/`failed` split and share one
  `bulk_op_id` (which *does* have a producer — `task/bulk.ts:95`,
  `task/move.ts:139`; the earlier claim that it had none was wrong).

### 3. C1 — migration reachable from UI and MCP
**Blocked by:** nothing. **Size:** medium.
Decided: no longer CLI-only.
- `POST /api/migrate` + `MigrateResponse` contract + `useMigrate` hook
- Wire the schema banner's "Migrate now" button for the `outdated` kind
- **Preview then confirm**: show `planMigration()` output — what changes,
  how many files, backup location — before running
- Add an MCP migrate tool (none exists today)
- Update the now-wrong "migration is CLI-only" comment at
  `packages/contracts/src/service.ts:117-119`

### 4. D2 — global search
**Blocked by:** nothing for the API half; the header box needs the shell.
Decided: build now, not milestone-gated. `text ~ q` DSL, no full-text
index. The app-shell header spec currently has no search affordance.

### 5. B5 — lossy-content guardrail
**Blocked by:** nothing. **Size:** medium. **This is a data-loss risk.**
Spec already exists at `docs/dev/markdown-extensions.md` §Lossy-content
guardrail; never implemented. TipTap drops any node not in its registered
schema, so opening a task containing unregistered constructs in WYSIWYG
and saving silently loses them.
- Build custom TipTap nodes for LocTT's own extensions — KaTeX (`$x$`,
  `$$block$$`), `^sup^`, `~sub~`, mentions, `![[attachments/x]]` — so those
  stay visually editable
- Footnotes and unregistered raw HTML trigger detect → warn → force source
  mode
- Tables need no fallback; `@tiptap/extension-table` handles them

### 6. SV-3 — saved-view basic mode covers all DSL fields
**Blocked by:** the view editor UI (not built). **Unblocked technically** —
its dependency was the `relationship.<type>` evaluator bug, now fixed.
Chip builder covers every queryable field including custom fields and
`relationship.*`.

### 7. SV-2, SV-4, B14 — UI-dependent
**Blocked by:** views that do not exist. `/board`, `/timeline`,
`/tasks/$key`, `/settings/$section` are registered routes rendering stubs.
- **SV-2**: editor reachable from list/board/timeline filter bars,
  sidebar, view pickers, Settings. Decided: **all** entry points, and
  remove endpoints/UI this obsoletes rather than leaving them dangling.
- **SV-4**: sort rows inline below filter rows, drag-reorderable.
- **B14**: relationship rows show each target's live status. Needs item 1
  first.

### 8. Mention parsing
**Blocked by:** nothing. `markdown-extensions.md:33` specifies
`@user:<uuid>`; `MENTION_RE` (`task/comments.ts:51`) is `/@([\w\-.]+)/g` —
no `:`, so every mention collapses to the literal token `user`, which is
then stored as if it were a user id. Also fires inside email addresses and
code spans. Doc now flags this as a known gap.

### 9. Comments reach no surface
**Blocked by:** nothing. **Size:** large.
`packages/core/src/task/comments.ts` implements post/list/edit/delete with
**zero production callers** — no CLI command, no MCP tool, no HTTP route.
`docs/user/ui/features.md` describes comments as shipped and
`flow-comments-activity.md` has 38 UI cases with no backend.

### 10. Other unwired core APIs
`duplicateTask`, `moveTaskToProject`, `bulkMoveTasksToProject`,
`setFields`, `validateQuery`, `countTasksByReference`, `pushRecent` — all
exported, tested, and reachable from nothing. `GET /api/recents` reads a
list nothing writes.

### 11. Milestone progress
Does not exist anywhere in `packages` or `apps`. Ten UI cases unbacked.

---

## 3. Decisions already made

Do not relitigate these; they were settled this session.

| Key | Decision |
|---|---|
| **C1** | Migration is **not** CLI-only. UI gets a button (preview → confirm); MCP gets a tool. |
| **CW-17** | `card_layout` is an **ordered array** — position carries render order. Old boolean map rejected. **Implemented.** |
| **D17** | `editor_mode` persists per user. Schema **implemented**; UI wiring pending. |
| **B5** | Custom TipTap nodes for LocTT's own syntax; footnotes + unregistered HTML force source mode. |
| **D2** | Global search: build now. |
| **CW-4** | Build in full, including HTTP routes. |
| **SV-2** | All entry points; clean up what it obsoletes. |
| **SV-3** | All fields including custom and `relationship.*`. |
| **SV-4, D17** | Build as specified. |
| **Body save** | **Autosave** on idle + blur, 15-min coalescing — settled by the code, not opinion. `markdown-extensions.md` corrected. |
| **`relationship.type`** | ~~Reserved field names.~~ **Superseded** — the whole relationship query syntax is being redesigned (§2 item 0). The implemented `relationship.type` / `.target` may not survive. |
| **Duplicate relationships** | Two senses, both already correct in code. **Definitions**: one per key in `workflow.yaml` — a second `dependsOn` definition is rejected (`config/validation.ts:265-269`). **Edges**: a task may hold many edges of the same kind (`T-1 blocks T-2` and `T-1 blocks T-3`); only the exact `(kind, target)` pair twice is refused (`task/relationships.ts:304`). No change needed — but the definition check never runs on a write path, which is defect **B9**. |
| **Invariants** | Own doc, `docs/dev/invariants.md`, linked from CLAUDE.md. |
| **`ui/features.md`** | Stays as a spec reading as shipped. |
| **`.claude/SETUP_GUIDE.md`** | Keep — reusable scaffolding for new repos. |

**Deliberately not built** (19 items — full list in `docs/dev/decisions.md`
§1): no notifications, English only, no roles/permissions, no time
tracking, no websockets, `rebuild key index` stays CLI-only, and others.
These leave no code trace, so the doc is the only record.

---

## 4. Needs your decision

**All resolved.** Every question from the original §4 has a decision, each
recorded as a queue item in §2.

**Item 0l is now resolved too** — all 15 contradictions walked through
one at a time, each with a recorded decision. Two spawned new queue items
(0n, 0o).

**TipTap is installed** (`@tiptap/core`, `react`, `starter-kit`, and the
four table packages, all 3.30.1), unblocking item 5 (B5 lossy-content
guardrail). CodeMirror 6 and Playwright are still absent — both are still
listed as stack, and four milestone gates have E2E bullets depending on
Playwright.

---

## 5. Where the detail lives

| Doc | Contents |
|---|---|
| `FEATURE-AUDIT.md` | 20 code blockers, cross-surface parity matrix, UI readiness by flow. **One correction:** `bulk_op_id` *does* have a producer; the gap is the missing HTTP route. |
| `DOCS-AUDIT.md` | Doc duplication, false claims, stale ranges, suggested order. |
| `PROPOSED-UI-CASES.md` | Proposed changes to the 18 UI flow docs — contradictions, cases that cannot pass, 9 new cases. Nothing applied. |
| `docs/dev/decisions.md` | 46 preserved decisions: deliberately-not-built, resolved-for-build, superseded. |
| `docs/dev/invariants.md` | Rules a change must not break, with "what breaks if violated". |
| `docs/dev/surface-test-cases/` | 65 CLI+MCP test cases, 10 files, mirroring `ui-test-cases/` filenames. |

### Pre-existing failures (not caused by this session)

Verified against a clean `b4f0fbf` worktree — these fail there too:

- `tests/integration/mcp/edges/relationships.test.ts` — "allows a non-structural cycle (blocks)"
- `tests/integration/cli/edges/relationships.test.ts` — "allows a cycle on a non-structural relationship (blocks)"
- `tests/integration/mcp/get-workflow-config.test.ts` — expects `not_started`
- `tests/e2e/06-query-and-views.test.ts` — "expected 2 to be +0"

They are in your in-flight relationship/workflow work.

# Audit — Slice 3: `packages/core/src/config/` + `packages/core/src/schema/`

Scope: 20 non-test `.ts` files, 3,145 lines. All read in full.

Verification note: findings 1, 2 and 3 were each confirmed by executing
the real code (throwaway `tsx` scripts against the real modules, deleted
afterwards). No file in the repo was edited.

---

### The fatal `.schema-migration-in-progress` sentinel is bypassed on the only path that can reach it

- **File**: `packages/core/src/schema/migrate.ts:46` (`planMigration`), `packages/core/src/schema/migrate.ts:90` (`migrateToCurrent`)
- **Category**: bug
- **What is wrong**: `invariants.md` line 45 states the sentinel is **fatal** — "refuse to boot, because completing a migration needs the backup it records." Only `requireSupportedSchema` (`migrate.ts:200-211`) checks it. But `migrate` is explicitly exempt from that guard: `apps/cli/src/runtime/schema-guard.ts` puts `"migrate"` in `SCHEMA_GUARD_EXEMPT_COMMANDS` ("`migrate` is the path that fixes a stale schema"), and `apps/cli/src/index.ts:58` skips `requireSupportedSchema` for exempt commands. Neither `planMigration` nor `migrateToCurrent` performs its own sentinel check, so on the one command that can still run against a sentinel-bearing tracker, the sentinel has no effect at all.

  Verified by execution: with `.schema-version` = `1` and a sentinel present, `planMigration` returned `{"from":1,"to":1,"steps":[]}` and `migrateToCurrent` returned `{"from":1,"to":1,"steps":[]}` — both success, no error. The MCP tool (`apps/mcp/src/tools/tracker.ts:117,130`) and the web route (`apps/web/src/server/server.ts:2942,2969`) call the same two functions.

  The worst shape is the one the comment at `migrate.ts:173-177` describes: a crash between `writeSchemaVersion` and `rm` leaves a version that already equals `CURRENT_SCHEMA_VERSION` plus an orphan sentinel. That comment asserts "requireSupportedSchema treats the sentinel as authoritative and refuses to boot" — true for other commands, but `migrate` itself hits the `recorded === CURRENT_SCHEMA_VERSION` fast path at `migrate.ts:104` and reports "Schema is already at vN. Nothing to do." The user is told everything is fine while the tracker is in the exact state the invariant says must block.
- **Why it matters**: Direct violation of a documented invariant, on the recovery path specifically. The invariant's own rationale — "A sentinel nothing acts on is worse than none: it records that the tracker is inconsistent and then lets every command run against it anyway" — describes this code. A user whose migration crashed runs `loctt migrate` (the thing every other command's error message tells them to run), is told "nothing to do", and proceeds against a half-migrated tracker whose backup they now have no reason to keep.
- **Blast radius**: `apps/cli/src/commands/migrate.ts`, `appsts/mcp/src/tools/tracker.ts:117,130`, `apps/web/src/server/server.ts:2942,2969`. Any fix changes an error path on a public core export, so it is high-risk despite being a small edit.
- **Size**: S
- **Auto-fixable**: no — it is a behaviour change (a currently-succeeding call must start throwing), and the right shape is a decision: fail outright, or add an explicit `--force`/recovery flow that consumes the backup the sentinel records. That choice belongs to the user.
- **Confidence**: high

### `validateWorkflowConfig` checks only duplicates — every cross-reference in `workflow.yaml` is unvalidated

- **File**: `packages/core/src/config/validation.ts:235-284`
- **Category**: bug
- **What is wrong**: The doc comment claims it checks "duplicate keys, inverse relationship symmetry, etc." It checks duplicate keys in five collections and nothing else. There is no inverse-symmetry check in the function at all. Zod cannot cover these either: `RelationshipDefSchema.superRefine` (`packages/contracts/src/workflow.ts:138-177`) sees one relationship at a time, and `WorkflowConfigSchema.superRefine` (`workflow.ts:438`) only counts default statuses.

  Concretely unvalidated, all confirmed to pass both the schema and `validateWorkflowConfig` with zero errors in a single executed case:
  1. **`boards.columns[].statuses` referencing a status that does not exist.** `BoardsConfigSchema` (`workflow.ts:365`) checks column-key uniqueness and cross-column status uniqueness, but never that a listed status is declared in `config.statuses`. A board column pointing at a deleted status renders permanently empty with no diagnostic.
  2. **A relationship `key` colliding with another relationship's `inverse`.** `relationshipTypeKeys` (`workflow.ts:212`) flattens both into one namespace used by link acceptance and traversal; a collision makes the type token ambiguous. Verified: `blocks`(inverse `rel`) + `rel`(inverse `blocks`) passes clean.
  3. **Duplicate `priority.value`.** See the next finding.
  4. **Duplicate `custom_fields[].values[].key`** within one enum field — the duplicate check at `validation.ts:276` covers field keys, not the value keys nested inside them.
- **Why it matters**: `workflow.ts:19-30` documents the intended contract: cross-entry rules live in `validateWorkflowConfig` precisely because Zod cannot see siblings, and `saveWorkflowConfig` (`workflow-write.ts:99`) calls it so invalid config is rejected rather than persisted. That design is correct; the function is just mostly empty, so `saveWorkflowConfig` and `loctt doctor` (`diagnostics/doctor.ts:79`) both under-report. The gap is invisible — the call sites look like they are enforcing something.
- **Blast radius**: `workflow-write.ts:99` (write rejection), `diagnostics/doctor.ts:79` (reporting). Adding checks makes previously-accepted configs fail to save, so it is a behaviour change on a write path.
- **Size**: M
- **Auto-fixable**: no — new rejections are a behaviour change; and the doc-comment/implementation mismatch should be resolved by deciding which is right, not by silently editing the comment.
- **Confidence**: high

### Priority `value` is never recomputed as 1..N and duplicates are accepted (invariant D20)

- **File**: `packages/core/src/config/workflow-write.ts:732-739` (`serializePriority`), `packages/core/src/config/validation.ts:248-254`
- **Category**: bug
- **What is wrong**: D20 requires drag-reorder to recompute `value` as 1..N, because `value` is what `order by priority` sorts on. `PriorityDefSchema` (`packages/contracts/src/workflow.ts:61-67`) has `value: z.number().optional()` — no integer constraint, no positivity constraint, no range constraint. `serializePriority` writes whatever `value` it is handed straight through. `validateWorkflowConfig` does not check `value` at all: two priorities with `value: 5` pass clean (verified by execution). A grep across `packages/core/src`, `apps/cli/src`, `apps/mcp/src` and `apps/web/src` finds no recomputation logic anywhere.

  The reorder UI that would own the recompute does not exist yet, so this is a latent gap rather than a live corruption — but the config layer, which is where the on-disk shape is defined, has no floor under it. Nothing prevents a hand-edited or programmatically-written config from carrying duplicate, zero, negative, fractional, or sparse values, and `order by priority` silently produces an arbitrary order for the ties.

  On the good side of D20: `value` is correctly kept out of display. `serializePriority` emits it only when defined, and the invariant's "never displayed" half holds in this slice.
- **Why it matters**: The sorting half of a documented invariant has no enforcement in the layer that defines the on-disk shape. When the reorder UI lands it will be written against a schema that permits the exact states the invariant forbids, and the resulting wrong sort order is silent.
- **Blast radius**: `PriorityDefSchema` in contracts (a schema change is on-disk shape — high risk), `validateWorkflowConfig`, the query engine's `order by priority`, and the future reorder UI.
- **Size**: M
- **Auto-fixable**: no — tightening the schema rejects configs that load today.
- **Confidence**: high

### `parseWorkflowConfig` is the only config parser that skips `coerceYaml`

- **File**: `packages/core/src/config/workflow.ts:32`
- **Category**: bug
- **What is wrong**: Six of seven config parsers run `coerceYaml(safeParseYaml(...))` — `milestones.ts:29`, `sprints.ts:29`, `calendar.ts:29`, `list-view.ts:30`. `workflow.ts:32`, `projects.ts:34`, `queries.ts:27` call `safeParseYaml` alone. For projects and queries that is arguably harmless (neither carries a date field today). For `workflow.yaml` it is a latent trap: `coerceYaml` exists to turn YAML-parsed `Date` objects back into `YYYY-MM-DD` strings, and the YAML parser produces a `Date` for an unquoted `2026-01-01` depending on stringifier flavour. Any date-shaped scalar reaching `workflow.yaml` — a `custom_fields[].values[].key` that looks like a date, or a future date-typed config field — would arrive as a `Date` and fail Zod with a confusing "expected string" against a value that reads as a perfectly good string in the file.
- **Why it matters**: The inconsistency is undocumented, so the next person adding a date-ish field to `workflow.yaml` inherits a bug with no signpost. The asymmetry looks accidental rather than considered.
- **Blast radius**: `loadWorkflowConfig` → every surface. Adding `coerceYaml` widens what parses successfully (a `Date` that previously threw would now be accepted), so it is not a pure no-op.
- **Size**: S
- **Auto-fixable**: no — it changes what inputs are accepted. If the omission is deliberate, it needs a comment saying so.
- **Confidence**: medium — the trigger requires a date-shaped scalar in `workflow.yaml`, which no current field naturally produces.

### `loadArchivedGuardConfigs` documents "best-effort" but two of its five loads throw

- **File**: `packages/core/src/config/archived-guard.ts:44-62`
- **Category**: bug
- **What is wrong**: The doc comment says "Missing config slices are treated as 'nothing to block against' rather than as errors — a fresh tracker hasn't created the sibling configs yet, but should still be able to create tasks." Labels, milestones and sprints are each wrapped in `try/catch` (lines 51-53). `loadProjectsConfig` (line 47) and `loadAllUsers` (line 54) are not. `loadProjectsConfig` calls `readFile` unguarded (`projects.ts:62`) and throws ENOENT when the file is absent, so the stated fresh-tracker guarantee does not hold for the two unguarded slices.

  This may well be deliberate — `projects.yaml` is required (`ProjectsConfigSchema` enforces at-least-one project per `architecture.md`), so failing loudly is defensible. But the comment directly above states the opposite policy, and the comment is what the next reader will believe.
- **Why it matters**: The function is described as the central place where "CLI/MCP/HTTP all enforce identical policy". Whichever behaviour is right, the comment and the code disagree, so callers cannot know from reading it whether this throws.
- **Blast radius**: every task create/update path across all three surfaces.
- **Size**: S
- **Auto-fixable**: no — resolving it requires deciding which of the two is correct.
- **Confidence**: high (the mismatch is certain; which side is wrong is the open question)

### `unset git.enabled` diverges from every other key's unset semantics

- **File**: `packages/core/src/config/router.ts:56-59`, `router.ts:191-206`
- **Category**: bug
- **What is wrong**: For a normal key, `unsetConfigValue` writes `defaultFor(key)` into sync.yaml (line 201-203). For `git.enabled`, the custom handler's `unset` calls `disableGit(ctx.locttDir)` — a real side-effecting teardown, not a value reset. The comment claims this is "symmetric with set(false)", which is accurate, but `set(false)` is itself the odd one: unsetting every other key edits a field, while unsetting this one tears down git mode.

  Compounding it, `requireSyncState` (line 108) throws "git mode is not enabled; run 'loctt git enable' first" when sync.yaml is absent — so `unset git.branch` on a tracker without git mode errors, while `get git.branch` deliberately returns the default and never errors (line 160). Three different absent-file policies across get/set/unset in one 207-line module.
- **Why it matters**: `unset` reads as "revert to default" everywhere else in the CLI surface. Here it destroys configuration state. A user clearing a stale setting can disable git mode without intending to.
- **Blast radius**: CLI `config unset` command and any web/MCP surface routing through `unsetConfigValue`.
- **Size**: S
- **Auto-fixable**: no — behaviour change on a destructive path.
- **Confidence**: medium — this may be an intentional call; I found no decision record covering it either way, and `decisions.md` does not list it under "deliberately not built".

### Every config module duplicates its serializer's object literal inside `save*`

- **File**: `packages/core/src/config/projects.ts:66-81`, `labels.ts:63-77`, `milestones.ts:61-74`, `sprints.ts:64-80`, `calendar.ts:77-88`
- **Category**: duplication
- **What is wrong**: Five modules follow an identical shape: `serializeXConfig` builds a plain object and stringifies it; `saveXConfig` then re-parses that string for validation and **re-builds the same object literal by hand** to pass to `writeYamlAtomically`. The field lists are written twice, character for character, in each of the five files.

  `queries.ts` shows this is collapsible without losing anything: it factors the literal into `serializeSavedQuery` and both call sites use it (`queries.ts:98` and `queries.ts:108`). The other five never took that step. The round-trip-through-parse is load-bearing (it is how caller-side invariants get enforced before a write) and must stay — only the second hand-written literal is redundant.

  This is the concrete cost: a field added to `serializeSprintsConfig` but not to `saveSprintsConfig`'s literal would be silently dropped on every write, and the round-trip validation would not catch it because the dropped field is optional in the schema. The two lists are only in sync today because nobody has touched them since they were written.
- **Why it matters**: Five independent chances for a silent field-drop on the write path, in the code that defines the on-disk shape. The fix (use the already-validated object, as `queries.ts` does) removes the failure mode rather than just shortening the file.
- **Blast radius**: all five config write paths. Behaviour-preserving if done exactly as `queries.ts` does it, but it touches on-disk output, so it needs round-trip tests per file.
- **Size**: M
- **Auto-fixable**: no — mechanical, but it rewrites five on-disk write paths; per the slice constraints, anything touching on-disk shape is high-risk regardless of edit size.
- **Confidence**: high

### `validateRemapCoversDeletions` inlines the relationship case rather than generalising

- **File**: `packages/core/src/config/workflow-write.ts:191-220`
- **Category**: abstraction
- **What is wrong**: The comment explains the duplication honestly: `checkSimple` is parameterised over a `SimpleCollection` string union, and relationships do not fit because their defs are objects with a `.key` rather than bare keys. So ~30 lines are copied to keep error-message wording aligned. The root cause is that `checkSimple` takes a *collection name* to look up `remap[name]`, rather than taking the remap table directly — passing `remap.relationships` and a label string would let all four collections share one implementation.
- **Why it matters**: Four collections, three sharing one code path and one on a copy. The wording alignment the comment cares about is maintained by hand, so a message improvement in `checkSimple` silently skips relationships.
- **Blast radius**: `applyWorkflowEdit` validation only. Error-message text is a user-visible contract, so a refactor must hold the strings exactly.
- **Size**: S
- **Auto-fixable**: no — touches error-message text.
- **Confidence**: high

### `loadOptionalConfigs` swallows the reason a config failed to load

- **File**: `packages/core/src/config/index.ts:113-131`
- **Category**: abstraction
- **What is wrong**: Three bare `catch { /* ok */ }` blocks discard the error entirely. A `workflow.yaml` with a typo and a `workflow.yaml` that is absent are indistinguishable to every caller — both yield `workflowConfig: undefined`. The whole `zod-error.ts` module (173 lines) exists to produce path-naming messages like `statuses[0].key must be a non-empty string`; on this path those messages are constructed and then thrown away.

  Callers then degrade silently: `apps/mcp/src/tools/task-links.ts:26,49` and three routes in `apps/web/src/server/server.ts` (2092, 2183, 2217) proceed with `workflowConfig === undefined`, which disables relationship-type validation rather than reporting a broken config.
- **Why it matters**: This is the audit brief's question — does a malformed config name its path, or produce a confusing downstream failure? The parse layer does name the path, and this function is where that gets lost. The user sees relationship validation quietly stop working, with no way to learn their config has a typo short of running `doctor`.
- **Blast radius**: five call sites across MCP and web. Surfacing the errors changes behaviour on request paths; returning them alongside the configs (leaving the decision to callers) would not.
- **Size**: M
- **Auto-fixable**: no — behaviour change on live request paths.
- **Confidence**: high

### `parseConfigValue` is exported but reachable only through `setConfigValue`

- **File**: `packages/core/src/config/router.ts:83`
- **Category**: dead-code
- **What is wrong**: `parseConfigValue` is `export`ed from `router.ts`, but `config/index.ts:58-67` does not re-export it, and it is not in `packages/core/src/index.ts`'s export list. Its only caller is `setConfigValue` on line 175, in the same file. The `export` keyword is inert — it is package-private in effect.
- **Why it matters**: Minor, but an exported symbol reads as part of the module's surface and invites callers that the barrel file cannot actually serve.
- **Blast radius**: none — nothing outside the file references it.
- **Size**: S
- **Auto-fixable**: yes — dropping the `export` keyword is provably safe (no importer exists inside or outside the package). Tagged `auto-fixable`; **not applied**, per this run's report-only constraint.
- **Confidence**: high

### `makeJournalEntryId` is a single-line wrapper around `ulid()`

- **File**: `packages/core/src/config/workflow-write.ts:672-674`
- **Category**: abstraction
- **What is wrong**: A named function whose entire body is `return ulid();`, with a six-line comment explaining that it is plain `ulid()` and why. The comment carries all the value; the indirection carries none.
- **Why it matters**: Trivial. Noted only because the comment does the explaining a name was presumably meant to do, so the function is pure overhead at its one call site (line 577).
- **Blast radius**: one call site, file-local.
- **Size**: S
- **Auto-fixable**: yes — inline it and keep the comment. **Not applied**, per this run's constraint.
- **Confidence**: high

### Migration-ordering guard is unreachable as written

- **File**: `packages/core/src/schema/migrate.ts:152-158`
- **Category**: dead-code
- **What is wrong**: The loop checks `if (migration.from !== current)` and throws "migration ordering invariant violated". `findMigrationPath` builds the path by only following edges where `m.from === node.version` (`migrations.ts:92`), so every returned path is contiguous by construction. The check cannot fire for any path that function produces.
- **Why it matters**: Not a defect — it is a defensive assertion against a future `findMigrationPath` bug, and the comment says exactly that ("Defensive"). Recorded so it is not mistaken for reachable logic, and because `MIGRATIONS` is currently empty (`migrations.ts:46-49`), meaning the entire loop is untested against real data.
- **Blast radius**: none.
- **Size**: S
- **Auto-fixable**: no — deliberate defensive code; leave it.
- **Confidence**: high

---

## Files read completely

All 20 non-test files in the slice, in full:

`config/`: `archived-guard.ts`, `calendar.ts`, `index.ts`, `labels.ts`, `list-view.ts`, `milestones.ts`, `projects.ts`, `queries.ts`, `router.ts`, `sprints.ts`, `validation.ts`, `workflow.ts`, `workflow-write.ts`, `yaml-coerce.ts`, `zod-error.ts`

`schema/`: `index.ts`, `lock.ts`, `migrate.ts`, `migrations.ts`, `version.ts`

Files read partially, for context only (outside the slice, consulted to verify findings): `packages/contracts/src/workflow.ts`, `apps/cli/src/index.ts`, `apps/cli/src/runtime/schema-guard.ts`, `apps/cli/src/commands/migrate.ts`, `packages/core/src/state/lock.ts`.

## Clean files

Explicitly clean, no findings:

- **`config/yaml-coerce.ts`** — small, correct, well-documented. The `Date`→string coercion and the error-wrapping split are both right.
- **`config/zod-error.ts`** — the strongest file in the slice. The `REMOVED_FIELD_HINTS` mechanism (naming the replacement for a removed field, since `.strict()` rejects before any `superRefine` can explain itself) is a genuinely good idea, and the rationale for translating Zod's messages rather than passing them through is sound.
- **`config/list-view.ts`** — the prune semantics (empty array collapses to absent, not `visible: []`) are subtle and the comment explains exactly why.
- **`schema/lock.ts`** — correct ENOENT-vs-real-error discrimination in `isMigrationLocked`; notably does not swallow EACCES/EIO as "unlocked".
- **`schema/migrations.ts`** — BFS with the deprecated-edge tiebreak is correct and matches `architecture.md:78`.
- **`schema/version.ts`** — the random suffix on backup paths (guarding the 1-second ISO timestamp collision) is the right call and is explained.
- **`config/index.ts`** — clean apart from finding 9.
- **`config/labels.ts`**, **`config/milestones.ts`**, **`config/sprints.ts`**, **`config/calendar.ts`**, **`config/projects.ts`** — clean apart from the shared duplication in finding 7.

## Invariants checked and found intact

- **Stored enum values are config keys, never labels.** Traced every write path in the slice: `serializeStatus`/`serializePriority`/`serializeTaskType`/`serializeCustomField` (`workflow-write.ts:719-780`) all emit `key` and `label` as separate fields; `computeWorkflowKeyUsage` (`workflow-write.ts:281`) reads `frontmatter.status`/`priority`/`task_type` and the `values[].key` set; `applyScalarRemap` and `applyCustomFieldsRemap` compare and write against key sets only. No label reaches stored data or a remap target anywhere in this slice.
- **D20, "`value` is never displayed"** — holds; `value` is serialized only, never formatted for output in this slice. (The 1..N recomputation half is finding 3.)
- **P-1, "there is no slug"** — `serializeProjectsConfig` (`projects.ts:47`) emits exactly `{id, name, prefix, archived?}`. No slug field anywhere in the slice.

# LocTT — Review Fix Plan

Generated from a full codebase review (2026-05-12). This document tracks the implementation of ~60 issues across `packages/core`, `apps/cli`, `apps/mcp`, `apps/web`, `packages/contracts`, docs, and tests.

**Working principles (per user):**

- No quick fixes / no workarounds. If half-validation is present, make it robust.
- Build + test gate (`npm run typecheck && npm test`) after each commit.
- Commit logical chunks, not one giant diff.
- `TEMP-IMPLEMENTATION-PLAN.md` and `temp-ui-mockups/` must NOT be deleted — user still uses them.
- Commit messages: no AI/Claude attribution, written as a human would.

**Baseline (2026-05-12):** typecheck clean, 1036 tests pass.

---

## Status

| Phase | Status | Notes |
|---|---|---|
| 1. Critical (3) + concurrency (4) + error narrowing (3) | **DONE** | 11 commits, all gates green. setField/unsetField also got locked (was implicit in 1.4b) |
| 2. API contracts + CLI/MCP alignment (delete verb rename) | **DONE** | 12 items; 2.12 confirmed false-positive |
| 3. Docs + minor batch | **DONE** | Items 25-52 landed in 10+ commits; a few were false positives |
| 4. Structural splits + per-tool zod + test additions | TODO | Highest churn, lowest correctness value — pacing carefully |

Update the table above as phases complete. Within a phase, tick items as they land.

---

## Decisions already locked in (do NOT re-ask user)

1. **Cycle detection (Critical #2):** the existing check exists to *block writes that would create a cycle*, not to protect output traversal. Fix the inverse-key bypass + add a `loctt doctor` check that scans for cycles already on disk (non-destructive report; user breaks them manually).
2. **Key-index freshness (Critical #1):** **lazy fold-on-miss, no freshness signal.** The index is treated as a cache that LocTT itself keeps current; out-of-band edits are handled via `loctt doctor --rebuild-index`. Rationale:
   - LocTT's own code only rewrites `key` in one place: `git/reconcile.ts:rekeyCollisions` during sync. MCP / CLI / web all reject `key` and `key_history` as immutable. So out-of-band drift is the only stale-index case, and it falls under the existing "trust the filesystem, doctor repairs" model.
   - Drops the digest entirely. No stat-per-task on lookups. No mtime/granularity edge cases.
   - On miss: `readdir(tasks/)`, take set-difference with indexed IDs, read the unknowns, fold their `key` + `key_history` into the index, persist, retry. Cost is proportional to *new* tasks, not total.
   - On indexed hit that reads ENOENT (concurrent delete by another process): drop the dangling entry, persist, fall through to fold-then-retry.
   - On read errors other than ENOENT: rethrow.
   - **New CLI/MCP command:** `loctt doctor --rebuild-index` for the explicit "I hand-edited frontmatter, repair the cache" path. Default `loctt doctor` also runs an index-integrity check (verify every indexed entry's target task.md exists and its current key or key_history contains the indexed key) and reports drift.
   - **Doc update:** add to `docs/dev/architecture.md` and `docs/user/cli/reference.md`: out-of-band edits to `key` / `key_history` require `loctt doctor` to repair the lookup cache.
3. **MCP outer catch:** whitelist domain errors; rethrow others so the framework can log them.
4. **Frontmatter to API:** `TaskFrontmatterPublicSchema` in contracts, strict allowlist of known top-level keys + the typed `custom_fields` map. Disk parsing keeps `.passthrough()` so manually-added top-level keys survive a write round-trip; API responses project through the public schema.
5. **CLI vs MCP delete/archive:** **align both surfaces** to two distinct verbs.
   - `loctt delete <task> --yes` = hard remove (CLI loses `--hard` flag).
   - `loctt archive <task>` = soft (CLI's current default behavior moves here).
   - MCP unchanged (`delete_task` hard-only, `archive_task` soft).
   - Apply same pattern to `project`, `label`, `milestone`, `sprint`, `user`.
   - Breaking change for CLI muscle memory; no released versions, so acceptable.
6. **CLI/MCP structural split:** YES, do both, in Phase 4 (last).
7. **MCP arg validation:** per-tool zod schemas + `z.infer`; `parseToolArgs` returns a discriminated union.
8. **`IMMUTABLE_FIELDS`:** split into `USER_IMMUTABLE_FIELDS` + `SYSTEM_MUTABLE_VIA` map naming privileged callers.

---

## Phase 1 — Critical + Concurrency + Error Narrowing

Goal: leave the data integrity boundary correct. All `packages/core` + light touches in web/MCP. No surface changes.

### 1.1 — Critical #1: Key-index lazy fold-on-miss + doctor repair

**Files:**
- `packages/core/src/state/key-index.ts` (rewrite freshness; add fold helper)
- `packages/core/src/task/lookup.ts` (rewrite `lookupByKey` to use fold)
- `apps/cli/src/index.ts` + `apps/mcp/src/index.ts` (extend `doctor` command)
- `docs/dev/architecture.md` + `docs/user/cli/reference.md` (document the contract)

**Current bug:** `isKeyIndexFresh` compares `listTaskIds().length === index.task_count`. A balanced out-of-band swap (e.g. `git pull` rewriting two task.md files swapping their keys, or a user hand-editing frontmatter) leaves count unchanged → index reports fresh → `lookupByKey` negative-caches a real key as missing until process restart.

**Design choice:** the index is a cache that LocTT itself keeps current. LocTT's only internal rekey path is `git/reconcile.ts:rekeyCollisions`; MCP/CLI/web all reject `key` and `key_history` as immutable. So the only way the index goes stale is **out-of-band frontmatter edits**, which fall under the existing trust-the-filesystem model and are repaired via `loctt doctor`. This is consistent with how LocTT treats every other piece of state.

**Fix:**

1. **Drop the freshness signal.** `KeyIndex` becomes `{ entries: Record<string, string> }`. Remove `task_count`, `isKeyIndexFresh`, the count math in `addToKeyIndex`.

2. **`lookupByKey` becomes:**
   ```
   if hasNegativeLookup → throw
   index = loadKeyIndex()  (rebuild if undefined)
   if index has key:
     try readTask(id)
     ENOENT → drop dangling entry, persist, fall through to fold
     other error → rethrow
     success → return task
   // miss path: fold unknowns
   knownIds = set(values of index.entries)
   allIds = readdir(tasks/)
   unknownIds = allIds \ knownIds
   if unknownIds.size > 0:
     for each unknown id: read task.md, add (key, id) and each (oldKey, id) from key_history to entries
     persist index
     retry lookup once
   cache negative, throw TaskNotFoundError
   ```

3. **`addToKeyIndex(index, key, id)`** stays the simple `{ entries: { ...entries, [key]: id } }`. No digest math, no count.

4. **Rekey path:** `rekeyCollisions` (in `git/reconcile.ts`) explicitly updates the index for affected tasks. Audit that path — it may already trigger a rebuild via the lock; if not, add explicit `addToKeyIndex` calls or one rebuild at end of reconcile.

5. **`loctt doctor` extension:**
   - Default doctor pass adds an index-integrity check: for each entry, verify the target task.md exists AND its current `key` or some entry in `key_history` matches the indexed key. Report mismatches; do not auto-repair.
   - Add `loctt doctor --rebuild-index` flag (CLI) / `rebuild_index: true` param to the existing `doctor` MCP tool (or a new `rebuild_key_index` tool — decide during implementation; prefer the flag for consistency).
   - Rebuild is just `rebuildKeyIndex(locttDir)`.

6. **Document the contract:**
   - `docs/dev/architecture.md`: add a "Lookup cache" section noting the index is maintained by LocTT only; out-of-band edits to `key` / `key_history` require `loctt doctor`.
   - `docs/user/cli/reference.md`: doctor command section mentions `--rebuild-index`.

**Tests (add to `packages/core/src/task/lookup.test.ts`):**

- **Lazy fold on creation race:** seed two tasks, write a third task's directory directly (bypassing the index), call `lookupByKey` for the third's key — should succeed via fold.
- **Concurrent delete:** seed two tasks, build the index, delete one task's directory directly, call `lookupByKey` for the deleted key — should drop the dangling entry and return TaskNotFoundError.
- **Out-of-band balanced rekey-swap → doctor repairs:** seed two tasks, build index, hand-rewrite the two task.md files swapping their keys, assert `lookupByKey` returns the *wrong* result (this is the documented limitation), then run `rebuildKeyIndex` and assert lookups are correct.
- **Negative cache invalidation on write** (existing test, keep working).
- **Index file is not rewritten when a real miss happens with no new directories on disk** (existing watermark optimization test, adapt: assert the index file mtime is unchanged when fold finds nothing new — fold should short-circuit when `unknownIds` is empty without writing).

**Migration:** existing on-disk indexes have `task_count` and no `entries`-only shape. `loadKeyIndex` returns `undefined` for old-shape indexes → triggers a rebuild on next lookup. Self-healing.

**Out of scope here (already covered separately):**
- `lookupTask` ULID-fallback bare-catch narrowing → item 1.5b.
- `writeTask` cache invalidation → already correct; the new lookup path doesn't need it changed.

### 1.2 — Critical #2: Cycle detection inverse-key bypass + doctor scan

**File:** `packages/core/src/task/relationships.ts`

**Current bug:** `linkTask` accepts forward (`r.key`) and inverse (`r.inverse`) relationship keys, but the structural-cycle check only matches `r.key === type`. Calling with the inverse skips cycle detection.

**Fix:**

1. Add helper `resolveRelationshipDef(workflow, type) → { def, isInverse }`:
   - Iterates `workflow.relationships`; matches on `r.key === type` OR `r.inverse === type`.
   - Returns the canonical def + whether the input was the inverse.
2. In `linkTask`, after resolving:
   - If `isInverse`, swap source/target before the cycle walk.
   - Walk uses `def.key` (canonical direction).
3. Narrow the cycle-path catch from bare `catch` to `catch (err) { if (err instanceof TaskNotFoundError) ...; else rethrow }`.
4. Replace the `MAX_VISITS = 1000` silent "no cycle" return with `throw new Error("relationship graph too large to verify cycles")`.

**Doctor scan (new):**

- New function in `packages/core/src/doctor/cycles.ts` (or extend existing doctor module): `findExistingCycles(locttDir, workflow) → CycleReport[]`.
- For each task, for each structural relationship, walk the graph and collect any cycles found.
- Report shape: `{ relationshipKey, cyclePath: TaskKey[] }`.
- Wire into the existing `loctt doctor` CLI command and `doctor` MCP tool. Non-destructive — just reports.

**Tests:**
- `relationships.test.ts`: cycle detection via inverse key (currently passes; should fail without fix). Multiple inverse hops. `MAX_VISITS` overflow throws.
- New `doctor/cycles.test.ts`: doctor reports an existing cycle, doesn't auto-repair.

### 1.3 — Critical #3: Atomic schema sentinel write

**File:** `packages/core/src/schema/migrate.ts:146-150`

**Current bug:** sentinel written with `writeFile` (not atomic). Crash mid-write leaves truncated sentinel that still trips `requireSupportedSchema`, but recovery instructions are unreadable.

**Fix:** import `writeFileAtomically` from `utils/fs.ts` (or `atomic-yaml.ts` for the YAML variant — check which is appropriate). Replace the direct `writeFile`.

**Test:** existing migration tests should still pass; add one that asserts the sentinel content is well-formed after a simulated crash (use a wrapper that throws after writeFile but before fsync, verify no partial sentinel).

### 1.4 — Major concurrency

**1.4a — Migration TOCTOU** (`packages/core/src/state/lock.ts:137-142`):
- `withStateLock` calls `isMigrationLocked` *before* acquiring `lockfile.lock(stateTarget,…)`. Re-check inside the lock.
- `migrateToCurrent` should also acquire the state lock briefly at start to flush in-flight writers.

**1.4b — Lifecycle ops need `withStateLock`** (`packages/core/src/task/lifecycle.ts:19-37`):
- `archiveTask`, `unarchiveTask`, `deleteTask` are not wrapped. Wrap all three.
- Match the existing pattern in `linkTask`.

**1.4c — History append inside state lock** (`packages/core/src/task/relationships.ts:174-275`):
- `appendHistory` runs *after* `writeTask` returns and *after* the state lock releases. Crash between leaves a relationship change with no audit entry.
- Move `appendHistory` inside the `withStateLock` callback. Same for any other handler that writes then appends history (audit all `appendHistory` call sites).
- Note: `appendHistory` takes its own per-task lockfile. That's fine — nested locks on different targets are safe; just don't deadlock by acquiring state lock from inside history lock.

**1.4d — `updateTaskBody` cache invalidation** (`packages/core/src/task/io.ts:59-74`):
- `updateTaskBody` (used by `writeTaskBody`/`appendTaskBody`) bypasses `writeTask` → never calls `clearLookupCaches`.
- Route through `writeTask` so the cache invariant matches metadata writes.

### 1.5 — Error narrowing

**1.5a — `lookupByKey` stale-entry catch** (`packages/core/src/task/lookup.ts:55-58`):
- Bare `catch {}` swallows all `readTask` errors including IO/perms.
- Narrow to ENOENT (fall through to rebuild); rethrow other errors.

**1.5b — `lookupTask` ULID-fallback catch** (`packages/core/src/task/lookup.ts:90`):
- Same bug: bare catch.
- Narrow to `TaskNotFoundError`; rethrow other errors.

**1.5c — MCP outer catch** (`apps/mcp/src/index.ts:1804-1806`):
- `catch (err) { return errorResult((err as Error).message); }` maps every throw to a routine tool error.
- Introduce/extend a `KNOWN_DOMAIN_ERRORS` list (mirror CLI's `apps/cli/src/index.ts`).
- Domain errors → `errorResult` with the message.
- Anything else → rethrow so the framework logs it.

### 1.6 — Phase 1 commit plan

Each gets its own commit with `npm run typecheck && npm test` between:

1. `key-index: lazy fold-on-miss; drop count watermark` (1.1, core only — `lookupByKey` rewrite + tests, no surface changes yet)
2. `doctor: index integrity check + --rebuild-index flag` (1.1, CLI + MCP surface + docs)
3. `relationships: resolve inverse keys before cycle walk` (1.2 fix)
4. `doctor: scan for existing relationship cycles` (1.2 doctor)
5. `schema: write migration sentinel atomically` (1.3)
6. `state: re-check migration lock inside state lock` (1.4a)
7. `task: wrap archive/unarchive/delete in state lock` (1.4b)
8. `task: append history inside state lock` (1.4c)
9. `task: route updateTaskBody through writeTask` (1.4d)
10. `lookup: narrow caught errors to ENOENT / TaskNotFoundError` (1.5a + 1.5b)
11. `mcp: rethrow non-domain errors from tool dispatcher` (1.5c)

---

## Phase 2 — API contracts + CLI/MCP delete/archive alignment

### 2.1 — Structured project filter in `handleListTasks`

`apps/web/src/server.ts:1339-1376` composes a JQL query by string concat. Pass `project` as a structured option to core's `listTasks` instead. Requires extending the `listTasks` core API with an optional `projectFilter?: ProjectKey`. Audit other callers (CLI list, MCP list_tasks) for consistency.

### 2.2 — `Content-Disposition` filename encoding

`apps/web/src/server.ts:1655`. Use RFC 5987 `filename*=UTF-8''<percent-encoded>` form; strip CR/LF; keep the ASCII `filename="..."` fallback for legacy clients. Helper in a new `apps/web/src/http/content-disposition.ts`.

### 2.3 — `TaskFrontmatterPublicSchema` for API responses

- New schema in `packages/contracts/src/task.ts` next to `TaskFrontmatterSchema`.
- Strict (no `.passthrough()`). Lists known top-level keys: `id`, `key`, `key_history`, `project`, `status`, `priority`, `task_type`, `title`, `description`, `assignee`, `reporter`, `created_at`, `updated_at`, `due_date`, `start_date`, `completed_date`, `archived`, `archived_at`, `status_updated_at`, `labels`, `sprint`, `milestone`, `board_rank`, `relationships`, `custom_fields`, `attachments`. Verify by reading `TaskFrontmatterSchema` for current truth.
- `custom_fields` is the typed map already governed by workflow config — preserve its schema.
- Disk parse keeps passthrough; API response handlers in `apps/web/src/server.ts` parse-and-strip through the public schema before responding.
- Verify with a test: post a task with an extra unknown top-level frontmatter key (write the file directly), GET it via the API, assert the unknown key is absent from the response.

### 2.4 — Activity endpoint `.slice().reverse()`

`apps/web/src/server.ts:1455`. Trivial.

### 2.5 — `AttachResultResponse` → contracts

Move from `apps/web/src/client.ts` to `packages/contracts/src/service.ts`. Update server + client imports.

### 2.6 — Archived-reference guard on remap targets

`packages/core/src/labels/manage.ts:154-200`, plus equivalents for `sprints`, `milestones`, `projects`. When `deleteX(hard, { remapTo })`, validate that the remap target itself is not archived.

`packages/core/src/task/create.ts:113-115`: when auto-stamping reporter from `current-user`, reject if the current user is archived (or downgrade to a clear error message).

### 2.7 — CLI/MCP delete/archive alignment

**Breaking change.** Apply uniformly to: `task`, `project`, `label`, `milestone`, `sprint`, `user`.

CLI changes (`apps/cli/src/index.ts`):
- `loctt delete <task>` becomes hard-only. Drop `--hard` flag. Still requires `--yes`. Update `usage()` text and all `case "delete":` branches under `task`/`project`/`label`/`milestone`/`sprint`/`user`.
- `loctt archive <task>` stays as the soft path (already exists).
- Output: remove the "use --hard to remove permanently" hint; instead, on `delete` confirm prompt, mention "this is permanent; use `archive` for the reversible variant."

Docs changes:
- `docs/user/cli/reference.md`: rewrite the delete/archive sections.
- `README.md`: update any examples.
- Note in `docs/user/common/concepts.md` or features: deliberate symmetry between CLI and MCP — `delete` is always destructive, `archive` is always reversible.

Tests:
- Update all CLI tests asserting the old `delete = archive` behavior.
- Add a test that `loctt delete T-X` without `--yes` is rejected.

### 2.8 — CLI `body`/`log`/`delete` in `runCommand`

`apps/cli/src/index.ts:1005, 1038, 1071`. Wrap each handler body so `TaskNotFoundError` gets the canonical domain-error treatment.

### 2.9 — `attach` AttachmentExistsError into `KNOWN_DOMAIN_ERRORS`

Currently `attach` reimplements the runCommand-style catch by hand to add a `--force` hint. Extend `KNOWN_DOMAIN_ERRORS` to optionally augment messages, then route `attach` through `runCommand`.

### 2.10 — `resolveProjectKeyForUser` in core

Project-resolution chain (explicit → per-user default → workspace default → sole project) is duplicated in CLI:750-762 and MCP:991-1005. Move to `packages/core/src/projects/resolve.ts` exported through `packages/core/src/index.ts`. Both surfaces call it.

### 2.11 — MCP `create_task` workflow-enum prevalidation

CLI pre-validates at `apps/cli/src/index.ts:767-769` via `assertWorkflowEnumKey`. MCP at `apps/mcp/src/index.ts:987-1034` doesn't. Add the same pre-check so the agent gets a clear "known values" hint rather than a deeper `TaskUpdateError`.

### 2.12 — MCP `list_tasks` default limit — FALSE POSITIVE

`apps/mcp/src/index.ts` describes `limit` as "default 30" and forwards `undefined` to core's `listTasks`. Core applies `options.limit ?? 30` at `packages/core/src/query/list.ts:160`, so the documented default is the effective default. No drift. Skip.

### 2.13 — Phase 2 commit plan

1. `web: structured project filter in handleListTasks`
2. `web: RFC 5987 Content-Disposition filename encoding`
3. `contracts: TaskFrontmatterPublicSchema for API responses`
4. `web: clone history entries before reverse`
5. `contracts: promote AttachResultResponse from web/client`
6. `core: reject archived remap targets on hard delete`
7. `core: reject archived auto-stamped reporter on task create`
8. `cli,mcp: align delete (hard) and archive (soft) semantics`  ← breaking
9. `cli: wrap body/log/delete in runCommand`
10. `cli: route attach errors through KNOWN_DOMAIN_ERRORS`
11. `core: extract resolveProjectKeyForUser`
12. `mcp: pre-validate workflow enum keys on create_task`
13. `mcp: enforce list_tasks default limit`

---

## Phase 3 — Docs + Minor batch

### 3.1 — Docs

- **`README.md`** + **`docs/user/common/git-sync.md`**: rewrite all `loctt publish` / `loctt sync` to `loctt git publish` / `loctt git sync`. Remove the `loctt reconcile {status,continue,abort}` section (commands don't exist) OR implement them — verify with user before deleting if section was aspirational.
- **`TODO.md`**: rewrite. Currently claims `apps/web`, attachments upload, activity log don't exist — all three exist. Either delete (preferred) or rewrite to current state.
- **`docs/dev/schema-reference.md:39`**: `docs/` is on-by-default; `--no-docs` to disable. Update comment.
- **`docs/user/cli/reference.md:415-434`**: move `sprint burndown` under "Sprints"; give `rerank`/`board-rerank` their own "Ranks" section.
- **`docs/user/cli/reference.md:47-54`**: clarify `schema` and `views` require initialized tracker.
- **`docs/user/mcp/reference.md`**: verify `delete_*` parameter tables match handler code post-Phase-2 alignment.
- **`docs/user/features.md`** or **`docs/user/common/concepts.md`**: add note about history entries carrying actor id (per commit `8c9d27b`).
- **`docs/dev/development.md`**: add Tests section pointing to `tests/README.md`.
- **`README.md:79`**: change `npm link` to `npm link --workspace apps/cli`.
- **`tests/README.md`**: regenerate the tree layout from actual `find tests -type d`; reflect three perf files.
- Verify all doc cross-links resolve (run a link-check pass or grep for broken anchors).

### 3.2 — `tests/workspace/` sweep

9 stale `loctt-*` dirs exist despite README claiming a global sweep. Inspect `tests/fixtures/global-sweep.ts` (or equivalent) and verify it's wired into `globalSetup` for all three vitest configs (`tests/vitest.integration.config.ts`, `tests/vitest.e2e.config.ts`, `tests/vitest.perf.config.ts`). If not wired, wire it. If wired, debug why it's not sweeping. Delete the 9 stale dirs manually as part of the commit.

### 3.3 — Minor batch

| # | File | Fix |
|---|---|---|
| 25 | `packages/core/src/state/journal.ts:166-170` | `loadJournal` logs corruption before returning empty |
| 26 | `packages/core/src/state/journal.ts:108` | `WorkflowRemapTableSchema` cross-validates remap keys vs prev at write time |
| 27 | `packages/core/src/state/journal.ts:380-386` | Unhandled-kind loop: break after N retries, surface fatal |
| 28 | `packages/core/src/config/workflow-write.ts:615-617` | `makeJournalEntryId` uses `ulid()` |
| 29 | `packages/core/src/task/relationships.ts:215-219` | Cycle-path catch narrows to `TaskNotFoundError` (covered partly by 1.2) |
| 30 | `packages/core/src/task/relationships.ts:99-127` | `MAX_VISITS` overflow throws (covered by 1.2) |
| 31 | `packages/core/src/projects/manage.ts:113-133` | `createProject` diffs prev/new prefix; fail loudly on `KeyAllocationError` |
| 32 | `packages/core/src/state/lock.ts:78-84` | Recovery hook bootstrap caches import failure; rethrow on first use |
| 33 | `packages/contracts/src/state.ts` | Widen `LocttState.keys` to `Record<string, …>` mutably so `allocateKey` doesn't need a typed cast |
| 34 | `packages/core/src/task/io.ts:34-42` | `writeTask` validates via `TaskFrontmatterSchema.parse` not round-trip |
| 35 | `packages/core/src/task/update.ts:30-40` | Rename to `USER_IMMUTABLE_FIELDS`; add `SYSTEM_MUTABLE_VIA` map listing privileged callers (project via hard-delete remap, etc.) |
| 36 | `apps/cli/src/index.ts:640-654` | `info` narrows projects-load error to ENOENT |
| 37 | `apps/cli/src/index.ts:546-552` | `formatHistoryEntry` parses meta via zod; no `as` cast. Add HistoryMetaSchemas to contracts/history.ts |
| 38 | `apps/cli/src/index.ts:132-185` | `usage()` documents `--yes`, `--remap-to`, `--unassign` |
| 39 | `apps/cli/src/index.ts:303-316` | `hasFlag` strict suffix validation (`true|false|1|0|yes|no`) |
| 40 | `apps/mcp/src/index.ts:1414-1747` | Regroup archive/unarchive cases by entity (covered by Phase 4 split) |
| 41 | `apps/mcp/src/index.ts:678-691` | `DateLikeString` tightens to ISO regex; or drop and rely on `setField` validation |
| 42 | `apps/web/src/server.ts:412` | `decodeURIComponent` try/catch → 400 |
| 43 | `apps/web/src/server.ts:447` | `tryServeStatic` detects stream error before headers sent |
| 44 | `apps/web/src/server.ts:531-580` | Replace `Parameters<typeof createView>[1]` casts with zod schemas from contracts |
| 45 | `apps/web/src/server.ts` (~15 sites) | Factor `VALID_REF_RE` into `requireValidRef(captures, res)` helper |
| 46 | `apps/web/src/server.ts:801` | DELETE handlers use the `url` capture already in scope |
| 47 | `apps/web/src/server.ts:990` | Remove dead `if (request === undefined) return;` |
| 48 | `apps/web/src/client.ts:50` | Drop redundant `as { error?: string }` cast |
| 49 | `packages/contracts/src/users.ts:20` | Verify Zod version; use `z.string().email()` if Zod 3 |
| 50 | `packages/core/src/rank/lexorank.ts:178-215` | `evenlySpacedRanks` single-digit branch defensive assert |
| 51 | `packages/core/src/config/archived-guard.ts:42-54` | Cache dynamic imports at module scope (verify no real cycle) |

### 3.4 — Phase 3 commit plan

Group docs in one commit per area; minor fixes in 2-3 themed commits (state/journal, web cleanup, naming/typing).

---

## Phase 4 — Structural splits + per-tool zod + test additions

### 4.1 — Split `apps/cli/src/index.ts` (2214 lines)

Target structure:
```
apps/cli/src/
  index.ts              # dispatcher only (~50 lines)
  argv.ts               # getArg, stripCwdArg, hasFlag, parseArgs
  runtime.ts            # runCommand, UsageError, KNOWN_DOMAIN_ERRORS, confirmHardDelete
  commands/
    init.ts             # init, schema
    info.ts             # info, doctor, views
    task.ts             # create, get, list, set, unset, body, log, attach, detach, archive, unarchive, delete, link, unlink, reorder-relationship
    project.ts
    label.ts
    milestone.ts
    sprint.ts
    user.ts
    git.ts
    config.ts
    mcp.ts              # the `loctt mcp` command
    ui.ts
```

Each command file exports `(args: string[], root: string) => Promise<void>`. Dispatcher in `index.ts` is a `Record<string, CommandHandler>`.

Process:
1. Extract `argv.ts` and `runtime.ts` first (pure helpers, easy diff).
2. Extract one command group at a time, run tests, commit each.
3. Final commit: shrink `index.ts` to dispatcher.

### 4.2 — Split `apps/mcp/src/index.ts` (1807 lines)

Target structure:
```
apps/mcp/src/
  index.ts              # server bootstrap + dispatcher
  runtime.ts            # parseToolArgs, requireConfirm, checkFieldWritability, KNOWN_DOMAIN_ERRORS
  tools/
    definitions.ts      # ALL_TOOLS array (replace getTools() function)
    schemas.ts          # per-tool zod schemas + discriminated union
    handlers/
      task.ts
      project.ts
      label.ts
      milestone.ts
      sprint.ts
      user.ts
      calendar.ts
      git.ts
      config.ts
  schemas.ts removed in favor of tools/schemas.ts
```

Switch → typed `Map<string, Handler>`:
```ts
type Handler<T> = (args: T, ctx: ToolContext) => Promise<ToolResult>;
const handlers = new Map<ToolName, Handler<ToolArgs>>([...]);
```

Per-tool zod schemas:
- Each tool defines `<ToolName>ArgsSchema = z.object({...}).strict()`.
- `parseToolArgs(name, raw)` returns `{ ok: true, args: ToolArgs } | { ok: false, error: string }`.
- Handlers receive a fully-typed args object — no `args["ref"] as string` anywhere.

Drop dual `getTools()` + `ALL_TOOLS` export; keep only the const.

### 4.3 — Test additions

CLI (`apps/cli/src/cli.test.ts`):
- `--set "" --append` mutex.
- `--limit` non-integer validation.
- `attach` AttachmentExistsError → `--force` hint path.
- `loctt list --view --project` interaction (verify documented behavior).
- `loctt delete` without `--yes` rejected (post-Phase 2).

MCP (`apps/mcp/src/mcp.test.ts`):
- `delete_project`, `delete_label`, `delete_milestone`, `delete_sprint`, `delete_user` all reject without `confirm: true`.
- `create_task` workflow-enum hint (post-2.11).
- `list_tasks` default limit (post-2.12).

Web (`apps/web/src/server.test.ts`):
- Convert from `beforeAll`/`afterAll` to `beforeEach`/`afterEach` for the security suite.
- Add assertion: avatar upload tests verify no file written outside the user dir.

Cycle tests:
- Per Phase 1.2.

### 4.4 — Suggestions

- `apps/cli/src/index.ts` argv: `getArg` rejects single-dash long-form. Document in argv.ts comment.
- `apps/cli` `ui` command: log spawn failure under `LOCTT_DEBUG=1`.
- `tests/perf/03-concurrent-create.test.ts`: assert `apps/cli/dist/index.js` mtime > source mtime, fail loudly otherwise.

### 4.5 — Phase 4 commit plan

CLI split:
1. `cli: extract argv helpers`
2. `cli: extract runtime helpers (runCommand, errors)`
3. `cli: extract task command group`
4. `cli: extract project/label/milestone/sprint/user command groups`
5. `cli: extract git/config/mcp/ui/init/info commands`
6. `cli: dispatcher map in index.ts`

MCP split:
7. `mcp: extract runtime helpers`
8. `mcp: per-tool zod schemas + discriminated parser`
9. `mcp: extract task tools`
10. `mcp: extract project/label/milestone/sprint/user tools`
11. `mcp: extract calendar/git/config tools`
12. `mcp: typed handler map`

Tests:
13. `cli: cover missing parser edge cases`
14. `mcp: cover delete-confirm gating across entities`
15. `web: per-test isolation in security suite`

---

## Carry-over notes for next agent

- **`TEMP-IMPLEMENTATION-PLAN.md` and `temp-ui-mockups/` are intentionally kept.** Do not delete.
- **No AI/Claude attribution** in commit messages. Read CLAUDE.md.
- After every commit: `npm run typecheck && npm test` from repo root. If fails, fix in the same commit before moving on.
  - **Known pre-existing flakes** under parallel `npm test`: `src/git/publish-sync.test.ts`, `src/git/push-fetch.test.ts`, occasionally `src/scaffold.test.ts`. They pass cleanly in isolation. If only these fail, re-run before treating it as a real regression.
- `npm run lint` is separate; run at end of each phase.
- Read this doc top to bottom before touching code. Each item references the exact file:line so you can validate the fix is still relevant before applying.
- When in doubt about a multi-option design call, look in the "Decisions already locked in" section first — most have been made.
- The reviewer's note about MCP `hard` parameter on delete tools is a **false positive** — docs and code agree (MCP delete is hard-only, MCP archive is the soft path). Do not "fix" this.

## Snapshot of completed work (Phases 1-3)

Phases 1, 2, and 3 are done. 33+ commits in this pass; full suite green on each.

**Phase 1 — Critical + Concurrency + Error narrowing.** Key-index lazy fold-on-miss replaces the count watermark and ships with `loctt doctor --rebuild-index` for the out-of-band-edit escape hatch. Cycle detection resolves inverse keys before walking and now throws on MAX_VISITS overflow; a separate `findStructuralCycles` doctor scan surfaces existing cycles on disk. Schema migration sentinel writes atomically. State lock closes the migration TOCTOU via a hand-off protocol (state-lock briefly during migration-lock acquire, released early so concurrent writers fail fast). `archiveTask` / `unarchiveTask` / `deleteTask` / `setField` / `unsetField` / `updateTaskBody` all wrapped in `withStateLock`. Error narrowing: `lookupByKey` and `lookupTask` propagate non-ENOENT / non-`TaskNotFoundError`; MCP dispatcher's outer catch whitelists domain errors and rethrows the rest.

**Phase 2 — API contracts + CLI/MCP alignment.** Structured `project` filter for `listTasks` across all three surfaces (no more string-concat into the query DSL). `Content-Disposition` uses RFC 5987 `filename*` + sanitized ASCII fallback. `TaskFrontmatterPublicSchema` projects HTTP responses through a strict allowlist. `AttachResultResponse` moved to contracts. Activity endpoint clones before reverse. Hard-delete rejects archived remap targets across label/sprint/milestone/project/user. **CLI `--hard` removed entirely** — `delete` is permanent, `archive` is reversible, both surfaces use the same two-verb model. `body`/`log`/`delete` now route through `runCommand`; `attach` rethrows with `--force` hint. `resolveProjectKeyForUser` extracted to core. MCP `create_task` pre-validates workflow enum keys with the "Known: ..." hint.

**Phase 3 — Docs + minor batch.** README + `docs/user/common/git-sync.md` updated for `loctt git publish` / `loctt git sync` (reconcile section removed). `TODO.md` rewritten. CLI reference: ranks section split out, `sprint burndown` moved under Sprints. `tests/README.md` layout regenerated. E2E + perf configs got the loctt-* workspace sweep wired in. `IMMUTABLE_FIELDS` renamed to `USER_IMMUTABLE_FIELDS` + new `SYSTEM_MUTABLE_VIA` map documenting privileged callers. Journal corruption is now logged instead of swallowed. `workflow-write` cross-validates remap source keys at write time. `DEFAULT_LIST_LIMIT` constant. `requireValidRef` helper in web. `readErrorMessage` helper in client. Perf test 03 fails loud on stale dist. `loctt ui` debug-logs spawn failures. ~14 other minor fidelity fixes.

## Phase 4 — Structural splits + per-tool zod + test additions

**Pacing note:** Phase 4 is the highest-churn pass and the lowest correctness value. If pressed for time, ship Phases 1-3 first and treat Phase 4 as a separate follow-up. The CLI/MCP files are 2200 / 1800 lines each and refactoring them is multi-day work with real regression risk.

### 4.1 — Split `apps/cli/src/index.ts` (2200+ lines)

Target structure:
```
apps/cli/src/
  index.ts              # dispatcher only (~50 lines)
  argv.ts               # getArg, stripCwdArg, hasFlag, parseArgs, EXIT
  runtime.ts            # runCommand, UsageError, KNOWN_DOMAIN_ERRORS, confirmHardDelete, assertWorkflowEnumKey, assertWorkflowRelationshipKey
  format.ts             # formatHistoryEntry, formatValue, pad, formatNumber, readLinkMeta
  commands/
    init.ts             # init, schema, views
    info.ts             # info, doctor
    task.ts             # create, show, list, set, unset, body, log, attach, detach, archive, unarchive, delete, link, unlink
    project.ts
    label.ts
    milestone.ts
    sprint.ts
    user.ts
    rank.ts             # rerank, board-rerank
    git.ts
    config.ts
    mcp.ts              # `loctt mcp` server-launch command
    ui.ts
    calendar.ts
    migrate.ts
```

Each command file exports `(args: string[], root: string) => Promise<void>`. Dispatcher in `index.ts` becomes a `Record<string, CommandHandler>` map.

Process:
1. Extract `argv.ts` and `runtime.ts` first (pure helpers, easy diff).
2. Extract `format.ts` next.
3. Extract one command group per commit, run tests, commit each.
4. Final commit: shrink `index.ts` to dispatcher.

### 4.2 — Split `apps/mcp/src/index.ts` (1800+ lines)

Target structure:
```
apps/mcp/src/
  index.ts              # server bootstrap + dispatcher
  runtime.ts            # parseToolArgs, requireConfirm, checkFieldWritability, isKnownDomainError, assertWorkflowEnumKey, errorResult, text helpers
  tools/
    definitions.ts      # ALL_TOOLS array (replace getTools() function — drop the dual export)
    schemas.ts          # per-tool zod schemas + discriminated union type
    handlers/
      tracker.ts        # init, info, doctor, enable_git, disable_git, get_git_status, publish, sync
      task.ts           # create_task, get_task, list_tasks, update_task, unset_field, get_task_history, replace_task_body, append_task_body, attach_file, detach_file, archive_task, unarchive_task, delete_task, link_tasks, unlink_tasks, reorder_relationship
      project.ts        # list_projects, create_project, edit_project, archive_project, unarchive_project, delete_project, set_default_project
      user.ts           # list_users, get_current_user, switch_user, create_user, edit_user, archive_user, unarchive_user, delete_user
      label.ts          # list_labels, create_label, edit_label, archive_label, unarchive_label, delete_label
      milestone.ts      # list_milestones, create_milestone, edit_milestone, archive_milestone, unarchive_milestone, delete_milestone
      sprint.ts         # list_sprints, create_sprint, edit_sprint, archive_sprint, unarchive_sprint, delete_sprint, get_sprint_burndown
      calendar.ts       # get_calendar
      config.ts         # get_config_value, set_config_value, unset_config_value
      views.ts          # list_views, get_workflow_config
      rank.ts           # reorder_board
```

Switch → typed `Map<string, Handler>`:
```ts
type Handler<T> = (args: T, ctx: ToolContext) => Promise<McpToolResult>;
const handlers = new Map<ToolName, Handler<ToolArgs>>([...]);
```

Per-tool zod schemas (item 4.3 below) make this typed handler map exhaustive at compile time.

### 4.3 — Per-tool zod schemas

Define one schema per tool in `tools/schemas.ts`:
```ts
export const CreateTaskArgsSchema = z.object({
  title: z.string().min(1),
  project: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  task_type: z.string().optional(),
  parent: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  // ...
  body: z.string().optional(),
}).strict();
export type CreateTaskArgs = z.infer<typeof CreateTaskArgsSchema>;
```

`parseToolArgs(name, raw)` returns `{ ok: true, args: ToolArgs } | { ok: false, error: McpToolResult }`. Handlers receive a fully-typed args object — no `args["ref"] as string` casts anywhere.

Memoize `ALL_TOOLS = getTools()` and drop the lazy `getTools()` factory function (item from the original review — dual export invites drift).

### 4.4 — Memoize getTools (rename to ALL_TOOLS export)

Drop the function-form export `getTools()`. Only export the memoized const. Update CLI's `mcp` command callsite if it uses the function form.

### 4.5 — Argv tightenings

In the new `argv.ts`:

- `getArg` rejects single-dash long-form (`-cwd value`). Currently both `--cwd` and `-cwd` are accepted; pick one (long-form only) and reject the other as `UsageError`.
- Document that `--` ends flag parsing.

### 4.6 — Test additions

CLI (`apps/cli/src/cli.test.ts`):
- `--set "" --append <text>` mutex (already documented but untested).
- `--limit` non-integer / negative validation on `list` and `log`.
- `list --view <v> --project <p>` interaction — verify the documented "view is respected as authored; --project is applied as a post-query filter" behavior.

MCP (`apps/mcp/src/mcp.test.ts`):
- `delete_project`, `delete_label`, `delete_milestone`, `delete_sprint`, `delete_user` all reject without `confirm: true`. (Currently only `delete_task` is covered.)

Web (`apps/web/src/server.test.ts`):
- Convert `beforeAll`/`afterAll` to `beforeEach`/`afterEach` for the security suite so tests don't leak state between cases. The avatar / to-delete cases are particularly cross-contaminated.
- Avatar upload tests: assert no file written outside the user dir (defense in depth; current code already enforces this via `assertSafeBasename`).

### 4.7 — Web stream-error pre-headers

`apps/web/src/server.ts:447` — `tryServeStatic` writes 200 + Content-Type then streams; on `stream.on("error", reject)` after headers are sent the connection is half-written. Stat first (already done), then either:
- Detect the error before `writeHead` (replace `createReadStream(filePath).pipe(res)` with a try-stream-once probe), OR
- Wrap the stream in `pipeline()` from `node:stream/promises` and call `res.destroy()` on stream errors so the client sees a truncated connection rather than a half-written body.

The second is simpler; do that.

### 4.8 — Web createView/updateView/etc casts → zod schemas

`apps/web/src/server.ts:531-580` — several handlers use `Parameters<typeof createView>[1]` casts to bypass runtime validation. If core changes its signature, the HTTP boundary accepts whatever-shaped JSON. Replace with zod schemas in contracts (mirror `CalendarConfigSchema` / `ListViewConfigSchema` already in use):
- `CreateViewRequestSchema`
- `UpdateViewRequestSchema`
- `CreateProjectRequestSchema`
- `UpdateProjectRequestSchema`
- `CreateSprintRequestSchema`
- `UpdateSprintRequestSchema`
- `CreateMilestoneRequestSchema`
- `UpdateMilestoneRequestSchema`
- `CreateLabelRequestSchema`
- `UpdateLabelRequestSchema`

Each handler does `.safeParse()` on the JSON body and returns 400 with field path on failure.

### 4.9 — MCP archive_*/unarchive_* case regrouping

Current `apps/mcp/src/index.ts` has `archive_project` at ~1414, `archive_label` at ~1710, `archive_milestone` at ~1723, `archive_sprint` at ~1736. Grouped by verb instead of by entity. Phase 4.2's split into `tools/handlers/<entity>.ts` naturally fixes this — the regroup is a free consequence of the structural split.

### 4.10 — Phase 4 commit plan

CLI split:
1. `cli: extract argv helpers (argv.ts)`
2. `cli: extract runtime helpers (runtime.ts)`
3. `cli: extract formatting helpers (format.ts)`
4. `cli: extract init/info/schema/views/doctor commands`
5. `cli: extract task command group`
6. `cli: extract project command group`
7. `cli: extract label/milestone/sprint command groups`
8. `cli: extract user command group`
9. `cli: extract rank command group`
10. `cli: extract git/config/migrate commands`
11. `cli: extract mcp/ui server-launch commands`
12. `cli: dispatcher map in index.ts`

MCP split:
13. `mcp: extract runtime helpers (runtime.ts)`
14. `mcp: per-tool zod schemas + discriminated parser`
15. `mcp: extract tool definitions module`
16. `mcp: extract task tool handlers`
17. `mcp: extract project/label/milestone/sprint/user handlers`
18. `mcp: extract calendar/git/config/views handlers`
19. `mcp: extract rank/burndown handlers`
20. `mcp: typed handler map; drop getTools() factory`

Misc:
21. `cli: getArg rejects single-dash long-form`
22. `web: pipeline() with destroy on tryServeStatic stream errors`
23. `web: zod request schemas for createView / updateProject / etc`

Tests:
24. `cli: cover --set/--append mutex and --limit edge cases`
25. `cli: cover list --view + --project interaction`
26. `mcp: cover delete-confirm gating across all entities`
27. `web: per-test isolation in security suite`

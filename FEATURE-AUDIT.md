# LocTT feature audit

A ten-slice audit of what LocTT specifies, what it implements, where the
three front-ends disagree, and what tests are missing. Produced against
`b4f0fbf` with a live working tree; headline findings were re-verified
against HEAD after the agents finished.

**Method.** A feature exists if it is *documented* **or** *implemented* —
gaps flow both directions. Ten agents each traced one domain across
`docs/` → `packages/core` → `apps/cli` → `apps/mcp` → `apps/web/src/server`
→ the ~180 existing test files. Findings marked **[verified]** were
reproduced by running code, not inferred from reading it.

**Companion docs.** Test cases live beside the existing UI specs:

- [`docs/dev/surface-test-cases/`](docs/dev/surface-test-cases/) — 64 CLI
  and MCP cases, one file per domain, surface as a tag on the case
- [`docs/dev/ui-test-cases/`](docs/dev/ui-test-cases/) — existing UI specs (unmodified)
- [`PROPOSED-UI-CASES.md`](PROPOSED-UI-CASES.md) — additions proposed to the UI flow docs, for review

---

## 1. The three things this audit found

### The core is healthy. The surfaces are not.

Core logic is well-designed and genuinely well-tested. Almost every
defect is at a surface boundary, in one of three shapes:

| Shape | What it looks like | Count |
|---|---|---|
| **Core called wrong** | A surface passes the wrong arguments to a correct core function | 4 |
| **Core's errors swallowed** | Core raises a precise, actionable error; the surface discards it and returns a bare 500 | 9 |
| **Core never wired** | Core implements, exports, and unit-tests a capability no surface calls | 15 |

That is a good problem to have. The expensive layer is right; the cheap
layer is wrong.

### Tests exist where the bugs aren't

Three separate suites **encode the bug as intended behaviour**. These are
not coverage gaps — the tests are present, thorough, and green:

- `buildDsl.test.ts:26` is named *"uses `in [...]` for multi-value facets"*
  and asserts the exact string the core parser cannot parse. It never
  feeds that string to the parser.
- All 18 cases in `burndown.test.ts` reuse one sprint id for both the
  sprint and its tasks, making "has a sprint" and "has *this* sprint"
  indistinguishable — which is precisely the bug.
- `publish-sync.test.ts:88` asserts sync **deletes** local files;
  `with-remote.test.ts:83` asserts exit **0** on an unreachable remote.
  The destructive mirror semantics are the assertion.

Adding tests would not have caught any of these. The fix is to point
existing tests at the boundary they skip.

### Untested routes are where the blockers live

~33 of 71 web routes have a test. The untested set maps almost exactly
onto the blocker list: every task mutation route, all of
labels/milestones/views, all five git routes, the entire static/SPA
fallback. Both relationship blockers (F-REL-1, F-REL-2) sit in the
`/link` and `/unlink` routes, which no test touches.

---

## 2. Blockers

Ranked by consequence. **[verified]** = empirically reproduced.

### Data loss

| # | Finding | Where | Surfaces |
|---|---|---|---|
| **B1** | **Sync silently destroys local field edits.** Two clones, one bare remote: B edits `title`, A edits `status`; after A syncs, A's `status` is gone. Exit 0, success message. Only check is `last_synced_commit === remoteHead`, then `mirrorDir` `rm -rf`s the local side. **[verified]** | `git/publish-sync.ts:292,302` | CLI · MCP · web |
| **B2** | **Sync deletes locally-created tasks, unrecoverably.** An offline-created `T-2` was removed from disk with no trace in `.loctt/` and nothing in any git object. Exactly the collision `rekeyCollisions` was written for. **[verified]** | `git/publish-sync.ts` | CLI · MCP · web |
| **B3** | **Sync overwrites `.schema-version`, bricking the tracker.** Branch holds `999`; after sync every command fails — including `git disable`. No LocTT command recovers it. **[verified]** | `git/publish-sync.ts` | CLI · MCP · web |
| **B4** | **Publish destroys pre-existing `loctt` branch content** with no prompt. **[verified]** | `git/publish-sync.ts` | CLI · MCP · web |
| **B5** | **No concurrency control anywhere.** No ETag, `If-Match`, or version stamp exists in `server.ts` (grep: 0 hits). Two tabs, or a tab and the CLI, silently clobber. `updated_at` is already on the wire, so a precondition is implementable. **[verified]** | `server.ts:1380-1388` | web |

> **Git-backed mode is a blind last-writer-wins directory mirror, not a
> sync system.** The 3-way reconciliation documented at
> `git-sync.md:33-55` does not exist in any executable path.
> `rekeyCollisions`, `mergeRelationships`, `mergeKeyHistory` and the whole
> `reconcile.yaml` lifecycle are exported and unit-tested with **zero
> production call sites**. Worktree isolation, by contrast, is correct and
> was verified against dirty-tree and detached-HEAD repos.

### Correctness

| # | Finding | Where | Surfaces |
|---|---|---|---|
| **B6** | **Every burndown sums all sprints.** `inSprint` means "has *a* sprint" — `sprint.id` is never compared to the task's `sprint`. A foreign task yielded `initialTotal: 1` on an unrelated sprint. **[verified]** | `sprints/burndown.ts:292,303` | CLI · MCP · web |
| **B7** | **Unlink strands the inverse edge.** `unlinkTask` is called without `workflowConfig`, so `findInverseType` returns `undefined` and the inverse branch is skipped. `T-1.blocks→T-2` is removed; `T-2.blocked_by→T-1` persists forever. CLI and MCP pass the config; only web is wrong. **[verified]** | `server.ts:1844` vs `:1830` | web |
| **B8** | **`in [...]` is unparseable.** Three sites emit square-bracket list literals; the tokenizer has no `[` token at all. Any multi-value filter → 500, **5 of 6 built-in sidebar filters → 500**, and Save-as-view writes unparseable DSL into `queries.yaml`. **[verified]** | `server.ts:449`, `buildDsl.ts:39`, `builtinFilters.ts:54,112` | web |
| **B9** | **`validateWorkflowConfig` is never called on any write path** — its only caller is `doctor.ts:78`. `PUT /api/workflow` with a duplicated status returned 200 and wrote the duplicate to disk. **[verified]** | `server.ts:794` | web |
| **B10** | **Workflow drift is invisible to `doctor`.** `doctor.ts:263-270` explicitly filters workflow-key errors out of the reference check; after hand-deleting an in-use status, doctor printed `✓ workflow.yaml: valid`. Compounding: a drifted task renders the raw key **and is unqueryable**, because the DSL rejects the deleted literal — you cannot find the tasks you must fix. **[verified]** | `diagnostics/doctor.ts:263-270` | all |
| **B11** | **`updated_at` is user-writable via CLI and web**, blocked only in MCP. Forges the timestamp git-sync reconciliation, recency sort, and the activity feed depend on. **[verified]** | `task/update.ts:31-41`, `:208` | CLI · web |
| **B12** | **Board reorder ignores status.** `peers` is built from *all* ranked tasks with no status filter, contradicting its own docs in three places; a `todo` task took a rank derived from a `doing` task. It also writes with no `appendHistory`, and the rebalance path rewrites `updated_at` across every ranked task with no audit trail. **[verified]** | `rank/reorder.ts:190-196` | CLI · MCP · web |
| **B13** | **`--project-key`/`--project-label` are silently discarded on all three surfaces.** `InitRequestSchema` *declares* them as public API while `.strict()` accepts and drops them. `initLoctt({projectLabel:"Bug tracker"})` → `name: "Tasks"`. The worked example at `cli/reference.md:44` is a command where two of three flags are no-ops. **[verified]** | `service-schemas.ts:75-80`, `tracker.ts:86-92`, `server.ts:1405` | CLI · MCP · web |
| **B14** | **Init is not idempotent, and its docstring claims it is.** Delete `.loctt/config/` and doctor reports 3 errors while init refuses with "already exists" — the only way back is `rm -rf .loctt/`, destroying surviving tasks. **[verified]** | `init.ts:6-9` vs `:92-94` | CLI · MCP · web |
| **B15** | **`doctor` has 17 checks and none reads `.schema-version`.** Set it to `99` and doctor returns all-`ok` while every command is blocked. `computeSchemaStatus` already exists next door. **[verified]** | `diagnostics/doctor.ts` | CLI · MCP |

### Structural

| # | Finding | Where | Surfaces |
|---|---|---|---|
| **B16** | **The error envelope is `{error: string}`** — no code, no field pointer, no data-state, no next action, no per-item split. P4 and the whole of `flow-error-handling.md` are *structurally* unsatisfiable, not merely unimplemented. The generic 500 returns literally `"Internal server error"`, which your own ERR-30 names as a failing result. | `server.ts:235-237`, `:2139` | web |
| **B17** | **Web DELETE archives while reporting a delete.** `DELETE /api/{projects,sprints,milestones,labels}/:id` never passes `hard:true`, so core soft-archives — yet responds `200 {"deleted":…}`. `?remap_to` returns the raw CLI string `"--remap-to only applies to --hard delete"` over HTTP, and the "cannot delete the only project" guard never fires. **[verified]** | `server.ts:872` and siblings | web |
| **B18** | **Comment CRUD reaches no surface.** Full lifecycle in core — post, list, edit, delete, `editors` provenance, mentions — with **zero production callers**. No CLI command, no MCP tool, no route. `docs/user/ui/features.md` describes comments as shipped; `flow-comments-activity.md` has 38 cases with no backend. **[verified]** | `task/comments.ts` | none |
| **B19** | **Nine more core APIs are wired to nothing** (0 non-test refs in `apps/`): `duplicateTask`, `moveTaskToProject`, `bulkSetFields`, `bulkArchive`, `bulkMoveTasksToProject`, `setFields`, `validateQuery`, `countTasksByReference`, `pushRecent`. `GET /api/recents` therefore reads a list nothing writes. `flow-tasks.md` TSK-20/21/43/51 are M2 blockers with no API to call. **[verified]** | `core/index.ts` | none |
| **B20** | **Milestone progress does not exist anywhere** — zero hits across `packages` and `apps`. Ten MSL cases are unbacked. | — | none |

---

## 3. Cross-surface parity

Where the same operation behaves differently depending on how you reach it.

| Capability | CLI | MCP | Web API | Note |
|---|---|---|---|---|
| Comments | ✗ | ✗ | ✗ | Core-only (B18) |
| Duplicate / move task | ✗ | ✗ | ✗ | Core-only (B19) |
| Bulk set / archive / move | ✗ | ✗ | ✗ | Core-only (B19); `bulk_op_id` has no producer |
| Archive/unarchive project | ✓ | ✓ | ✗ | Web archived → **cannot be unarchived via web** |
| Archive/unarchive label | ✓ | ✓ | ✗ | `editLabel` won't accept `archived` at all |
| Archive/unarchive sprint | ✓ | ✓ | ✗ | `editSprint` won't accept `archived` at all |
| Archive/unarchive milestone | ✓ | ✓ | ~ | Only via divergent `PUT {archived}` |
| Config **read** | ✓ | ✓ | ✗ | Web is **write-only**: `GET /api/config/:key` → 404 |
| Workflow **write** | ✗ | ✗ | ✓ | `workflow-write.ts` (822 lines) has one call site |
| Migrate | ✓ | ✓ | ✗ | Guard 409s; banner names the CLI remedy (M4 deferral) |
| `rebuild_index` | ✓ | ✓ | ✗ | |
| Saved-view CRUD | ✗ | ✗ | ~ | No route reaches `unarchiveView` |
| Sort | ✗ | ✗ | ✓ | No `--sort` on CLI; no `sort`/`offset` on MCP |
| `--timezone` on init | ✓ | ✗ | ✗ | `.strict()` 400s it |
| `updated_at` immutable | ✗ | ✓ | ✗ | B11 |
| Enum validated after lookup | ✗ | ✓ | ✗ | CLI reports "unknown status" for a missing task, exit 2 |
| `set_user_setting` | ✗ | ✗ | ✗ | Documented at `mcp/reference.md:54`; exists nowhere |

**Default list limits diverge three ways:** 30 / 100 / 50.

---

## 4. UI readiness

7 of 18 flows cannot be backed by the current API. Relationships and
sprints are closest to ready.

| Flow | Backable? | Blocking gap |
|---|---|---|
| `flow-comments-activity` | ✗ | No comment API at all (B18) |
| `flow-bulk` | ✗ | No bulk endpoints; `bulk_op_id` unproducible (B19) |
| `flow-board` | ✗ | No atomic multi-field write; reorder ignores status (B12) |
| `flow-timeline` | ✗ | No atomic multi-field write |
| `flow-settings` | ✗ | Config read missing; no optimistic concurrency → SET-28 fails by construction |
| `flow-git-sync` | ✗ | 5 coarse verbs; `getGitStatus` is a config echo, so drift cannot be rendered |
| `flow-error-handling` | ✗ | `{error: string}` envelope (B16) |
| `flow-tasks` | ~ | Duplicate/move absent; `TaskResponse` has no relationships field |
| `flow-list` | ~ | `in [...]` 500s; `field.*` filters dropped in `useTasks.ts:53-69` |
| `flow-projects-users` | ~ | `?project=web` needs a design decision — ids only, so URLs carry ULIDs or a slug returns |
| `flow-relationships` | ✓ | B7 must be fixed first |
| `flow-sprints` | ✓ | B6 must be fixed first |

**Design decisions the UI needs, which are not bugs:**

- **Identity is global tracker state.** One `.loctt/.current-user` file,
  no session or token. `POST /api/user/switch` changes identity for every
  tab and every concurrent CLI/MCP process. `getCurrentUser` also *writes
  on a GET* when self-healing a stale pointer.
- **No auth model.** CSRF header check plus `127.0.0.1` binding only.
- **Body save semantics contradict.** `markdown-extensions.md:110-120`
  mandates explicit-save; `flow-tasks.md` TSK-15 mandates 1.5s idle
  autosave. The 15-minute `body_edited` coalescing window only makes
  sense under autosave.
- **SET-3 and SET-6 contradict each other** in `flow-settings.md`.

---

## 5. Documentation defects

Docs that will actively mislead, independent of any code fix.

| Doc | Problem |
|---|---|
| `schema-reference.md:446-540` | Stale key-era spec: documents `key`/`--label` where code has `id`/`--name`. Every worked example fails or misbehaves. |
| `cli/reference.md:186-293` | Same stale key-era spec. |
| `schema-reference.md:402-440` | Documents a project `key`+`label` schema that does not exist. |
| `cli/reference.md:116-121` | Documents a `--label` flag the CLI never reads; copied examples silently create a project named `web`. |
| `task/create.ts:17` | Says `project` "matches `ProjectDef.key`"; there is no `key` field — it is the ULID. |
| `cli/reference.md:322` | Promises `--status` "defaults to the first status in workflow.yaml". Nothing implements it. **Needs a product decision: doc bug or unimplemented spec?** |
| `configuration.md:146` | Claims `searchable` defaults to `true`; it is required, so following the doc is a parse error. |
| `schema-reference.md:325` | Says at most one `structural` relationship — **the shipped default violates it** (`blocks` and `parent`), and nothing enforces it. |
| `markdown-extensions.md:33` | Specifies `@user:<uuid>`; `MENTION_RE` has no `:`, so every mention collapses to the token `"user"` and fires on `a@b.com` and inside code spans. |
| `architecture.md:201` | Says sparse worktree; it is a full worktree. |
| `mcp/reference.md:54` | Documents `set_user_setting`, which exists nowhere. |
| `tests/README.md:338` | Documents a mid-reconcile abort test that does not exist. |
| `git.ts:16-18`, MCP `enable_git` | Both assert behaviour the code does not implement. |
| **Undocumented but implemented** | `boards`, `timeline`, `estimation.weights`, `icon`/`color`, `relationships[].kind`, all of `list-view.yaml`, `_comments.yaml`, task export, single-quoted strings, operator precedence, `status.category`, array-field semantics |

---

## 6. What passed

Recorded so the next audit need not re-derive it.

- **Attachment security** — traversal defended at three layers, symlinks
  and dotfiles rejected, size capped pre-copy and mid-stream, downloads
  forced to octet-stream + nosniff + RFC 5987. No traversal escape
  reachable. **[verified]**
- **Avatar security** — `lstat` symlink guard at `server.ts:1356`;
  symlinking `avatar.jpg` → `/etc/passwd` yields 400 with no bytes
  served. **[verified]**
- **DSL injection** — closed via `dslAtom`. **[verified]**
- **Git worktree isolation** — temporary worktrees under
  `.loctt/local/.worktree-*`, removed in `finally`; user's branch, HEAD,
  and dirty files untouched across dirty-tree and detached-HEAD repos.
  **[verified]**
- **Migration safety** — atomic sentinel, single pre-migration backup,
  verified idempotent, state-lock→migration-lock handoff closes the
  TOCTOU. **[verified]**
- **Sprint `id` immutability** — renaming never detaches tasks; no
  automatic state transitions or carryover have crept in. **[verified]**
- **Project id resolution** — all surfaces resolve consistently via
  `resolveProjectIdFromInput`; no filtering-corruption risk. **[verified]**
- **Stored keys, not labels** — the CLAUDE.md invariant holds on every
  write path tested. Archived guard applied on all three surfaces.
- **Core unit coverage** — genuinely strong: concurrent appends,
  coalescing, actor attribution, crash-recovery journal, multi-user
  settings isolation.

---

## 7. Suggested order of work

Grouped by what unblocks what, not by severity alone.

**1 — Stop the bleeding (data loss).** B1–B4. Either wire up the
reconciliation that already exists and is already unit-tested, or gate
git-sync behind a warning until it is. B3 additionally needs
`.schema-version` excluded from the mirror.

**2 — One-line fixes with disproportionate payoff.** B7 (pass
`workflowConfig`, mirroring the line 14 above it), B8 (three characters:
`[` → `(`), B11 (add `updated_at` to `USER_IMMUTABLE_FIELDS`). Fix the
three suites that assert the broken behaviour at the same time — the code
fix will turn them red, which is the point.

**3 — Structural, before UI work starts.** B16 (error envelope) and B5
(concurrency control) are both load-bearing for seven flow docs. Neither
gets cheaper later, and both are hard to retrofit once clients depend on
the current shapes.

**4 — Wire the orphans.** B18, B19, B20. Core is written and tested;
this is surface plumbing. Decide per capability whether it lands on all
three surfaces or is deliberately UI-only.

**5 — Correctness.** B6, B9, B10, B12, B13, B14, B15, B17.

**6 — Docs.** Section 5 above. The stale key-era sections are the
priority — they actively mislead anyone following a worked example.

**Product decisions needed before some of the above:** the `--status`
default (doc bug or missing feature), `?project=web` URLs (ULIDs or
reintroduce a slug), body-save semantics (autosave or explicit),
`PRU-18` counter restoration (code and doc disagree deliberately),
and SET-3 vs SET-6.

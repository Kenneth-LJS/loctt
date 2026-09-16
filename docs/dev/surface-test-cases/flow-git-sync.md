# Git-backed mode

Enable/disable, publish, sync, reconciliation, and status reporting.

See [README.md](README.md) for conventions.

> **ALL CASES BUILT (2026-09-17).** This flow is complete: every GIT-*
> case (GIT-1..GIT-38, plus the GIT-C* surface cases) has a `@verifies`
> test. The four data-loss failures (branch mirrored over local state;
> local-only tasks deleted; `.schema-version` overwritten; foreign branch
> destroyed on publish) are fixed in `packages/core/src/git/three-way.ts`;
> the reconcile engine (field-level merge, rekey preview+confirm,
> delete-vs-edit), error quality (push/fetch classification, named
> worktree/malformed errors), force-push refusal, newer-schema refusal,
> fstype advisory, sync progress, adopt-branch prompt, and the stale-tab
> wrong-task guard all landed 2026-09-16/17. See known-gaps.md
> (GIT-9/16/… block) for the per-case commit + decision map.

---

## A. Reconciliation (built as of A121 / commit e99bfec, 2026-09-04)

> **STALE-BANNER CORRECTION (see decisions.md A188).** An earlier version
> of this section claimed the reconciliation engine had "zero production
> call sites." That is no longer true. `rekeyCollisions`,
> `mergeRelationships`, `mergeKeyHistory`
> (`packages/core/src/git/reconcile.ts`), `computeReconcilePlan`
> (`reconcile-plan.ts`), `applyReconcile` (`reconcile-apply.ts`), and the
> `reconcile.yaml` lifecycle (`state/reconcile.ts`) are **wired into
> production** — `computeReconcilePlan` is called at
> `publish-sync.ts:968,1213`, and the web UI drives it via
> `ReconcilePanel.tsx`. The cases below (GIT-C1..) are the acceptance
> criteria for that engine; treat them as *covered*, not aspirational,
> except the genuinely-unbuilt residual (GIT-8/9/16/19/21/22/23/25/33/34/
> 35/36 — see A188). GIT-29 (push rejected: auth vs non-fast-forward) and
> GIT-30 (fetch against an unreachable remote) are now **built**
> (`classifyRemoteFailure` in `publish-sync.ts`, surfaced by the panel,
> CLI, and MCP — see the GIT-29/30 UI cases in
> [`../ui-test-cases/flow-git-sync.md`](../ui-test-cases/flow-git-sync.md)).
> Sync no longer merely *stops* on divergence; it plans a per-field
> reconciliation.

### GIT-C1 · blocker · P1 P10 · CLI MCP
**Two edits to different fields of one task merge instead of conflicting.**

- Local changes `status` while the branch changes `title` on the same
  task: sync succeeds and the result carries both.
- `relationships` merge by union of `(type, target)` pairs.
- `key_history` merges by union.
- Disjoint custom-field keys merge side by side.
- Same-field disagreement still stops with a conflict naming the task and
  the field — not the whole file.
- CLI and MCP produce identical results for identical inputs.

**Given** a task edited locally on `status` and on the branch on `title`,
**when** sync runs, **then** it succeeds and the task carries the local
status and the branch title.

### GIT-C2 · blocker · P1 · CLI MCP
**Two clones creating tasks offline do not collide on keys.** Without
`rekeyCollisions` wired up, both can claim the same key; today the second to
sync hits a conflict on `state.yaml` rather than being rekeyed.

- After both publish, every task has a distinct key.
- The task with the earlier `created_at` keeps the key; the ULID `id`
  breaks ties.
- The rekeyed task's old key appears in its `key_history` and still
  resolves.
- Both surfaces report which tasks were rekeyed.

**Given** clones A and B each creating a task offline that lands on the same
key, **when** both sync, **then** one is rekeyed, its old key still
resolves, and the operation names the change.

### GIT-C3 · major · P4 P6 · CLI MCP
**An interrupted reconciliation is resumable.** `reconcile.yaml` is
specified and implemented but never written.

- A reconciliation interrupted partway leaves a state file naming what was
  in progress.
- The next sync detects it and either resumes or reports how to abort.
- A completed reconciliation clears it.
- No partial merge is left applied with no record of it.

**Given** a reconciliation killed mid-run, **when** sync runs again,
**then** it names the interrupted operation rather than starting over
blindly.

---

## B. Error quality

### GIT-C4 · blocker · P4 · CLI MCP
**A failed push is reported as a failure.** `last_synced_commit` advances
after a failed push, and push/fetch failures exit 0 with a mangled message.

- With an unreachable or rejecting remote, `loctt git publish` exits
  non-zero.
- stdout does not contain an unqualified `Pushed to remote`.
- The message states the local commit succeeded and gives the retry
  command.
- `last_synced_commit` does **not** advance past what the remote actually
  has.
- MCP `publish_to_git` distinguishes local-commit-succeeded from
  push-failed and names the cause, rather than presenting full success.

**Given** an unreachable remote, **when** publish runs on each surface,
**then** both report the push failure distinctly from the local commit and
neither advances the synced marker.

### GIT-C5 · major · P4 · CLI MCP
**Git failures are named, not passed through raw.** All four mutating web
handlers catch bare `err` and return 400 with raw git stderr;
`GitSyncError` is imported nowhere in the server.

- A merge conflict, a missing remote, and an auth failure each produce a
  distinct, named error on every surface.
- No response body contains raw `git` stderr as its only content.
- `GitConflictError` is distinguished from other git failures, and the
  paths it carries reach the caller.
- HTTP responses use a status matching the cause — 409 for conflict, not
  400 for everything.

**Given** each of the three failure modes, **when** triggered on each
surface, **then** each is named distinctly and none surfaces raw stderr
alone.

---

## C. Status and setup

### GIT-C6 · major · P4 P6 · CLI MCP
**Git status reports drift, not just configuration.** `getGitStatus`
returns a config echo plus an `isGitRepo` boolean. (An earlier note here
said "there is no git UI at all today" — stale; `GitSyncPanel.tsx` and
`ReconcilePanel.tsx` now exist and render this status. See A188.)

- The result includes separate local-drift and remote-drift indicators.
- It includes a remote-configured boolean distinct from the remote name.
- With no remotes configured, the remote line marks it as not configured
  rather than naming a remote that does not exist.
- With `origin` configured, it names `origin`.
- The shape is sufficient to render "N local changes, M remote changes,
  last synced <when>" without further calls.

**Given** a tracker with local edits and a branch that moved, **when**
status is read, **then** both drift directions are visible in the result.

### GIT-C7 · major · P4 P5 · CLI
**`loctt git enable` on a repo with an existing `loctt` branch is
deliberate.** Publish now refuses to adopt a branch holding foreign content;
enable should surface the same choice up front.

- With an existing `loctt` branch, non-interactive enable reports the
  branch head and either requires an explicit adopt flag or exits non-zero
  explaining the choice.
- Adopting a branch that holds non-LocTT content is refused, naming the
  files in the way.
- The message names the config key for choosing a different branch.

**Given** a repo whose `loctt` branch holds unrelated work, **when** enable
runs, **then** the user is told before anything is written.

### GIT-C8 · major · P4 P10 · MCP
**`enable_git`'s description matches what it does.** Both
`apps/cli/src/commands/git.ts:16-18` and the MCP `enable_git` description
assert behaviour the code does not implement.

- After `enable_git` on a fresh repo, either a `loctt` branch exists
  (matching the description) or the description no longer claims branch or
  worktree setup.
- `get_git_status` immediately afterwards reports the same branch name the
  tool claimed to create.

**Given** a fresh git repo, **when** `enable_git` is called, **then** the
observable result matches the tool's own description.

### GIT-C10 · major · P10 · CLI MCP
**Every git operation honours a reconfigured `git.branch`.** The branch is
user-configurable (`packages/core/src/config/router.ts:65`, default
`loctt`), so nothing may assume the literal name — not the docs, not the
code, not a test fixture.

- After `loctt config set git.branch my-tasks`, publish creates and writes
  to `my-tasks`; no branch named `loctt` is created.
- Sync reads from `my-tasks`, and its 3-way base resolves against that
  branch's history — a task published before the rename survives.
- A task created locally and never published survives a sync of the
  renamed branch.
- The foreign-content adoption guard fires on the *configured* branch: a
  pre-existing `notes` branch holding unrelated work is refused, not
  overwritten.
- `loctt git status` reports the configured name, not the default.
- The same holds through MCP `publish_to_git` / `sync_from_git`.
- Enabling git mode, renaming the branch, and disabling leaves no
  stray `loctt` ref behind.

**Given** a tracker with `git.branch` set to `my-tasks`, **when** publish
and sync run, **then** all state lands on `my-tasks`, no `loctt` ref is
created, and local-only work survives.

### GIT-C9 · minor · P4 · CLI
**Enable on a non-git directory leaves nothing behind.** Partially covered
by `tests/integration/git/no-remote.test.ts:52`, which asserts the exit code
but not the absence of side effects.

- Exits non-zero naming the directory.
- No `local/sync.yaml` was created.
- No `loctt` ref exists afterwards.

**Given** a non-git directory, **when** `loctt git enable` runs, **then** it
fails and leaves no partial state.

# Flow: git-backed mode

Covers Settings → Git sync (M4.3): enabling and disabling git-backed
mode, Publish, Sync, the status readout, the reconciliation panel, and
the rekey pass that follows reconciliation. The underlying model —
3-way base/local/remote, auto-mergeable vs conflict fields, rekeying
rules — is [git-sync.md](../../user/common/git-sync.md). The settings
shell hosting this panel is in [flow-settings.md](flow-settings.md);
project key counters that rekeying draws from are in
[flow-projects-users.md](flow-projects-users.md).

## A. Happy path

### GIT-1 · M4 · blocker · P4 P10
**Enabling git-backed mode says what it will do first.** A git repo with a remote, git sync not yet enabled.

- The panel's initial state says git sync is off and that LocTT works fine without it.
- **Enable** states before running: it will create a dedicated `loctt` branch, published through a temporary worktree, and that `local/`, `.current-user`, and `users/<id>/settings.yaml` are gitignored and never published.
- After enabling, `local/sync.yaml` contains `git.enabled: true` and `git.branch: loctt`; `loctt git status` in a terminal agrees.
- The panel flips to the enabled layout showing Publish, Sync, and Status; the branch name is displayed, not assumed.

### GIT-2 · M4 · blocker · P1 P4
**Publish reports what changed, not "OK".** Three tasks edited locally since the last sync; remote unchanged.

- **Publish** states before running that it will push local `.loctt/` state into the `loctt` branch, and names the branch and remote it will push to.
- The result names the three tasks by key and says what changed about each at field granularity (e.g. `WEB-3` status, `WEB-9` title and due date).
- The result reports the new `last_synced_commit`, and `local/sync.yaml` records that same commit.
- A second Publish with nothing changed reports "nothing to publish" as a distinct outcome from a successful push — not the same success message.

### GIT-3 · M4 · blocker · P1 P4
**Sync reports what it pulled in.** Remote has two new tasks and one changed task; local unchanged since the last sync.

- **Sync** states before running that it will pull `loctt` branch state into the local workspace.
- The result distinguishes created from updated: two tasks created (named by key), one updated (named, with the fields that changed).
- The pulled tasks are present on disk under `tasks/<ulid>/` and appear in the list without a page reload.
- `local/sync.yaml`'s `last_synced_commit` advances to the remote commit.
- A Sync when the remote has not moved reports a no-op explicitly rather than a generic success.

### GIT-4 · M4 · major · P4 P6
**Status shows the last synced commit and drift indicators.**

- Status names the branch, the remote, and the short `last_synced_commit` from `local/sync.yaml`.
- It shows local drift (number of locally-changed tasks since that commit) and remote drift (number of remote-changed tasks) as two separate counts, not one combined "out of sync".
- With both counts at zero it says so plainly and both Publish and Sync are still available but labelled as no-ops.
- The counts refresh on demand and the panel says when it last checked, so a stale zero is not mistaken for a fresh one.

### GIT-5 · M4 · blocker · P1 P4
**Auto-mergeable fields merge without opening the reconciliation panel.** Base task `WEB-3`. Locally a `blocks → WEB-9` relationship was added; remotely a `depends_on → WEB-12` was added. Locally custom field `team` was set; remotely custom field `story_points` was set.

- Sync completes without opening the reconciliation panel and without asking the user anything.
- `WEB-3` ends up with **both** relationships — the union of `(type, target)` pairs — not one overwriting the other.
- `WEB-3` ends up with both `fields.team` and `fields.story_points`, because different custom field keys changed on each side.
- `key_history` on any task that gained entries on both sides is the union of both lists, with no duplicates.
- The result names `WEB-3` and states that these fields were auto-merged, so the merge is visible rather than silent.

### GIT-6 · M4 · blocker · P4 P5
**The reconciliation panel lists conflicting fields with both sides.** `WEB-3` has a different `title` and a different `status` locally and remotely; `WEB-9` has a different `due_date`.

- Sync stops and opens the reconciliation panel instead of picking a winner; the result does not say "synced".
- The panel lists three rows — `WEB-3` title, `WEB-3` status, `WEB-9` due date — each showing the local value and the remote value side by side, with `status` shown as the user's configured *label*, not the raw key.
- Each row offers keep-local, keep-remote, and pick-value, with pick-value accepting a third value entirely.
- **Apply** is disabled until every row has a choice; the count of undecided rows is shown.
- Nothing is written to disk before Apply — `task.md` for both tasks is byte-identical to before while the panel is open.

### GIT-7 · M4 · blocker · P1 P4
**Applying reconciliation writes the chosen values and completes the operation.** From the GIT-6 state, with keep-local on the title, keep-remote on the status, and a typed third value for the due date.

- Apply reports each resolution back — three fields resolved, named by task and field with the value that won.
- `WEB-3`'s frontmatter now has the local title and the remote status; `WEB-9`'s `due_date` is the typed value.
- `local/reconcile.yaml` is cleared on success.
- The originally-requested operation then completes: the sync (or publish) finishes and `last_synced_commit` advances, reported in the same result.

### GIT-8 · M4 · blocker · P1 P10
**Rekeying prints a summary before applying.** After reconciliation, `WEB-14` exists on both sides as two genuinely different tasks with different ULIDs.

- A rekey summary is shown **before** anything is written: which key collided, which task keeps it, which task is renumbered, and what the new key will be.
- The keeper is the task with the earlier `created_at`; the summary states that rule and shows both timestamps.
- The user must confirm; there is no auto-apply of a rekey.
- After confirming, the loser's `key` is the next key from `state.yaml` for its project (e.g. `WEB-31`) and `WEB-14` is appended to its `key_history`.
- Opening `/tasks/WEB-14` still resolves — to the keeper — and searching for the loser's old key finds the loser via `key_history`.

### GIT-9 · M4 · major · P1 P10
**ULID breaks a `created_at` tie during rekey.** Two tasks claim `WEB-14` with identical `created_at`.

- The summary states that timestamps tied and that the ULID decided, and shows both ULIDs.
- The lower ULID keeps the key; the tiebreak is deterministic — re-running the same reconciliation on a second machine picks the same keeper.
- The outcome matches what `loctt git sync` would have produced on the same inputs.

### GIT-10 · M4 · major · P4 P5
**Disabling git-backed mode says what it does and does not do.**

- **Disable** states before running that it stops publishing and syncing, and states explicitly whether the `loctt` branch and its history are left intact (they are) — so it does not read like a delete.
- After disabling, `local/sync.yaml` records `git.enabled: false` and Publish/Sync are hidden or disabled rather than left clickable.
- No task files are modified by disabling; the list is unchanged.
- Re-enabling restores the panel and reports the previously recorded `last_synced_commit` rather than treating the tracker as never-synced.

## B. Edge cases

### B1. Conflict shape and scale

### GIT-11 · M4 · blocker · P1 P4
**The same custom field key changed to different values is a conflict, not a merge.** `fields.team` set to `platform` locally and `infra` remotely.

- Reconciliation opens with a row for `WEB-3` `fields.team` showing both values.
- This is the counterpart to GIT-5 — the panel treats different-keys as merge and same-key as conflict, and the two behaviours are visibly distinct in the same sync.
- For an enum-typed custom field, both sides render as their configured labels, and pick-value offers the declared enum values rather than a free-text box.

### GIT-12 · M4 · blocker · P4 P9
**A conflict on 30 tasks at once.**

- The panel groups rows by task with a per-task collapse, so the user is not scrolling one flat list of 90 rows.
- Bulk actions exist — keep all local, keep all remote — and applying one still leaves every row individually re-overridable before Apply.
- The undecided count is accurate across all 30 tasks and updates as bulk actions are used.
- Apply reports the full outcome: number of tasks resolved and, where a task's resolution failed, which ones — it does not report 30 successes when 28 were written.
- The panel remains responsive; it virtualises or paginates rather than rendering 90 rows at once.

### GIT-13 · M4 · major · P4
**`parent` conflicts are shown as tasks, not raw ULIDs.** Local sets `parent` to `WEB-2`; remote sets it to `WEB-7`.

- Both sides render as the task key plus title, with the ULID available but not the primary display.
- Pick-value offers a task picker, not a free-text ULID box.
- Choosing keep-remote leaves the corresponding inverse `child` edge consistent — the losing parent's child edge is removed, not left dangling (verifiable on `WEB-2`).

### GIT-14 · M4 · major · P3 P7
**A conflicting value references a status that no longer exists locally.** Remote's `status` is `in_review`, which was deleted from local `workflow.yaml`.

- The remote side renders the raw key with a drift marker saying it is not in the local `workflow.yaml`, rather than blank.
- Choosing keep-remote is allowed but warns that the task will render with a drift marker and appear in Diagnostics.
- Pick-value offers only the statuses that actually exist locally.

### GIT-15 · M4 · major · P1 P4
**Publish with both sides changed runs reconciliation before the push.** Local and remote both diverged from base.

- Publish does not push and then ask; it detects divergence, reports it, and opens reconciliation first.
- The reconciliation panel says it was opened by a **publish** (matching `local/reconcile.yaml`'s `mode: publish`), so the user knows what completes after Apply.
- After Apply, the push proceeds and the result reports both the reconciliation outcome and the pushed commit.
- If the user abandons the panel, nothing was pushed — the remote branch head is unchanged.

### GIT-16 · M4 · major · P4
**One side deleted a task the other side edited.**

- This is surfaced explicitly rather than resolved by either side winning silently.
- The row states the situation in plain terms: this task was deleted on one side and edited on the other, naming which is which.
- The choices are keep-the-deletion and keep-the-task; whichever is chosen is reported by key in the result.
- Keeping the task does not resurrect it with a colliding key without going through the normal rekey summary.

### GIT-17 · M4 · minor · P1 P4
**All conflicts resolve to values identical on both sides.** Both sides changed `title` to the same string.

- This is not presented as a conflict at all — the shared value wins automatically and the row does not appear in the panel.
- If it is the only difference, the sync completes without opening the panel.
- The result still mentions the task, so the user knows the field converged rather than being untouched.

### B2. Concurrency and interrupted state

### GIT-18 · M4 · blocker · P1 P4
**Reconciliation was interrupted halfway and `local/reconcile.yaml` is still present.** The panel is opened fresh.

- The panel detects the file on load and says a reconciliation is already in progress, showing its `mode`, `base_commit`, `remote_commit`, and `started_at`.
- Publish and Sync are blocked while it is present, with the block stating that the in-progress reconciliation must be finished or abandoned first — they do not silently start a second one.
- Resume reopens the panel with the decisions already made preserved where the file recorded them.
- Abandon is offered as a distinct, confirmed action that clears `local/reconcile.yaml` and states that local files are left exactly as they are — it is not framed as a revert.

### GIT-19 · M4 · blocker · P1 P4
**A rekey affects a task the user has open in another tab.** Tab A is on `/tasks/WEB-14`; tab B applies a rekey that renumbers that task to `WEB-31`.

- Tab A does not keep silently presenting `WEB-14` as the task's key after the rekey.
- Tab A either follows the rekey (URL and header update to `WEB-31`, with a note explaining the change and the old key listed under `key_history`) or shows an explicit stale-view state offering to reload — it never presents a stale key as authoritative.
- An edit submitted from tab A after the rekey is applied to the right task by id, or refused with an explanation — it never lands on the *other* task that now holds `WEB-14`.
- Reloading tab A on the old URL still resolves via `key_history` and lands on the same task.

### GIT-20 · M4 · major · P1
**The CLI publishes while the UI's panel is open.** `loctt git publish` runs in a terminal with the Status panel visible.

- The next status refresh shows the advanced `last_synced_commit` and the drift counts back at zero.
- The panel does not offer to publish changes that were already published, and does not report a phantom local drift.
- If the user clicks Publish anyway, the result is the "nothing to publish" no-op, not an error.

### GIT-21 · M4 · major · P4 P7
**The `loctt` branch was force-pushed and no longer contains the last synced commit.**

- Sync detects that `last_synced_commit` is not an ancestor of the remote head and stops.
- The message says the branch history was rewritten, names the commit that can no longer be found, and does not present the situation as a routine conflict.
- It does not silently re-base the comparison on the new head — doing so would discard local changes made since the missing base.
- The offered next actions are concrete: inspect the branch in git, or re-establish a base explicitly; both state what would happen to local changes.

### GIT-22 · M4 · major · P4 P7
**The tracker lives on iCloud Drive or a network share.** Git sync operations require the state lock for key allocation during rekey.

- Enabling git sync in such a location surfaces a warning naming the filesystem class (NFS / SMB / Dropbox / iCloud Drive / OneDrive) and stating that POSIX advisory locks are not reliable there.
- The warning is shown at enable time, not only after a failure, and the operation can still proceed — it warns rather than silently corrupting.
- If a rekey then fails on lock contention, the failure names the lock and repeats the filesystem caveat rather than offering a bare retry.

### GIT-23 · M4 · major · P1 P9
**A sync brings in 500 new tasks.**

- The operation reports progress rather than sitting on an indefinite spinner.
- The result reports the true count and does not enumerate 500 keys inline — it summarises with counts and offers the full list on expand.
- The list view reflects the new population and its total count is honest; pagination is not stuck at the pre-sync total.
- Sidebar count badges for saved views recompute.

### GIT-24 · M4 · minor · P1
**A publish that only touches gitignored files is a no-op.** Only `users/<id>/settings.yaml` and `.current-user` changed since the last sync.

- Publish reports nothing to publish and does not create an empty commit.
- The panel's local-drift count does not include gitignored files — a theme change does not read as unpublished work.
- `last_synced_commit` is unchanged.

### GIT-25 · M4 · minor · P4
**Enabling git sync when a `loctt` branch already exists from a previous setup.**

- Enable states that an existing `loctt` branch was found and shows its head commit before adopting it.
- It asks whether to adopt the existing branch or stop, rather than silently overwriting it.
- Adopting sets `last_synced_commit` and reports whether local state currently agrees with that branch, so the user is not left guessing whether a sync is needed.

### GIT-26 · M4 · minor · P2
**The reconciliation panel is a designed state, not a modal that loses work on navigation.**

- Navigating away with decisions made and coming back preserves them (from `local/reconcile.yaml`), or warns clearly before discarding them.
- The panel is reachable again from Settings → Git sync while `local/reconcile.yaml` exists — the user does not have to re-trigger the sync to get back to it.
- Closing the browser and reopening the app returns to the same in-progress state.

## C. Error cases

### GIT-27 · M4 · blocker · P4
**Git sync enabled on a repo with no remote.**

- Enable either refuses with a message naming the missing remote and the command to add one (`git remote add origin <url>`), or succeeds in a local-only mode that the panel labels explicitly.
- If it succeeds local-only, Publish states up front that there is no remote to push to and what will happen instead — it does not claim a successful push.
- Status does not display a remote name it does not have.

### GIT-28 · M4 · blocker · P4
**The directory is not a git repository at all.**

- Enable is disabled with a stated reason naming the directory and saying it is not a git repository.
- The next action is concrete: run `git init` in that directory, or move the tracker into an existing repo.
- No `loctt` branch or `local/sync.yaml` is created by the failed attempt.

### GIT-29 · M4 · blocker · P4
**Publish fails because the push is rejected.** The remote rejects a non-fast-forward push, or authentication fails.

- The two causes are distinguished: a rejected push says the remote moved and recommends Sync first; an auth failure names authentication and points at the user's git credentials.
- Either way the message states the local state was not modified by the failed push.
- `last_synced_commit` is unchanged and the local-drift count still reflects the unpublished work — it does not reset to zero.
- Retry is offered and, for the non-fast-forward case, Sync is offered as the recommended action rather than only Retry.

### GIT-30 · M4 · blocker · P4
**Sync fails because the remote is unreachable.** Network down or the host does not resolve.

- The message names the remote and says it could not be reached, distinguishing this from "nothing to sync".
- Local state is untouched and the panel says so explicitly.
- Retry is offered; the panel does not enter a permanent error state that requires a reload after the network returns.

### GIT-31 · M4 · blocker · P4 P5
**Publish reports success while reconciliation is still pending.** The assertion is that it must not.

- With `local/reconcile.yaml` present, Publish is blocked, not attempted — the block names the in-progress reconciliation.
- With the reconciliation panel open and rows undecided, Apply is disabled and no push occurs.
- At no point does the panel show a success state, a fresh `last_synced_commit`, or a cleared drift count while conflicts remain unresolved.

### GIT-32 · M4 · blocker · P4 P5
**Apply fails partway through a 30-task reconciliation.** 18 tasks are written, then a write error.

- The result reports the true split: 18 applied (named or counted), 12 not applied, naming the failure on the one that broke.
- `local/reconcile.yaml` is **not** cleared — the operation is resumable and the panel says so.
- Reopening the panel shows the remaining 12 rows with their decisions preserved; the 18 already applied are not offered again.
- The originally-requested publish or sync did not proceed; `last_synced_commit` is unchanged and the panel says the operation is incomplete.

### GIT-33 · M4 · blocker · P4 P5
**Rekey fails after the summary was confirmed.** Key allocation from `state.yaml` fails on the third of five renumbers.

- The result names which tasks were rekeyed (with old and new keys) and which were not.
- The tasks that were rekeyed have their old keys in `key_history` and still resolve by those keys — no key is lost in the partial state.
- The message states plainly that keys now collide for the remaining tasks and what the user should run to finish.
- The UI does not report the rekey as complete, and the collision is surfaced in Diagnostics (see [flow-settings.md](flow-settings.md) SET-14).

### GIT-34 · M4 · major · P4 P7
**The `loctt` branch contains files that fail schema validation.** A remote task has malformed frontmatter.

- Sync reports the specific file that failed to parse, by task id, and states whether the rest of the sync was applied.
- One bad file does not abort the whole sync silently, nor does it get written into the local tracker as-is without mention.
- The list view still renders — the bad task shows a designed broken-file state rather than taking the page down.
- The next action names the file to inspect.

### GIT-35 · M4 · major · P4 P7
**The remote was written by a newer schema version.** The `loctt` branch carries a `.schema-version` greater than the local `CURRENT_SCHEMA_VERSION`.

- Sync refuses and says the remote was written by a newer LocTT, naming both versions.
- The next action is to upgrade LocTT — not to migrate, which would be a downgrade.
- Nothing from the remote is written locally; the local `.schema-version` is untouched.

### GIT-36 · M4 · major · P4
**The publish worktree is missing or corrupt.** The worktree directory was deleted by hand.

- Publish and Sync fail with a message naming the worktree and the fact that it is missing, rather than an opaque git error.
- The panel offers a concrete repair path (re-establish the worktree, or disable and re-enable git sync) and states what each does to local task files.
- Local task files are not modified by the failed operation.

### GIT-37 · M4 · major · P4
**A conflicting task file becomes unwritable during Apply.** File permissions changed mid-operation.

- The row for that task is reported as failed, naming the file path and the permission problem.
- Other rows that succeeded are reported as succeeded — this is the same honest partial-report bar as GIT-32.
- Retry after fixing permissions re-applies only the failed rows.

### GIT-38 · M4 · minor · P4 P6
**Sync is triggered while a previous sync is still running.**

- The second trigger is refused with a message saying a sync is already in progress, rather than starting a second concurrent operation.
- The in-progress operation's controls are disabled while it runs, so the double-trigger is hard to reach by misclick in the first place.
- If the first operation dies without clearing state, the panel recovers on reload rather than staying permanently locked out — and if `local/reconcile.yaml` was left behind, GIT-18's in-progress state applies.

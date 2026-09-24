# Flow: cross-surface

The UI against the CLI, the MCP server, and the filesystem itself.
`.loctt/` is the source of truth and all three front-ends write to it
concurrently, so this doc covers what happens to an open browser tab
when someone else moves the ground underneath it: concurrent writes,
config rewritten mid-session, schema-version drift, the key-lookup
cache, locks, and query-language parity. The domain behaviour of each
view lives in its own flow doc — [flow-tasks.md](flow-tasks.md),
[flow-list.md](flow-list.md), [flow-saved-views.md](flow-saved-views.md),
[flow-settings.md](flow-settings.md) — and git publish/sync mechanics
are [flow-git-sync.md](flow-git-sync.md). The generic quality bar every
error message here must clear is [flow-error-handling.md](flow-error-handling.md).

## A. Happy path

### Freshness and refresh

### XS-1 · M1 · blocker · P1
**A task edited in the CLI while the UI shows it converges without a manual reload.** With `/list` open, run `loctt set T-12 priority high` in a terminal.

- Within the documented staleness window (see XS-2) the row for `T-12` shows the new priority.
- Convergence happens without the user pressing browser reload; if the mechanism is refetch-on-focus, clicking back into the tab is sufficient and is documented as the trigger.
- Nothing else in the list is disturbed: scroll position, selection, sort, and active filters survive the refetch.
- The refreshed value matches `loctt show T-12` exactly — the UI does not render a merged or interpolated value.

### XS-2 · M1 · blocker · P1 P4
**The staleness window is a stated, bounded number, not "eventually".** Inspect the refetch configuration and observe a CLI write landing under an idle tab.

- Whatever the mechanism (interval polling, refetch-on-window-focus, refetch-on-reconnect, manual refresh control), it is documented in one place and the maximum time a value can be wrong is a finite number.
- An idle background tab left open overnight, brought to the foreground, shows current data before the user can act on a stale value — i.e. focus is a refetch trigger, not only time.
- No view is configured with an infinite `staleTime` such that a value can be wrong for the lifetime of the tab.

### XS-3 · M1 · major · P1 P8
**Reloading the page is the refresh: it shows fresh data in the same view.** On `/list` with filters and a sort applied, and on `/tasks/$key`, change a task from the CLI, then press F5.

- The reloaded page shows the CLI's change.
- The view is unchanged: the same filters, sort and page on `/list`, the same task on `/tasks/$key`, because no view state lives only in React.

> **Amended (K122, Ken 2026-09-23).** This case asked for a manual
> refresh control, which Q4 deliberately does not build (data refetches on
> tab focus and within the staleness window). Asked, Ken: *"user can
> refresh the page for this, no?"* — so the reload guarantee is the case.

### XS-4 · M2 · blocker · P1
**An open task detail picks up a CLI edit to a field the user is not editing.** Open `/tasks/T-12`, then run `loctt set T-12 status done` in a terminal.

- The status row updates to the new value within the staleness window.
- Fields the user has actively focused or has pending unsaved edits in are not clobbered by the refetch — an in-progress edit survives a background refresh of other fields.
- The detail footer's `updated_at` relative time reflects the CLI write, so the user can see something changed and when.

### XS-5 · M1 · major · P1
**A task created in MCP appears in an open UI list.** With `/list` open on an unfiltered view, have an agent call `create_task`.

- The new task appears in the list within the staleness window without a manual reload.
- The `total` count in the pagination footer increases by one — the count is recomputed, not cached from the first load.
- If the new task does not match the current filter, it does *not* appear, and the count does not change; the filter is honoured rather than bypassed.

### XS-6 · M1 · major · P1 P9
**A bulk CLI operation landing under a UI list is reflected accurately, not partially.** With `/list` showing 50 rows, run a loop that archives 30 of them from the CLI.

- After refetch the list reflects all 30 archives, not a subset — the UI does not merge a fresh page 1 with a stale page 2.
- The `total` and the "Showing 1–50 of N" text agree with `loctt list --query ... ` run immediately after.
- If pagination has loaded multiple pages, the refetch either refreshes all loaded pages or resets to page 1 with a visible indication — it never leaves inconsistent pages stitched together.

### Field-level writes

### XS-7 · M2 · blocker · P1 P10
**The UI sends field-level updates, never a whole-object PUT.** Inspect the network request produced by changing priority on `/tasks/T-12`.

- The request body contains only the changed field (or the changed field set for an atomic multi-field edit), matching core's `setField` / `setFields` semantics.
- The body does not contain `title`, `body`, `labels`, or any other field the user did not touch.
- The body does not contain `id`, `key`, `key_history`, `created_at`, `project`, `archived`, `archived_at`, `status_updated_at`, `completed_date`, or `board_rank` — the immutable and auto-managed fields MCP and the CLI also reject.

### XS-8 · M2 · blocker · P1
**A concurrent CLI edit to a different field is not clobbered.** Open `/tasks/T-12`, run `loctt set T-12 assignee alex` in a terminal, then — without refreshing — change priority in the UI.

- After both writes, `loctt show T-12` shows the new assignee *and* the new priority. Neither write reverted the other.
- The UI, after refetch, shows both values too.
- This holds even though the UI's cached copy of the task predated the CLI write — because the request carried only `priority`.

### XS-9 · M3 · blocker · P1
**A board drag sends status and board_rank together as one atomic write, and nothing else.** Drag a card to another column on `/board`.

- One request carries both `status` and `board_rank` (per M3.2), not two sequential requests that can half-land.
- No other field is included, so a concurrent CLI edit to assignee on the same card survives the drag.
- An intra-column reorder sends `board_rank` only — the status field is absent from the payload, not resent with its current value.

### XS-10 · M2 · major · P1
**Optimistic updates are reconciled against the server response, not assumed.** Change a field and watch the settled state.

- The optimistic value is replaced by the value the server actually returned; if core normalized it (trimmed, coerced, defaulted), the displayed value is the normalized one.
- The task's `updated_at` shown in the footer comes from the response, not from the browser clock.
- Nothing that exists only in browser state survives a reload — reloading immediately after the write shows the same values.

### Body editing

### XS-11 · M2 · blocker · P1
**The body editor fetches the latest body before writing.** Open `/tasks/T-12`, switch to edit mode, wait, then run `loctt body T-12 --append $'\n\nNote from CLI'` before pressing Save.

- The save request is preceded by a read of the current body — observable as a GET (or a conditional write carrying a base version) immediately before the write.
- The CLI's appended paragraph is not lost.
- If the two edits do not overlap, the result contains both the user's text and the CLI's paragraph; the user is told a merge happened rather than it being silent.

> **Amended (K124, Ken 2026-09-24).** "Before triggering the auto-save" became "before pressing Save": the description saves only on Save (TSK-15). An edit can now stay open for minutes, across a window refocus that refetches the task, so the base version the write carries must survive that refetch.

### XS-12 · M2 · blocker · P1 P4
**A genuine body conflict shows both versions and asks which to keep.** Open the body editor, edit the same region the CLI is about to rewrite, then run `loctt body T-12 --set "Completely different text"` and press Save.

- The UI does not write. It presents a conflict resolution surface naming both sides — the version now on disk and the version in the editor.
- Both texts are shown in full (or scrollable in full), not summarized, not diff-only-with-no-way-to-see-the-original.
- The user is offered explicit choices: keep mine, keep theirs, or keep both — with the outcome of each stated before clicking.
- Whichever choice is made, the resulting file matches exactly what the choice promised, verified with `loctt body T-12`.
- Dismissing the conflict without choosing does **not** write. The editor content is retained so nothing the user typed is lost.

> **Amended (K124, Ken 2026-09-24).** "Let the auto-save fire" became "press Save" (TSK-15).

### XS-13 · M2 · blocker · P1 P4
**A conflict that arrives between the pre-fetch and the write is caught, not lost.** Arrange the CLI write to land in the window after the UI's pre-fetch and before its PUT.

- The write is rejected or detected as conflicting — the pre-fetch alone is not treated as proof of freshness.
- The mechanism is a version/hash/mtime carried on the write and checked server-side, not a client-side timestamp comparison.
- The same conflict surface as XS-12 appears; the CLI's text is not silently overwritten.
- If the design accepts a residual race window, it is documented with its size and the failure mode is last-writer-wins-with-notification, never last-writer-wins-silently.

### XS-14 · M2 · major · P1
**A body save does not resurrect deleted content after a refetch.** Type into the body editor and Save, then run `loctt body T-12 --set ""` in the CLI and wait with no further typing.

- An idle editor with no new keystrokes does not re-write its stale buffer over the CLI's change.
- Saving is dirty-flag driven — no change since the last save means no write, even when Save is pressed.
- The editor either adopts the CLI's empty body or raises the conflict surface; it does not silently restore the old text.

> **Amended (K124, Ken 2026-09-24).** There is no auto-save cycle any more (TSK-15); the case now waits with no typing, and "dirty-flag driven" applies to Save.

### Query and view parity

### XS-15 · M1 · blocker · P10
**A query typed in the UI search box is accepted verbatim by `loctt list --query`.** Type `status = in_progress and priority = high` into the list search box, run it, then paste the same string into `loctt list --query '...'`.

- Both surfaces accept it without modification — no UI-only prefix, no implicit `archived != true` wrapper the CLI would reject.
- Both return the same task set (same keys, same count), modulo pagination.
- The query string as typed is what appears in the URL search params, so copy-paste between the URL and the terminal is lossless.

### XS-16 · M1 · blocker · P10
**A query the CLI accepts is accepted by the UI.** Take each documented construct from [query-language.md](../../user/common/query-language.md) — `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `~`, `and`, `or`, `not`, parentheses, `text`, `parent`, `has_link(...)`, `link_count(...)`, `today`, `true`/`false`, quoted and bare values — and paste each into the UI search box.

- Every one parses in the UI and returns the same result set as `loctt list --query` with the same string.
- No construct produces a UI parse error that the CLI accepts, and none silently returns zero results where the CLI returns rows.
- Custom-field predicates declared in `workflow.yaml` work identically on both surfaces.

> **Amended (K121 #1, Ken 2026-09-23).** A query naming the `archived`
> field (e.g. `archived = false`) is exempted from the UI half of this
> case. Ken's ruling on archived visibility: *"not allow viewing
> archived stuff. thats the point of archiving"* (K121 #1) made the web
> list refuse any query naming `archived` with a 400 pointing at
> Settings → Archived (A331; `queryNamesArchivedField`,
> `ARCHIVED_QUERY_MESSAGE`). For this one construct, "accepted by the
> UI" is replaced by "refused by the UI with the Settings → Archived
> pointer" — the CLI is untouched and still accepts and runs it
> (K30-web precedent: the ruling scopes to the web surface only). Every
> other documented construct keeps the original parity requirement.

### XS-17 · M1 · blocker · P10 P1
**A saved view created in the UI is immediately usable from the CLI and MCP.** Use "Save as view" on `/list` to save a filtered view, then run `loctt views` and the MCP `list_views` tool.

- `.loctt/config/queries.yaml` contains the new entry on disk before the UI reports success.
- `loctt views` lists it with the same name and the same query string the UI showed.
- `loctt list --view <name>` returns the same tasks the UI was showing when it was saved.
- MCP `list_tasks` with `view: <name>` returns the same set.
- The saved view survives a UI restart because it lives in the file, not in browser storage.

### XS-18 · M1 · major · P10 P1
**A saved view created in the CLI or by hand-editing `queries.yaml` appears in the UI sidebar.** Add an entry to `queries.yaml` by hand while the UI is open.

- The Views sidebar group shows the new view within the staleness window or after a refresh, without restarting `loctt ui`.
- Its name renders as authored; the UI does not rewrite or normalize the name.
- Clicking it applies exactly the authored query and, when present, the authored `sort` field/direction list in order.

### XS-19 · M1 · blocker · P10
**Archive and delete mean the same thing in the UI as in the CLI and MCP.** Archive a task in the UI, then inspect it from the CLI.

- UI "Archive" sets the `archived` flag and is reversible by `loctt unarchive`; the task still exists on disk under `tasks/<id>/`.
- UI "Delete" removes the task directory permanently, exactly as `loctt delete --yes` and MCP `delete_task` with `confirm: true` do.
- The UI exposes no third verb, no "soft delete", and no `--hard`-style modifier — there is no such flag anywhere in LocTT.
- A task archived in the CLI is hidden from every browsing view in the UI too, is listed in Settings → Archived, and shows the archived badge on its detail page when opened by direct link.

> **Amended (K121 #1, Ken 2026-09-23).** Ken: *"i think i want to not allow viewing archived stuff. thats the point of archiving."* … *"remove everywhere. i dont even want a debug switch."* Was "shows the archived badge in the UI and is hidden from default views there too". The badge used to be read off a revealed list row.

### XS-20 · M1 · major · P3 P10
**The UI's filter chips correspond to real config values, not invented buckets.** Open the Status filter dropdown.

- Every option corresponds to a status `key` in `workflow.yaml`, rendered with its configured label.
- There is no UI-only "Done" or "Open" pseudo-status that has no config counterpart; any category-level grouping is the `status.category` the config itself declares.
- Selecting a filter produces a query string that `loctt list --query` accepts and evaluates identically.

## B. Edge cases

### Config rewritten under a live session

### XS-21 · M1 · major · P3 P7
**`workflow.yaml` gains a status while the UI is open.** Add a status to `workflow.yaml` with the UI on `/list`.

- After refresh the new status appears in the Status filter dropdown with its configured label.
- On `/board` it appears as a new column in its configured position, empty.
- Nothing requires restarting `loctt ui` — the config is re-read, not cached at boot.

### XS-22 · M1 · blocker · P7 P3
**`workflow.yaml` loses a status that tasks still reference.** Delete a status key from `workflow.yaml` while tasks still carry it.

- Tasks referencing the removed key still render in the list. They are not dropped, not blank, and the view does not error.
- The status cell shows the raw key with an explicit unknown marker — e.g. `in_review (unknown)` or an equivalent visibly-degraded treatment — never an empty cell and never a silently substituted default.
- A tooltip, banner, or inline note explains that the value is not defined in `workflow.yaml`, naming the file.
- Setting a *new* status on such a task still works and offers only currently-configured values.

### XS-23 · M1 · blocker · P7 P9
**Filtering and grouping never drop tasks with unknown config values into an invisible bucket.** With tasks referencing a deleted status, apply filters and group on `/board` and `/timeline`.

- The unfiltered list's `total` includes those tasks. Sum of per-status counts plus an explicit "Unknown"/"Other" bucket equals the total — no task is unaccounted for.
- The board renders an explicit column (or lane) for unknown statuses rather than dropping those cards.
- Grouping by milestone, assignee, sprint, or status on `/timeline` likewise produces a visible bucket for unrecognized values.
- Selecting all rows and reading the selection count matches the visible row count; no ghost rows.

### XS-24 · M1 · major · P7 P3
**Priorities and task types behave the same way when added or removed.** Repeat XS-21 and XS-22 for `priorities` and `task_types`.

- Additions appear in filters, dropdowns, and columns after refresh with configured labels.
- Removals leave referencing tasks rendering with a visible unknown marker, still counted, still filterable, still editable to a valid value.
- No hardcoded assumption about the number of priorities survives — a config with one priority and a config with seven both render sanely.

### XS-25 · M2 · major · P7 P3
**A relationship kind removed from `workflow.yaml` leaves existing links visible.** Delete a relationship type that tasks still use, then open a task that uses it.

- The Relationships panel still lists the link, grouped under a heading that shows the raw type key marked unknown.
- The link target still resolves and is still clickable.
- "+ Add link" offers only currently-configured kinds; the removed kind is not offered.
- Unlinking the orphaned relationship still works.

### XS-26 · M2 · major · P7 P3
**A custom field removed from `workflow.yaml` leaves stored values visible.** Delete a `custom_fields` entry that tasks carry values for.

- The task detail shows the stored value under the raw field name, marked as no longer configured.
- It is not silently deleted from the file, and saving an unrelated field does not strip it.
- It disappears from the new-task form and from the column picker, since those enumerate current config.

### XS-27 · M2 · major · P7 P3
**A `custom_enum` losing one of its `preset_values` still renders tasks holding the removed value.** Remove a value from an enum custom field's presets.

- Tasks holding the removed value show it, marked unknown, not blank.
- The field's editor offers only current presets; the stale value is not silently re-offered as valid.
- Aggregations that count per enum category include an explicit bucket for the unrecognized value rather than discarding those tasks.

### XS-28 · M1 · major · P7
**`queries.yaml` losing a view that the sidebar has pinned degrades gracefully.** Delete a saved view from `queries.yaml` while the UI has it pinned in the sidebar and, separately, while it is the currently-active view.

- The sidebar does not crash; the entry is either removed on the next read or shown as unavailable with an explanation.
- If the deleted view was the active one, the list falls back to a defined default view and says so — it does not render an error page or an empty table implying zero tasks.
- The URL still parses; navigating back does not resurrect a broken state.

### XS-29 · M1 · major · P7 P4
**`projects.yaml` losing the active project falls through to a defined resolution, not an error.** Delete the currently-selected project from `projects.yaml` (leaving at least one other) with the UI open.

- The project switcher falls back per core's resolution order — user default, then workspace default (`projects.yaml#default`), then a sole project — and shows which project is now active.
- A stored per-user default that no longer matches any project is ignored silently at the resolution level, per core, but the UI still shows the user which project it landed on.
- Tasks whose `project` references the deleted key still render, with the project cell marked unknown rather than blank.

### XS-30 · M1 · major · P7 P3
**`labels.yaml`, `milestones.yaml`, and `sprints.yaml` gaining and losing entries behave consistently.** Add and remove entries in each while the UI is open.

- Additions appear in filters, pickers, and sidebar groups after refresh.
- Removals leave referencing tasks rendering the stored key with an unknown marker — a label pill in a neutral colour with the raw key, a milestone/sprint cell showing the raw key — never blank, never a crash.
- Milestone progress bars and sprint columns for removed entries either disappear or render as unknown with their tasks still visible; the tasks are not orphaned out of every view.
- Each removal case is verifiable by the same test: total task count before and after the config edit is unchanged.

### XS-31 · M4 · minor · P7 P3
**`calendar.yaml` changing under a live session updates date rendering.** Change workspace timezone, working days, or holidays.

- Date pickers reflect the new non-working days after refresh.
- Timeline weekend/holiday shading redraws from the new config.
- Already-stored dates are not rewritten by the config change; only their presentation changes.

### XS-32 · M1 · major · P3 P7
**A config file legitimately empty of a category renders as empty, not broken.** Set `labels.yaml` to an empty list, or remove the optional `estimation` block.

- The Labels sidebar group and filter render an explicit empty affordance, not a spinner and not a crash.
- With `estimation.enabled: false` the estimate field is hidden entirely, per the config contract — not shown blank or disabled.
- No view assumes at least one label, milestone, or sprint exists.

### Schema version drift

### XS-33 · M1 · blocker · P4 P7
**`.schema-version` missing: the UI says the tracker is unrecognized and points at `loctt migrate`.** Delete `.schema-version` and load the UI.

- The server refuses to serve tracker data (`requireSupportedSchema` fails) and the UI shows the schema banner with the **`missing`** kind rather than an empty list. `missing` and `unknown` are distinct kinds in `SchemaStatusResponse`: `unknown` is an unreadable/unparseable version (SHL-38), not an absent one.
- The banner names the missing file by path and says the tracker's layout cannot be confirmed.
- It offers a concrete next step, not a generic retry: run `loctt migrate` to stamp and upgrade.
- **It does not offer `loctt init` or reinitialize.** A `.loctt/` holding tasks but no version file is a *damaged* tracker, not an empty one; reinitializing is the one path that can destroy real data. Only a wholly absent or empty `.loctt/` routes to onboarding (ONB-1/ONB-16).
- The app does not route to `/init` — the directory is not uninitialized.
- No "Migrate now" button is offered for this kind in M4; migration is not the mechanical fix for a missing file.

### XS-34 · M1 · blocker · P4 P7 P10
**Recorded version greater than current: `SchemaTooNewError`, and migration cannot help.** Write a `.schema-version` above `CURRENT_SCHEMA_VERSION` and load the UI.

- The banner shows the `future` kind and states both numbers: the version on disk and the version this LocTT understands.
- The message says the tracker was written by a **newer** LocTT and that the fix is to upgrade LocTT — explicitly *not* to run a migration.
- No "Migrate now" button is offered for this kind at any milestone, including M4. Offering one here would be wrong: there is no forward migration path and no downgrade.
- The app shell and navigation still render; the banner is always visible. Every `/api/` request returns 409 while the mismatch stands (`server.ts` schema guard), so data views show an explained error rather than a spinner, an empty list, or partial content.

### XS-35 · M1 · blocker · P4 P7
**Recorded version less than current: run `loctt migrate`.** Write a `.schema-version` below `CURRENT_SCHEMA_VERSION` and load the UI.

- The banner shows the `outdated` kind and states both numbers.
- Through M1–M3 the banner tells the user to run `loctt migrate` in the terminal, quoting the exact command — the M1.1 banner is read-only by design.
- The command shown is copyable, and the message says a backup of `.loctt/` is taken automatically so the user knows the risk profile before running it.
- The app shell and navigation still render under the banner; gating is enforced server-side, not by the client. Every `/api/` request returns 409 while the mismatch stands, so the UI never reads tasks against a schema it does not understand — and never silently shows partial data either.

### XS-36 · M4 · blocker · P4 P7
**The M4 "Migrate now" button runs the real migration and clears the banner.** With an `outdated` schema in M4, click Migrate now.

- The button calls `POST /api/migrate` (core `migrateToCurrent`), shows a busy state, and is not double-clickable.
- Before running, the UI states what will happen: a backup copy of `.loctt/` is written to a sibling directory and the schema is stepped up to the current version.
- On success the banner clears, `schema_status` reports `current`, and `loctt schema` / `loctt info` agree from the terminal.
- On failure the message names the step that failed and the backup directory path, and tells the user the tracker was left mid-migration and needs investigation — it does not offer "try again" as the only option.

### XS-37 · M1 · blocker · P4 P5 P7
**The `.schema-migration-in-progress` sentinel blocks every boot and must not be one-click "fixed".** Create the sentinel file and load the UI.

- Every entry point refuses; the UI shows a distinct, highest-severity state for this kind — visibly different from `outdated` and `future`.
- The message reports the sentinel's recorded `from` version, `to` version, and backup directory path.
- It states plainly that a previous migration crashed part-way and that the tracker needs manual investigation.
- **No one-click fix is offered.** No "Retry migration", no "Delete sentinel", no "Continue anyway". Re-running a migration over a half-migrated tracker compounds the damage, so the UI must not make that a single click.
- The recovery guidance points at the backup path and the CLI, and is specific enough to act on without guessing.
- Read-only views are not quietly served from behind the sentinel — nothing reads the tracker while it is in this state.

### XS-38 · M4 · major · P4 P7
**Schema state is re-evaluated, not cached from the first page load.** Fix an `outdated` schema with `loctt migrate` in the terminal while the UI sits on the banner.

- The banner clears on refetch/refresh without restarting `loctt ui`.
- The reverse also holds: creating drift while the UI is healthy causes the banner to appear rather than the app carrying on against a schema it no longer supports.

### The key-lookup cache

### XS-39 · M1 · major · P1 P10
**Tasks created out-of-band are found by key without a rebuild.** With the UI open, `git pull` new task directories into `.loctt/tasks/` (or create them from another process), then search for one of their keys.

- The key resolves — `lookupByKey` folds unindexed task directories into `local/key-index.yaml` lazily, so no manual step is needed.
- `/tasks/<KEY>` for one of the new tasks loads the task rather than 404-ing.
- The UI does not prompt the user to rebuild the index for this case; it is self-healing.

### XS-40 · M1 · major · P1
**Tasks deleted out-of-band stop resolving cleanly.** Delete a task directory from disk while the UI has its key cached.

- Navigating to that key produces the UI's not-found state naming the key, not a spinner and not a stack trace — the indexed entry drops on ENOENT and the lookup falls through.
- The list no longer shows the task after refetch, and the `total` decreases accordingly.
- Any relationship pointing at the deleted task renders as a missing target, marked as such, rather than as a broken link with no explanation.

### XS-41 · M4 · blocker · P1 P4 P10
**A manual frontmatter edit to `key` or `key_history` is the one drift LocTT cannot auto-detect, and the UI must point at the CLI.** Hand-edit a task's `key` in `task.md` with an editor, then use the UI.

- The stale `key → id` mapping in `local/key-index.yaml` persists — neither the fold path nor the ENOENT-drop path fires, because the indexed task id is still on disk. This is expected behaviour, not a UI bug.
- The UI's Diagnostics panel (M4.3, the `loctt doctor` equivalent) surfaces the "key index" check as a warning with a message naming what drifted.
- The repair is stated as **CLI-only**: `loctt doctor --rebuild-index`. The exact command is shown and copyable.
- The UI offers **no** rebuild button — rebuild stays CLI-only per M4.3.
- The message explains *why* it happened — a direct file edit changed a key — so the user learns the cause, not just the remedy.

### XS-42 · M2 · major · P1 P10
**`key` and `key_history` are rejected as immutable by the web API, matching the CLI and MCP.** Attempt to set `key` or `key_history` through the UI and through a hand-crafted API request.

- No UI control exists to edit either field — they render as read-only.
- A direct `setField` request naming `key` or `key_history` is rejected with a message saying the field is immutable, matching MCP's rejection wording in spirit.
- This confirms XS-41's premise: the drift is reachable only by direct file editing, so the UI never needs to defend against its own writes causing it.

### Key reassignment and key history

### XS-43 · M4 · blocker · P1 P10
**An old key still resolves after a sync collision rekeys the task.** Cause a sync collision so `T-42` is rekeyed to `T-43` with `T-42` in `key_history`, then visit `/tasks/T-42`.

- The route resolves to the task — it does not 404.
- The preferred behaviour is a redirect to `/tasks/T-43` so the address bar shows the current key; if the page instead renders in place, it makes clear that `T-42` is a historical key.
- Bookmarks and links shared before the rekey keep working.

### XS-44 · M4 · blocker · P1 P10
**Searching for a historical key finds the task.** Search `T-42` in the UI after the rekey.

- The search returns the task now keyed `T-43`.
- The result makes the relationship visible — the row or result shows the current key and indicates the match came from a previous key, so the user is not confused by searching one key and getting another.
- `loctt list` searching the same term behaves the same way, since both go through the same index and query engine.

### XS-45 · M4 · blocker · P1
**Relationship links survive a rekey.** Have `T-9` link to `T-42`, then rekey `T-42` to `T-43`.

- `T-9`'s Relationships panel shows the target as `T-43` — links are stored by ULID, so the rename only changes the label.
- The link is clickable and lands on the task.
- No link renders as `missing`, and no link renders the raw ULID to the user where a key is available.

### XS-46 · M2 · major · P1 P4
**The detail footer shows key history so a changed bookmark is explicable.** Open a task that has `key_history` entries.

- The footer lists prior keys, per M2.2's footer contract.
- The presentation makes the causal story clear: this task used to be `T-42`, it is now `T-43`. A user who bookmarked `T-42` can understand why the address bar changed.
- A task with no `key_history` shows nothing — no empty "Previous keys:" label with nothing after it.

### Locks and filesystem

### XS-47 · M4 · major · P4 P1
**The UI reports a state-lock timeout honestly rather than hanging or claiming success.** Hold `withStateLock` from another process (e.g. a wedged CLI command) and perform a UI action that allocates a key, such as creating a task.

- The request does not hang indefinitely from the user's perspective; it resolves within a bounded time.
- The failure message says another LocTT process is holding the tracker's state lock, and suggests checking for a running CLI or MCP command.
- It states clearly that the change was **not** saved, and offers retry as a control.
- No optimistic row is left in the list implying the task was created.

### XS-48 · M4 · blocker · P4 P1
**Writes during a migration fail fast, with the migration named as the reason.** Start `loctt migrate` (holding the migration lock, 5-minute stale timeout) and attempt a write from the UI.

- The write is refused promptly — `withStateLock` refuses to enter while a migration lock is held, and `isMigrationLocked` lets writers fail fast, so the UI does not sit for the full stale timeout.
- The message names the cause: a schema migration is in progress on this tracker.
- It says the change was not saved and to retry when the migration finishes; retry is offered as a control.
- The UI does not offer to force, break, or bypass the lock.

### XS-49 · M4 · minor · P4 P6
**A stale lock left by a killed process clears within its documented timeout.** `kill -9` a process mid-write, leaving a lock file, then retry from the UI.

- After the state lock's 10-second stale timeout the retry succeeds without manual intervention.
- If the user retries inside that window, the message reflects a *transient* condition ("try again in a moment") rather than a permanent one.
- The 5-minute migration-lock timeout is not applied to ordinary state operations; a stuck state lock does not block the UI for five minutes.

### XS-50 · M4 · major · P4 P7
**The UI warns when the tracker sits on a filesystem where advisory locks are unsafe.** Run `loctt ui` against a `.loctt/` inside Dropbox, iCloud Drive, OneDrive, or an NFS/SMB mount.

- A warning surface names the specific risk: LocTT's locks are POSIX advisory and are not safe on network or sync-service filesystems, so concurrent writes from two machines can corrupt state.
- The warning names the detected path so the user can confirm which directory triggered it.
- It is informational, not blocking — the app still works, since the risk is concurrency-dependent.
- It is dismissible and does not re-nag every refetch within a session.
- If detection is best-effort and can miss cases, that is stated in the UI guide (`docs/user/ui/guide.md` § Diagnostics) so the absence of a warning is not read as a guarantee. It is NOT standing text in the Diagnostics panel: Ken (2026-09-23) ruled the panel shows results, not caveats about a warning the user is not seeing. The boot warning itself is unchanged and still fires when detection catches a risky location.

### XS-51 · M2 · major · P1 P6
**A malformed file the UI reads is a genuine hand-edit, never a torn write.** Corrupt a `task.md` mid-YAML and load the list; separately, hammer the UI with writes while reading.

- Atomic writes (temp file + rename) mean readers see either the old file or the new one — repeated concurrent read/write cycles never produce a parse error attributable to LocTT's own writing.
- Therefore the parse-error surface can and does say the file appears to have been edited by hand or by another tool, naming the path — it does not hedge with "the file may have been written incompletely".
- The rest of the list still loads; one bad file does not take down the view. (Full treatment in [flow-error-handling.md](flow-error-handling.md) § B.)

### XS-52 · M4 · minor · P1
**Machine-local files are not published and are not required to be present.** Delete `local/key-index.yaml`, `local/sync.yaml`, and `users/<id>/settings.yaml`, then load the UI.

- The app works. The key index rebuilds itself lazily on lookup; missing sync metadata means "nothing synced yet"; missing user settings fall back to defaults.
- No error surfaces for their absence — they are caches and per-checkout state, not tracker data.
- Column visibility, card layout, and sidebar collapse revert to defaults rather than crashing on undefined.

### Three surfaces at once

### XS-53 · M2 · major · P1 P10
**UI, CLI, and MCP all open on the same tracker stay coherent.** Open the UI on `/tasks/T-12`, an MCP session, and a terminal, then interleave writes from all three.

- Each write lands. `loctt show T-12`, MCP `get_task`, and the UI all report identical values after all writes settle.
- No surface reports success for a write that another surface overwrote — field-level writes to different fields all survive; two writes to the *same* field resolve last-writer-wins and the losing surface shows the winning value on refetch.
- History (`_history.yaml`) records all three writes; the UI's Activity feed shows entries attributed to the acting user for each.

### XS-54 · M2 · major · P1 P10
**Two browser tabs on the same tracker behave like two separate surfaces.** Open `/tasks/T-12` in two tabs and edit different fields in each.

- Both writes land; neither tab clobbers the other, because each sends only its own field.
- Each tab converges to the combined state on refetch.
- There is no shared browser state (localStorage, BroadcastChannel) that makes one tab authoritative over the other's view of task data. Only genuinely local preferences — sidebar collapse, theme — may be shared that way.

### XS-55 · M4 · minor · P1 P10
**Switching the current user in one surface is reflected in the others.** Run `loctt user switch alex` while the UI is open.

- `.loctt/.current-user` is the single source; the UI's user menu shows Alex after refetch, without restarting `loctt ui`.
- Subsequent UI actions are attributed to Alex in `_history.yaml`.
- The reverse holds: switching user in the UI changes what `loctt user current` reports.

## C. Error cases

### XS-56 · M1 · blocker · P4 P6
**The UI never presents stale data as authoritative when it knows it is stale.** Stop the server (`Ctrl-C`) while `/list` is displayed, then interact.

- The already-rendered rows are not silently wiped to an empty state — that would read as data loss.
- They are visibly marked as possibly out of date, with an explicit indication that the app cannot currently reach the tracker.
- Write controls are disabled or, if attempted, fail loudly with "not saved" rather than optimistically appearing to succeed. (Transport specifics: [flow-error-handling.md](flow-error-handling.md) § A.)
- When the server returns, the staleness marking clears on its own and the data refreshes.

### XS-57 · M2 · blocker · P1 P4
**A write rejected because the underlying task changed says exactly that.** Delete `T-12` from the CLI, then submit a field edit from the still-open detail page.

- The write fails and the message says the task no longer exists on disk, naming `T-12` by key — not by ULID.
- The optimistic field change rolls back visibly, so the user cannot believe the edit stuck.
- The message distinguishes this from a transport failure: "deleted by another process" is a different sentence from "server unreachable", and retry is not offered as the primary action because retrying cannot help.
- A route back to the list is offered.

### XS-58 · M2 · blocker · P1 P4
**A task deleted in the CLI while the UI has it open degrades to an explicit not-found state.** Open `/tasks/T-12`, run `loctt delete T-12 --yes`, then let the UI refetch.

- The detail page shows a not-found state naming `T-12`, not a page of stale fields with live-looking edit controls.
- Any pending unsaved body text is preserved somewhere the user can copy it out before navigating away — the task is gone but the user's typing should not be.
- The task disappears from the list and from Recently viewed on the next read; the sidebar does not keep a dead entry that 404s forever.

### XS-59 · M1 · blocker · P4 P10
**A query the UI cannot parse fails at the offending token, not by returning zero rows.** Type `stats = done` (misspelled field) into the search box.

- The UI highlights or names the bad token and says the field is unknown.
- It does **not** render "No tasks found" — a parse failure and an empty result set are different states.
- The message names valid alternatives where cheap (the closest field name, or a pointer to Query help).
- `loctt list --query 'stats = done'` rejects the same string, so the two surfaces agree on what is invalid.

### XS-60 · M1 · major · P4 P10
**A query referencing a config value that no longer exists is not silently empty.** Run `status = deleted_status_key` after removing that status from `workflow.yaml`.

- The result is either an honest zero-match with an explanation that the value is not a configured status, or a parse-level rejection — never a bare "No tasks found" that implies the tracker is empty.
- If tasks still carry the removed key, the query matches them and they render per XS-22.
- The CLI's behaviour for the same query is the same; a discrepancy here is a P10 failure.

### XS-61 · M1 · blocker · P4 P7
**A config file that fails its Zod schema names the file and the failing field.** Introduce a schema violation into `workflow.yaml` (e.g. a status with no `key`) while the UI is open.

- The UI reports which file failed to load, by path, and which field failed, with what was expected — Zod carries this and the UI must not flatten it to "invalid config".
- Views that do not depend on that config still load where possible; the whole app does not white-screen for one bad config file.
- No jargon leaks into the headline: not "ZodError", not "invalid_type at statuses[2].key". The path and expectation are in plain language, with raw detail available on expand.
- The same violation reported by `loctt doctor` and the UI Diagnostics panel describes the same problem in compatible terms.

### XS-62 · M1 · major · P4 P7
**`projects.yaml` violating its at-least-one-project constraint is reported specifically.** Empty the projects list.

- The message states the constraint — a tracker must have at least one project — and names `projects.yaml`.
- It does not fall back to a generic config error, and it does not render an empty project switcher as though this were a normal state.
- The fix is stated: add a project to `projects.yaml`, or use `loctt project create`.

### XS-63 · M4 · major · P4 P7
**Duplicate project keys or prefixes are reported as the constraint violation they are.** Hand-edit `projects.yaml` to duplicate a `prefix`.

- The message names the duplicated value and both entries that carry it.
- It states that prefixes must be globally unique, so the user understands the rule rather than just the symptom.
- The UI does not pick a winner and carry on — an ambiguous key allocation would produce colliding task keys.

### XS-64 · M4 · major · P4 P1
**A read-only or wrong-ownership `.loctt/` is detected before the user does work they will lose.** Make `.loctt/` read-only and use the UI.

- The condition is surfaced on load or on first write attempt, naming the permission problem and the path — ideally before the user has typed a long body.
- Write controls reflect the condition rather than appearing fully functional and failing at save time.
- If a write is attempted anyway, the failure says the change was not saved and names the path, and the typed content is retained.

### XS-65 · M2 · major · P4 P1
**A conflict surface that itself fails still leaves the file untouched.** Force the body-conflict path (XS-12) and then make the resolution write fail.

- The task body on disk is unchanged — a failed resolution does not write a half-merged body.
- The message says which version is currently on disk and that the resolution was not applied.
- The editor's content survives so the user can retry or copy it out.
- The conflict surface can be re-entered; it does not vanish leaving the user with no way back to their text.

### XS-66 · M4 · minor · P4 P10
**A saved view that the UI wrote but that fails to reload is reported as a write problem, not a missing feature.** Save a view, then corrupt `queries.yaml` so it fails to parse.

- The UI does not show the view as present-in-UI-only; a view that is not in the file is not shown as saved.
- The error names `queries.yaml` and the parse or schema failure.
- The sidebar's Saved views section (K125, amended Ken 2026-09-24 — was
  "Views", then "Saved filters" before that) degrades to an explicit
  error affordance, not to silence — a user must not conclude their
  saved views were deleted.

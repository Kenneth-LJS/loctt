# Flow: projects and users

Covers the project switcher in the top bar and the user menu in the
top-right (M1), plus the Settings → Projects and Settings → Users CRUD
panels including avatar upload (M4.1). Project *resolution* at task
creation is exercised here from the settings/preferences side; the
create-modal side lives in [flow-task-create.md](flow-task-create.md).
The settings shell that hosts these panels is in
[flow-settings.md](flow-settings.md), and how rekeying interacts with
project counters during git sync is in
[flow-git-sync.md](flow-git-sync.md).

## A. Happy path

### PRU-1 · M1 · blocker · P2 P3
**Switching the active project scopes list, board, and timeline.** Tracker has projects `backend` (prefix `BACKEND-`) and `web` (prefix `WEB-`), each holding tasks.

- The top-bar switcher lists every non-archived project by its `label`, not its `key` or `prefix`.
- Selecting **Backend** leaves only tasks whose frontmatter `project` is `backend` in the list; the total count in the pagination footer matches that subset, not the whole tracker.
- Navigating to the board and the timeline with the switcher unchanged keeps the same scope — the board's columns show only `backend` cards, and the timeline's lanes contain only `backend` bars.
- The switcher's own label reads "Backend" on every one of those routes; it does not reset to "All projects" on a view change.

### PRU-2 · M1 · blocker · P2
**The active project lives in the URL.** Starting from **All projects**.

- Selecting **Web** writes the project into the URL search params (e.g. `?project=web`) without a full page reload.
- Copying that URL into a second browser tab opens the list already scoped to Web, with the switcher reading "Web".
- Pressing back returns to the previous scope (**All projects**) and the list re-widens to include both projects; forward re-narrows.
- Reloading the scoped URL produces the same rows in the same order — nothing about the scope is held only in React state.

### PRU-3 · M1 · major · P2 P9
**"All projects" mode shows the project column so rows are distinguishable.** Two tasks with the same title, "Fix login", exist — one in each project.

- With a single project selected, the project column is hidden (it would be constant) and the key prefix alone identifies the row.
- Switching to **All projects** makes the project column appear without the user having to add it via column settings.
- The two "Fix login" rows are distinguishable: one shows `BACKEND-14` / Backend, the other `WEB-3` / Web.
- Returning to a single project hides the column again; the user's saved `list_columns` order is not permanently mutated by this automatic show/hide.

### PRU-4 · M1 · major · P3 P8
**The create form defaults to the active project.** Switcher is set to **Web**.

- Opening the create modal pre-selects Web in its project field.
- The key preview (if shown) reflects Web's prefix.
- Changing the modal's project field to Backend does not change the top-bar switcher — the explicit choice is scoped to that one create.
- Creating the task with the modal left at Web produces a task with `project: web` and a key beginning `WEB-`.

### PRU-5 · M4 · blocker · P1 P10
**Creating a project from Settings → Projects.** Settings → Projects panel, no project named "Docs" exists.

- The create form asks for label, key, and prefix; key and prefix are marked as permanent at the point of entry, not after the fact.
- Saving writes the project into `.loctt/config/projects.yaml`; `loctt project list` in a terminal shows it immediately.
- The new project appears in the top-bar switcher without a page reload.
- The first task created in it gets key `<PREFIX>1` — the counter starts fresh in `state.yaml` under `keys.docs`.

### PRU-6 · M4 · major · P1 P3
**Renaming a project changes only its label.** Project `backend` is labelled "Backend".

- Editing the label to "Backend Services" and saving updates the switcher, the sidebar project group, and the list's project column.
- Existing task keys are untouched — `BACKEND-14` is still `BACKEND-14`.
- The panel still shows `backend` as the key and `BACKEND-` as the prefix, both non-editable.
- A URL containing `?project=backend` still resolves after the rename — the URL carries the key, not the label.

### PRU-7 · M4 · major · P5 P10
**Archiving a project hides it without breaking its tasks.**

- Archive is a single click with no typed confirmation — it is reversible, so the ceremony stays proportionate.
- The archived project drops out of the top-bar switcher and out of the create form's project picker.
- Its tasks still open by key and still render "Backend Services" as their project, with an "(archived)" marker rather than a blank cell.
- The panel offers **Unarchive**, which restores it to the switcher in the same position.

### PRU-8 · M4 · major · P8 P10
**Switching the current user from the top-right menu.** Users Alice and Bob both exist.

- The menu shows the current user's display name, email, and avatar (or initials fallback), not just an anonymous icon.
- Selecting Bob updates the header immediately and writes Bob's ULID to `.loctt/.current-user`; `loctt whoami` in a terminal agrees.
- "Assigned to me" in the sidebar re-resolves to Bob's tasks, and its count badge changes accordingly.
- No page reload is required, and the current route and filters survive the switch.

### PRU-9 · M4 · major · P1 P10
**Per-user settings switch with the user.** Alice has a narrow column set and dark theme; Bob has the default columns and light theme.

- Switching from Alice to Bob repaints in light theme and restores Bob's column set and order, read from `users/<bob-id>/settings.yaml`.
- Bob's card layout on the board reflects his own `card_layout`, not Alice's.
- Switching back to Alice restores hers exactly — neither user's settings were overwritten by viewing as the other.
- These files are the gitignored per-checkout ones; nothing about the switch touches `profile.yaml`.

### PRU-10 · M4 · major · P1 P10
**Activity is attributed to the acting user.** Acting as Bob.

- Changing a task's status writes a history entry whose actor is Bob; the task's Activity tab names Bob.
- Switching to Alice and changing priority appends a second entry attributed to Alice — the earlier Bob entry is not retroactively rewritten.
- `loctt history <key>` shows the same two actors in the same order (see [flow-comments-activity.md](flow-comments-activity.md) for feed rendering).

### PRU-11 · M4 · major · P1 P10
**Creating a user from Settings → Users.**

- The form takes display name, email, and IANA timezone; it does not ask for an ID.
- Saving creates `users/<new-ulid>/profile.yaml` with those fields; the ULID is generated, never user-supplied and never editable afterwards.
- The new user appears in the user-switch menu and in assignee pickers on tasks.
- No `settings.yaml` is required for them to be usable — defaults apply until they change something.

### PRU-12 · M4 · major · P5 P7
**Archiving a user preserves their existing assignments.** Carol is assigned to three tasks and is the reporter on two more.

- Archiving Carol from Settings → Users succeeds with a single confirm and no typed key.
- All five tasks still display "Carol" — greyed with an "(archived)" suffix — rather than a blank, a raw ULID, or "Unknown user".
- Carol no longer appears in the assignee picker on a *new* task, and attempting to set her via a stale picker is rejected by the archived-reference guard with a message naming Carol and saying she is archived.
- Unarchive restores her to the pickers immediately.

### PRU-13 · M4 · major · P1 P9
**Avatar upload compresses in the browser before POST.** A 1200×900 JPEG, 2.1 MB, selected in the Users panel.

- The preview renders from the compressed result, not the original file.
- The uploaded payload is at most 256×256 (aspect preserved, so 256×192 here) and is materially smaller than 2.1 MB — this is verifiable from the request body size in devtools.
- The stored file lands at `users/<id>/avatar.<ext>` with a JPG or WebP extension matching what was actually encoded, and `profile.yaml` records that filename.
- The avatar appears in the header menu, in the assignee cell in the list, and on the task detail panel after the upload completes.

## B. Edge cases

### B1. Project resolution

### PRU-14 · M4 · major · P7
**A user default pointing at a deleted project is silently ignored.** Alice's `settings.yaml` has `default_project: archive_me`; that project has since been hard-deleted. Workspace default is `backend`.

- Opening the create modal as Alice pre-selects **Backend** — the workspace default — and does not error, blank the field, or show "archive_me" as a ghost option.
- No warning banner fires for this case; falling through is the designed behaviour, not drift to be surfaced.
- Setting a new personal default from preferences replaces the dead value in `settings.yaml`.

### PRU-15 · M4 · major · P7 P10
**Resolution order is explicit > user default > workspace default > unique single project.** Verified by peeling one layer at a time.

- With an explicit `?project=web` in the URL, the create modal picks Web even though Alice's default is `backend`.
- With no URL project and Alice's default set to `backend`, it picks Backend even though `projects.yaml#default` is `web`.
- Clearing Alice's personal default makes it fall to `web` (the workspace default).
- Removing `default` from `projects.yaml` in a tracker with exactly one project makes it pick that project.
- The same sequence through `loctt create` resolves identically — the UI has not invented its own order.

### PRU-16 · M4 · major · P4 P7
**Resolution failing with no project resolvable.** Multiple projects, no workspace default, no user default, no explicit choice.

- The create modal opens with the project field empty and focused, marked required, rather than silently picking the first project in file order.
- Submit is blocked until a project is chosen, and the block states that the workspace has no default and one must be picked.
- The message points at Settings → Projects as the place to set a workspace default so this stops recurring.

### B2. Project CRUD

### PRU-17 · M4 · blocker · P5 P9
**Deleting a project that holds 12 tasks shows the reference count before confirming.**

- The Projects panel shows a reference-count badge reading `12` next to the project *before* the delete dialog is opened.
- The delete dialog names the project and repeats the count in words the user can act on ("12 tasks reference this project").
- The dialog requires either a remap target (another project) or an explicit "clear the project field on these tasks" choice — there is no default that silently orphans the 12 tasks.
- Confirming with remap moves all 12 tasks' `project` to the target and reports the number moved; the tasks' existing keys are unchanged, so `BACKEND-14` remains `BACKEND-14` under the Web project.
- Cancelling leaves `projects.yaml` and all 12 tasks byte-identical.

### PRU-18 · M4 · blocker · P1 P10
**Re-creating a deleted project with the same key restores its counter.** `backend` had allocated up to `BACKEND-47` when it was hard-deleted; `state.retired_keys.backend` holds 47.

- Creating a new project with key `backend` and prefix `BACKEND-` succeeds and the panel does not warn about a collision.
- The first task created in it gets `BACKEND-48`, not `BACKEND-1`.
- A task whose `key_history` contains `BACKEND-12` still resolves by that old key and is not shadowed by a newly minted duplicate.
- `state.yaml` shows the counter moved back under `keys.backend` and removed from `retired_keys`.

### PRU-19 · M4 · major · P4
**A project prefix colliding with an existing one is rejected at entry.** `WEB-` is already taken by project `web`.

- Typing `WEB-` in the prefix field of the create form surfaces the conflict inline, before submit, naming the project that already owns it.
- Submit stays disabled while the conflict stands; there is no server round-trip that half-creates the project.
- Changing to `WEBAPP-` clears the error and enables submit.
- The same check fires for a prefix that differs only in case if the underlying uniqueness is case-insensitive; whichever it is, the UI's answer matches what `loctt project create` does.

### PRU-20 · M4 · minor · P3
**Prefix and key are immutable after creation.** Editing an existing project.

- The key and prefix inputs are disabled, not merely unvalidated, and carry a short explanation that changing them would break existing task keys.
- The label field is editable in the same form, so the disabled state reads as intentional rather than as a broken form.
- No API request is issued that could change either field even if the inputs were re-enabled in devtools — the server rejects it too.

### PRU-21 · M4 · minor · P9
**A tracker with 30 projects keeps the switcher usable.**

- The switcher becomes searchable (type-to-filter on label and key) rather than an unbounded scrolling list.
- "All projects" remains pinned and reachable without scrolling.
- The sidebar project group truncates with a count ("+22 more") rather than pushing the rest of the sidebar off-screen.

### PRU-22 · M4 · minor · P9
**A project label of 120 characters does not break layout.**

- The switcher truncates with an ellipsis and exposes the full label on hover/focus.
- The list's project column truncates per-cell; the row's other columns stay aligned and the due-date column is not pushed off-screen.

### B3. User CRUD, identity, avatars

### PRU-23 · M4 · major · P7 P9
**Two users with identical display names are disambiguated.** Two "Alex Kim" users exist with different ULIDs.

- The user-switch menu shows both, each qualified by email if the emails differ, and by a truncated ULID if they do not.
- The assignee picker does the same, so picking the wrong Alex is not a coin flip.
- After assigning one, the task detail shows enough qualification to tell which Alex it is.
- Nothing in the UI implies names must be unique or offers to "merge" them.

### PRU-24 · M4 · major · P1 P7
**The current user is archived from the CLI mid-session.** UI is open as Carol; `loctt user archive carol-id` runs in a terminal.

- The next data fetch surfaces the change rather than continuing to present Carol as a normal active user.
- The header shows Carol with an "(archived)" marker and prompts the user to switch to an active user.
- Writes attempted while archived either succeed with Carol as actor (if that is the core's behaviour) or fail with a message naming Carol and saying she is archived — but the UI does not fail silently or attribute the write to some other user.
- Switching to an active user from the prompt clears the state without a reload.

### PRU-25 · M4 · major · P7
**A hard-deleted user is still referenced as reporter on old tasks.** Dave was deleted with `loctt user delete`; five tasks still carry his ULID as `reporter`.

- Those tasks render the reporter cell as a clearly-degraded value — the truncated ULID plus "(deleted user)" — rather than blank, "undefined", or the raw ULID with no explanation.
- The list does not fail to render the row, and the other four columns are unaffected.
- Filtering by reporter offers only existing users; the dangling ULID is not offered as a filter option.
- Setting a new reporter on such a task works normally and clears the dangling reference.

### PRU-26 · M4 · major · P5
**Archiving is blocked on the currently active user.** Acting as Alice, viewing Alice's row in Settings → Users.

- The Archive control on Alice's own row is disabled, not merely error-on-click.
- Its disabled state explains why — you cannot archive the user you are acting as — and points at switching users first.
- Archiving any *other* user from the same panel works normally, proving the block is targeted and not a broken panel.

### PRU-27 · M4 · major · P9
**A 4000×3000 JPEG avatar is clamped and materially smaller.**

- The browser resizes before upload: the posted image is 256×192, not 4000×3000.
- The posted payload is a small fraction of the original — an order of magnitude smaller for a typical photo — verifiable from the request size.
- The UI does not freeze during compression; either it completes fast enough to be imperceptible or it shows progress, but it never presents an unexplained frozen dialog.
- The rendered avatar is not visibly stretched — the aspect ratio of the source is preserved by the clamp.

### PRU-28 · M4 · minor · P9
**An avatar smaller than the cap is not upscaled.** A 64×64 PNG.

- The stored image stays 64×64; the compressor does not blow it up to 256×256 and store a blurrier, larger file.
- The result is not larger than the original file; if re-encoding would grow it, the original bytes are kept.

### PRU-29 · M4 · minor · P4
**An animated GIF avatar is accepted as a still or rejected explicitly.**

- Whichever the app does, it says so: either "Animated images are stored as a single frame" shown before/with the upload, or a rejection naming the format.
- What it must not do is post the full animated file untouched to a bucket documented as 256×256 static, nor silently drop the upload with no feedback.
- If flattened, the preview shows the exact frame that will be stored.

### PRU-30 · M4 · minor · P4
**An SVG avatar is handled deliberately.**

- SVG is either rejected with a reason naming the format, or rasterised to a 256×256 raster before POST — not passed through as inline markup.
- If rejected, the message lists the accepted formats.
- No SVG content reaches the avatar bucket unrasterised (it would otherwise be served back to the browser).

### PRU-31 · M4 · minor · P1
**Removing an avatar clears the profile reference.**

- The panel offers a remove action next to the current avatar.
- Removing deletes the `avatar` key from `profile.yaml` and the file under `users/<id>/`.
- Every surface reverts to the initials fallback in the same render — header, list assignee cells, task detail.

### PRU-32 · M4 · minor · P2
**Deep-linking to a settings section that scopes by project.** Pasting `/settings/projects` directly.

- The panel opens regardless of what the top-bar project switcher is set to — project *management* is not scoped by the active project.
- The active project is still shown as selected in the panel's list so the user can orient.

## C. Error cases

### PRU-33 · M4 · blocker · P4 P5
**Deleting the last remaining project is refused.** One project, `backend`, exists.

- The Delete control is disabled with a stated reason: a tracker must have at least one project (`ProjectsConfigSchema` requires it).
- The panel suggests creating the replacement project first.
- No request is sent that could leave `projects.yaml` failing validation.

### PRU-34 · M4 · blocker · P4 P5
**Delete-with-remap fails partway through 12 tasks.** The remap succeeds on 7 tasks and then a task file becomes unwritable.

- The result reports the true split: 7 remapped, 5 not, naming the 5 by key.
- The project is *not* removed from `projects.yaml` while tasks still reference it — the config change is not committed on a partial remap.
- The message states what the user's data looks like now (7 tasks moved, project still present) and offers Retry, which is safe to run because remapping an already-moved task is a no-op.
- It does not report "Project deleted" or a bare success toast.

### PRU-35 · M4 · major · P4
**Creating a project with a key that already exists.**

- The error names the existing project by label and key, before submit if the panel already knows the key list.
- The prefix field is not blamed when the key is the problem — the message points at the field that actually conflicts.
- Nothing is written; the switcher's project list is unchanged.

### PRU-36 · M4 · major · P4
**Creating a project with a malformed key or prefix.** Key `My Project!`, prefix `web` (no separator).

- The key error states the rule (slug: lowercase, digits, hyphen/underscore) and shows the suggested slug `my-project`.
- The prefix error states what a prefix looks like and why the separator matters, using the tracker's own existing prefixes as the example.
- Both errors appear on their own fields, not as one combined toast.

### PRU-37 · M4 · major · P4 P7
**`projects.yaml` fails schema validation while the panel is open.** A hand edit removes the required `prefix` from one entry.

- The Projects panel shows a parse/validation error naming the file path and the offending entry, not an empty list.
- The rest of the app degrades rather than crashes: tasks whose project can no longer be resolved show the raw project key with a drift marker (see [flow-cross-surface.md](flow-cross-surface.md)).
- The panel offers a Reload action; fixing the YAML and reloading clears the error without restarting the server.

### PRU-38 · M4 · major · P4
**A non-image file is rejected as an avatar.** A 3 MB PDF chosen in the file dialog.

- Rejection happens client-side, before any POST — no request is made.
- The message names the file, says it is not an image, and lists the accepted formats.
- The existing avatar (if any) is untouched, and the panel does not enter a stuck "uploading" state.

### PRU-39 · M4 · major · P4
**A corrupt or truncated image fails during browser decode.** A `.jpg` whose bytes are truncated.

- The failure is attributed honestly: decoding the image failed, the avatar was not changed, and the next action is to try a different file.
- This is the P4 rare exception territory — the underlying decode error may be opaque — but the message still states what was attempted, that nothing was saved, and what to do.
- The panel is left interactive; the file input can be used again without a reload.

### PRU-40 · M4 · major · P4
**Avatar upload fails server-side after successful compression.** The POST returns 500 or the disk is full.

- The error states that the image was prepared but not saved, and that the previous avatar is still in effect.
- Retry re-posts the already-compressed image rather than forcing the user to re-pick the file.
- The header does not optimistically show the new avatar and then silently revert without saying why.

### PRU-41 · M4 · major · P4 P7
**Assigning an archived user through a stale picker.** The picker was rendered before the user was archived elsewhere.

- The save is rejected by the archived-reference guard, and the message names the user and states they are archived.
- It offers the next action: unarchive them, or pick a different assignee.
- The field reverts to its previous value rather than displaying the rejected user as if it had saved.
- The identical rejection text appears whether the write came from the detail panel, the create modal, or a bulk edit.

### PRU-42 · M4 · major · P4 P5
**Deleting a user who is the assignee on 30 tasks.**

- The reference count is shown before confirming, split by role where they differ (assignee on 30, reporter on 4).
- The dialog states plainly that delete is permanent and that archive is the reversible option, with archive offered as an alternative in the same dialog.
- Deleting requires the same deliberate confirmation used elsewhere for permanent deletes, not a single OK.
- After deleting, the 34 affected tasks render the degraded "(deleted user)" form from PRU-25 rather than breaking.

### PRU-43 · M4 · minor · P4 P7
**The tracker lives on iCloud Drive and a project write hits lock contention.**

- The failure names the state lock, says the write did not complete, and states that POSIX advisory locks are not reliable on iCloud/Dropbox/NFS/SMB/OneDrive.
- It recommends moving the tracker to a local disk rather than only offering Retry.
- The panel does not show the project as created and then have it vanish on the next fetch.

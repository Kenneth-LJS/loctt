# Flow: onboarding

First contact with the web UI: running `loctt ui` somewhere that isn't a
tracker, the init wizard that fixes that, and the first render of a
tracker that is either brand new (nothing in it) or long-lived (plenty
in it). Init routing and the empty states are M1 concerns; the wizard
form itself is M4.6. The persistent chrome those states render inside —
sidebar, header, schema banner, routing — is [flow-app-shell.md](flow-app-shell.md);
the list view's own empty/loading behaviour beyond first load is
[flow-list.md](flow-list.md); keyboard reachability of the wizard is
[flow-accessibility.md](flow-accessibility.md).

## A. Happy path

### ONB-1 · M4 · blocker · P6 P4
**`loctt ui` in a directory with no `.loctt/` routes to the init screen, not to an empty list.** Run `loctt ui` from a directory that has never been initialized and open the served URL.

- `GET /api/info` returns `exists: false` and the app lands on `/init`, whatever path was requested.
- The screen's heading names the situation in the user's terms — a tracker has not been set up in this directory — rather than reporting a task count.
- The screen does **not** render the list table, an empty-list illustration, "No tasks found", or "0 tasks". An uninitialized directory and an empty tracker are visibly different screens.
- The sidebar's task-bearing groups (Filters, Saved views, Milestones,
  Sprints, Labels, Recently viewed — K125, amended Ken 2026-09-24: the
  built-ins and saved views used to share one "Saved filters"/"Views"
  section, now split in two) are either absent or visibly inert; no
  count badge renders a `0` that implies a tracker exists.

### ONB-2 · M4 · blocker · P4 P6
**The init screen shows which directory it is about to initialize.** Continue from ONB-1.

- The screen displays the workspace label from `TrackerInfoResponse.cwd` (abbreviated form, e.g. `~/code/myapp`) prominently enough to read before clicking anything.
- The label is presented as the directory the tracker *will be created in*, not as decoration — wording makes the consequence explicit.
- A user who launched `loctt ui` from the wrong folder can tell from this screen alone, without opening a terminal.

### ONB-3 · M4 · blocker · P3 P10
**The init form collects a project name and a key prefix.** On `/init`.

- Both fields are present and labelled with the same vocabulary the CLI uses (`loctt init --prefix`): project name, key prefix.
- The prefix field shows a default consistent with the CLI's default (`T-`), and shows a live preview of the first key that will be allocated (e.g. `T-1`).
- Typing a project name does not silently overwrite a prefix the user has already edited by hand.

### ONB-4 · M4 · major · P6
**The skip-starter-docs toggle is present and explains what it skips.** On `/init`.

> **Amended (K129, Ken 2026-09-24).** Ken: *"rest of the 'needs your
> call' looks okay"* (he approved cutting the explainer paragraph,
> B-69). The checkbox label itself now names what the docs are
> ("Skip the starter docs in `.loctt/docs/`"); no separate helper text
> is required.

- A toggle controls whether `.loctt/docs/` helper docs are generated.
- Its label names what the docs are, not just "skip starter docs" — a user who has never seen them can decide.
- The default state matches the CLI's default behaviour for `loctt init`.

### ONB-5 · M4 · major · P4 P10
**The auto-user note tells the user which identity will be created.** On `/init` with `$USER` set.

- The form shows a note naming the default user that will be created, derived from `$USER` (e.g. "You'll be set up as **ken**").
- The note says this can be changed later in Settings → Users, so the user doesn't feel forced to get it right now.
- No password, email, or account field appears anywhere — LocTT has no auth.

### ONB-6 · M4 · blocker · P4 P6
**Submitting init calls `POST /api/init` and lands on the list.** Fill valid values and submit.

- The submit control enters a busy state and is not double-submittable.
- On success the app navigates to `/list`; the URL in the address bar is `/list`, not `/init`.
- The sidebar, header, and footer are fully populated on arrival — the shell is not still showing init-time placeholders.
- The newly created project appears in the sidebar's Projects group and is the highlighted/default project.

### ONB-7 · M4 · major · P1 P10
**Init writes a real tracker that the CLI agrees with.** After ONB-6, run `loctt info` in the same directory.

- `.loctt/` exists with `config/`, `state.yaml`, and `.schema-version`.
- `loctt info` reports the same key prefix and next key the UI's preview promised.
- Nothing about the tracker exists only in the browser — reloading the page with a cold cache shows the same state.

### ONB-8 · M1 · blocker · P6
**A freshly initialized, empty tracker shows a designed empty list, not a blank pane.** Load `/list` on a tracker with zero tasks.

- The main pane shows an explicit empty state naming the state ("No tasks found.", amended K129) and offering the next action (create a task), not an empty table body and not a spinner.
- The empty state is distinguishable from "your filter matched nothing" — no filter chips are active and the copy does not suggest clearing filters.
- The table header row either renders with the configured columns or is absent by design; it does not render half-formed with misaligned widths.

### ONB-9 · M1 · blocker · P6 P7
**On an empty tracker the sidebar groups render with zero counts, not absent.** Same state as ONB-8.

- Views (List / Board / Timeline), Projects, Filters, Saved views,
  Milestones, Sprints, Labels, and Recently viewed all render as groups
  (K125, amended Ken 2026-09-24: Filters and Saved views were one
  combined "Saved filters"/"Views" section before this split).
- Groups whose underlying config is empty show an explicit empty affordance inside the group (e.g. "No labels yet") rather than the group vanishing.
- The five live built-in saved filters render with a count badge of `0` — a real zero, not a blank, not a dash, not the badge omitted.
- A user cannot mistake "this tracker has nothing in it" for "this feature is missing".

### ONB-10 · M1 · major · P6
**Recently viewed is empty on a fresh tracker and says so.** Same state as ONB-8.

- `GET /api/recents` returns an empty array and the group renders an empty affordance, not a skeleton stuck loading.
- The copy explains the group fills in as tasks are opened, so the emptiness reads as expected rather than broken.
- The group does not disappear entirely, so its position in the sidebar is stable once entries arrive.

### ONB-11 · M3 · major · P3 P6
**On an empty tracker the board shows the configured columns, all empty.** Load `/board` on a tracker with zero tasks.

- One column renders per configured status (or per `workflow.boards.columns` when set), using the labels from `workflow.yaml`.
- Every column shows its empty-column placeholder; the board does not collapse to a single "no tasks" message that hides the workflow shape.
- Column count and labels track the config — a tracker configured with seven statuses shows seven empty columns.

### ONB-12 · M1 · blocker · P6 P9
**First load of an existing tracker shows a skeleton shaped like the eventual table.** Load `/list` on a tracker with several hundred tasks, with the network throttled so the loading state is observable.

- The loading state is a skeleton with the same column structure and row height as the real table, not a centred spinner and not a blank pane.
- The number of skeleton rows is plausible for a page of results, so the pane doesn't visibly grow from 3 rows to 50 when data lands.
- The skeleton is replaced in place; the scroll position does not jump to top when real rows render.

### ONB-13 · M1 · blocker · P6 P9
**The table renders without waiting on sidebar count badges.** Same as ONB-12, with the saved-filter count queries artificially slower than `/api/tasks`.

- Task rows appear as soon as `/api/tasks` resolves, regardless of whether the badge queries are still in flight.
- The count badges show their own pending affordance while loading; a pending badge does not block, dim, or overlay the main pane.
- Nothing in the main pane is gated on a sidebar request completing.

### ONB-14 · M1 · blocker · P6
**No layout jump when sidebar counts land.** Same as ONB-13; watch the sidebar as the badges resolve.

- Badge slots reserve their space before the numbers arrive, so sidebar row positions do not shift when counts render.
- Nothing in the main pane reflows as a consequence of a badge resolving.
- Clicking a sidebar item mid-load hits the item the user aimed at — the target does not move under the pointer.

## B. Edge cases

### ONB-15 · M4 · major · P4 P6
**Deep link into an uninitialized tracker preserves the user's intent.** With no `.loctt/`, open `/tasks/T-4` (or `/board?status=open`) directly.

- The app routes to `/init` rather than rendering a 404 or a task-not-found page — the tracker's absence is the real explanation, and the UI gives that one.
- The screen does not claim the task does not exist; that would be misleading about data.
- After a successful init the user lands on `/list`. If the original deep link is not restorable (the task cannot exist in a brand-new tracker), the UI does not pretend to restore it.

### ONB-16 · M4 · major · P6 P7
**A directory where `.loctt/` exists but is empty is treated as uninitialized, not as a broken tracker.** Create an empty `.loctt/` directory and load the UI.

- The app routes to `/init`, which reads exactly as it does with no `.loctt/`: no message, warning or extra confirmation about the folder already being there.
- One submit sets the tracker up in that folder: the same files a fresh setup writes (config, state, starter docs unless skipped, `.gitignore`, the default user), keeping anything the folder already held.
- `loctt init` and MCP `init` do the same over an empty `.loctt/`: no refusal, no `--repair`.
- The app does not render a generic crash, a schema banner, or a zero-task list.

> **Amended (K129, Ken 2026-09-24).** Ken: *"why is there even an error
> then? just ignore, proceed with steps. dont even show this to the
> user, dont show the messages, dont show warning, dont even stop with
> this extra confirmation step because that causes friction."* The first
> two bullets previously required copy that accounted for the folder
> already existing and told the user it would be populated.

### ONB-17 · M4 · major · P4 P5
**Init run concurrently in two tabs does not produce a half-initialized tracker.** Open `/init` in two tabs, submit both within a second of each other.

- One request wins; the other receives a definite outcome rather than hanging.
- The losing tab does not report success for an init it did not perform, and does not report a generic failure that implies the tracker is broken.
- The losing tab's message names the situation — the tracker was initialized (possibly by another window) — and moves the user forward to `/list`.
- After both tabs settle, the tracker has exactly one project with one key counter; `loctt info` shows no duplicate project or doubled counter.

### ONB-18 · M4 · major · P4 P10
**A key prefix that collides with an existing project prefix is rejected before submit.** Only reachable when initializing into a directory that already has a tracker, or when the wizard is reused for adding a project; with a `WEB-` project present, enter prefix `WEB-`.

- The error is attached to the prefix field, not floated as a toast.
- The message names the conflict and the owner ("Prefix `WEB-` is already used by project **Web**") and states the next action (choose a different prefix).
- The submit control is blocked while the field is invalid; submitting anyway does not send the request.

### ONB-19 · M4 · major · P4 P10
**A prefix that isn't 1–10 uppercase letters is rejected with the rule stated.** Enter a prefix with a space, slash, lowercase, digit, or a trailing dash (K88/A80).

- Validation fires on blur or as the user types, not only on submit.
- The message states the actual rule — 1–10 uppercase letters (A–Z), and that the `-` separator is added automatically so the user does not type it — not "invalid input".
- The rule matches core exactly: `loctt init --prefix` and `setProjectPrefix` validate the same `^[A-Z]{1,10}$` (K88), so a value the CLI would take is not rejected here, and vice versa — a dash, lowercase, or digit is rejected on every surface.
- The key preview shows the auto-dash form (a prefix `WEB` previews `WEB-1`) and updates to reflect the rejected state rather than previewing a key that cannot be allocated.

### ONB-20 · M4 · minor · P4
**An empty project name is rejected with a usable message.** Clear the project name and submit.

- The field shows a required-field error naming the field.
- Focus moves to the first invalid field on a blocked submit, so the user is not hunting for what went wrong.

### ONB-21 · M4 · major · P4 P6
**`$USER` unset degrades to a prompt, not a broken user.** Launch `loctt ui` with `$USER` unset in the environment.

- The auto-user note does not render an empty name, `undefined`, or a blank avatar with no name.
- The wizard either asks for a display name or states plainly that a placeholder user will be created and can be renamed in Settings → Users.
- After init, the created user has a non-empty display name; the header avatar menu shows a real name, not an empty string.

### ONB-22 · M4 · minor · P9
**A very long project name does not break the wizard layout.** Enter a 200-character project name.

- The field scrolls or wraps within its bounds; the form does not widen and the page does not scroll horizontally.
- The key preview remains readable and is not pushed off-screen.
- After init, the sidebar Projects entry truncates with an ellipsis and exposes the full name on hover/focus.

### ONB-23 · M1 · minor · P9
**A 200-character workspace path renders in the footer without breaking the sidebar.** Serve a tracker from a deeply nested directory whose abbreviated `cwd` label is still very long.

- The footer truncates the label (middle- or start-truncation, preserving the final segments that identify the directory) rather than wrapping into many lines or widening the sidebar.
- The full label is available on hover and on keyboard focus.
- The Settings link beside it remains visible and clickable — it is not pushed out of the footer.

### ONB-24 · M1 · minor · P6 P9
**An empty tracker's list empty state survives a collapsed sidebar and a narrow window.** With zero tasks, collapse the sidebar and narrow the window to tablet width.

- The empty state stays centred in the available pane and its call-to-action remains reachable.
- No horizontal scrollbar appears on the page body.

### ONB-25 · M1 · major · P6 P9
**A tracker with exactly one task does not render as empty.** Load `/list` with a single task.

- One row renders; the empty state does not appear.
- Pagination reports honestly ("Showing 1–1 of 1" or equivalent) rather than hiding the count.

### ONB-26 · M1 · minor · P6
**Reloading `/list` on an already-warm tracker does not flash the empty state.** Reload a tracker that has tasks.

- The transition is skeleton → rows. The zero-task empty state never appears between them, even for one frame.
- A user watching closely never sees copy implying their tasks are gone.

### ONB-27 · M4 · minor · P2
**Navigating back after init does not return the user to a stale init screen.** Complete init, then press the browser Back button.

- The app does not render `/init` again as if the tracker were uninitialized.
- If `/init` is re-entered by URL on an initialized tracker, the app redirects to `/list` rather than offering to initialize a second time.

### ONB-28 · M4 · minor · P6
**A slow `POST /api/init` communicates progress.** Throttle the network so init takes several seconds.

- The busy state persists for the duration and the form remains visibly disabled.
- After a few seconds the UI adds a reassurance that work is in progress (creating directories, writing config) rather than sitting on an unexplained spinner.
- The user cannot navigate away and land in a half-rendered shell.

## C. Error cases

### ONB-29 · M4 · blocker · P4 P6
**An uninitialized tracker never renders as "no tasks found".** With no `.loctt/`, exercise every route the app serves — `/`, `/list`, `/board`, `/timeline`, `/tasks/T-1`, `/settings/general`.

- None of them render an empty-data presentation. Every one routes to or explains the uninitialized state.
- No screen shows a `0` count, an empty table, or an empty board that could be read as "my tasks were deleted".
- This is the load-bearing assertion of the whole flow: reading as data loss is a blocker even though nothing is technically broken.

### ONB-30 · M4 · blocker · P4
**`POST /api/init` failing on a permission error names the directory and the fix.** Make the target directory read-only, then submit init.

- The error appears on the init screen, not as a disappearing toast.
- It names what failed (creating `.loctt/`), why (the directory is not writable), where (the workspace label), and the next action (check permissions on that directory, or run `loctt ui` somewhere writable).
- The form retains the values the user typed so they aren't retyped after fixing permissions.
- A Retry control re-attempts without a full page reload.

### ONB-31 · M4 · blocker · P4 P1
**Init failing partway leaves an honest account of the tracker's state.** Simulate a failure after some files are written (e.g. the server dies mid-init).

- The message states what state the data is in — that `.loctt/` may exist partially and is not usable as-is.
- It gives a concrete next action (remove the partial `.loctt/` and try again, or run `loctt init` in the terminal for a fuller error).
- The UI does not navigate to `/list` and does not claim success.
- Reloading the page re-evaluates `/api/info` rather than trusting a cached "initialized" flag from the failed attempt.

### ONB-32 · M4 · major · P4
**`GET /api/info` failing at boot is distinguished from an uninitialized tracker.** Make `/api/info` return a 500 or time out.

- The app shows a server-error state, **not** the init wizard. Offering to initialize a tracker that may well exist would be actively wrong.
- The message says what was attempted (reading tracker info), that the tracker's state is unknown, and what to do (retry; check the terminal running `loctt ui`).
- A Retry control re-issues the request; a successful retry drops the user into the correct screen.

### ONB-33 · M1 · blocker · P4 P6
**`GET /api/tasks` failing on first load shows an error in the table region, not an empty table.** With a populated tracker, make `/api/tasks` return a 500.

- The main pane replaces the skeleton with an error state naming the failure (could not load tasks), the reason where known (server responded 500), and a Retry action.
- It does not render "No tasks yet" — again, a load failure must never read as data loss.
- The sidebar and header remain functional so the user can navigate elsewhere or open Settings.

### ONB-34 · M1 · major · P4 P6
**`GET /api/recents` failing degrades only the Recently viewed group.** Make `/api/recents` return a 500 while everything else succeeds.

- The Recently viewed group shows an inline failed state with a retry affordance; other sidebar groups and the main pane are unaffected.
- The group does not silently render as empty — "you haven't viewed anything" and "we couldn't check" are different claims.

### ONB-35 · M4 · major · P4 P7
**Init into a directory that already contains a valid tracker does not offer to overwrite it.** Reach `/init` by URL on a directory with an existing populated `.loctt/`.

- The app redirects to `/list` rather than rendering the wizard.
- If the wizard is reachable at all in this state, submitting is blocked with a message naming the existing tracker and its project(s); no code path can clobber existing task data from this screen.

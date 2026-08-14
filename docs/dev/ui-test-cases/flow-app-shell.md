# Flow: app shell

The chrome that persists across every view — the two-column layout,
header, sidebar groups, workspace footer, schema-mismatch banner, theme,
and the routing behaviour that ties them together. Mostly M1.1, with the
banner's "Migrate now" action deferred to M4.3. What each view renders
*inside* the main pane belongs to its own flow: [flow-list.md](flow-list.md),
[flow-board.md](flow-board.md), [flow-timeline.md](flow-timeline.md).
First-run and empty-tracker chrome is [flow-onboarding.md](flow-onboarding.md);
keyboard operation of the shell is [flow-accessibility.md](flow-accessibility.md);
config changing underneath a live session is
[flow-cross-surface.md](flow-cross-surface.md).

## A. Happy path

### SHL-1 · M1 · blocker · P6
**The two-column shell renders with a collapsible sidebar and a main pane.** Load any view on a populated tracker.

- A left sidebar and a main pane are laid out side by side; the header spans the full width above both.
- A collapse control is visible in or adjacent to the sidebar and is reachable without hovering a hidden hot zone.
- Collapsing hides the sidebar's labels and reclaims its width for the main pane; the main pane reflows rather than being clipped or overlapped.
- Expanding restores the sidebar to its previous width with all groups in their previous expand/collapse states.

### SHL-2 · M1 · blocker · P6 P8
**The header carries logo, current-user avatar menu, and the create-task button.** Load any view.

- The logo is present and links to the app root.
- The current user's avatar and display name render from `useCurrentUser`; a user with no avatar shows initials, not a broken image.
- A `+` create-task control is present in the header on every view.
- All three are in the same position on `/list`, `/board`, and `/timeline` — the header does not reorder per route.

### SHL-3 · M1 · major · P8 P10
**The avatar menu offers Switch user, Settings, and a theme toggle.** Open the header avatar menu.

- The menu contains exactly those three affordances (plus any explicitly scoped additions), each labelled in the same vocabulary the CLI/Settings use.
- "Switch user" lists the tracker's non-archived users; the current user is marked as current.
- Selecting a different user updates the header immediately and subsequent writes are attributed to that user (verify via a task's activity entry).
- "Settings" navigates to the settings route; the menu closes on selection.

### SHL-4 · M1 · blocker · P2 P8
**The Views group navigates between List, Board, and Timeline with the active route highlighted.** Click each of List, Board, Timeline in turn.

- Each click changes the URL to `/list`, `/board`, `/timeline` respectively.
- Exactly one Views entry carries the active highlight at any time, and it matches the current URL.
- Loading `/board` directly by URL highlights Board — the highlight derives from the route, not from click history.
- The highlight is not conveyed by colour alone (see [flow-accessibility.md](flow-accessibility.md) A11Y-30).

### SHL-5 · M1 · major · P3 P2
**The Projects group lists projects with the default highlighted.** On a tracker with three projects, one marked default in `projects.yaml`.

- All non-archived projects render with their `label`, in config order.
- The workspace default (or the user's default when set) is visually marked as the active project.
- Clicking a project scopes the current view to it and reflects that in the URL, so the scoped view is shareable.
- Archived projects do not appear in the group.

### SHL-6 · M1 · blocker · P2 P10
**The five live built-in saved filters click through to URL filter state.** Click Assigned to me, Reported by me, Due this week, Overdue, and High priority in turn.

- Each sets filter state in the URL such that pasting the URL into a new tab reproduces the same result set.
- The resulting result set matches what the equivalent `loctt list --query` returns for the same filter — no UI-only filter semantics.
- The clicked filter is marked active in the sidebar while its state is in the URL, and stops being marked active once the user changes the filters.

### SHL-7 · M1 · major · P9
**Built-in saved filters show live count badges.** Same five filters, on a tracker where each matches a different non-zero number of tasks.

- Each badge shows the total from `/api/tasks` for that filter's query, not the count of the current page.
- The badge for a filter matching zero tasks shows `0`, not a blank.
- Creating a task that matches a filter updates that badge without a full page reload (on refetch at the latest).

### SHL-8 · M1 · blocker · P4 P6
**"Mentions me" renders without a count and is non-interactive until M2.4.** Inspect the Mentions me entry on an M1 build.

- It renders in the Saved filters group in its final position, so the group doesn't reorder when it goes live.
- It shows **no** count badge — not a `0`, which would be a false claim about the data.
- It is not clickable and does not navigate; the disabled state is conveyed by more than colour and is exposed to assistive tech (see A11Y-31).
- Hovering or focusing it explains why it is inert and when it arrives ("Available once comments land"), rather than being silently dead.

### SHL-9 · M1 · major · P3 P6
**Milestones, Sprints, and Labels groups render from config.** On a tracker with several of each.

- Each group lists its entries using the `label` from the corresponding config file, not the raw `key`.
- Clicking an entry filters the current view to it and reflects that in the URL.
- Archived entries are excluded from the groups.
- A group whose config file has no entries renders an explicit empty affordance rather than vanishing.

### SHL-10 · M1 · major · P1 P6
**Recently viewed renders from `GET /api/recents`.** On a tracker where several tasks have been opened.

- Entries render key + title, most recent first, and link to `/tasks/$key`.
- The list reflects the recents file on disk; it is not maintained purely in browser memory (verify by reloading with a cold cache).
- Entries whose task has been deleted do not appear (the server drops them), and do not render as broken links.

### SHL-11 · M1 · major · P4 P6
**The sidebar footer shows the workspace label and a Settings link.** Look at the bottom of the expanded sidebar.

- The workspace label from `TrackerInfoResponse.cwd` renders (abbreviated form, e.g. `~/code/myapp`), so a user with two `loctt ui` windows open can tell them apart.
- A Settings link sits alongside it and navigates to the settings route.
- The footer stays pinned to the bottom of the sidebar and does not scroll away with the groups.

### SHL-12 · M1 · major · P8
**Sidebar collapse state persists to `localStorage` across reloads.** Collapse the sidebar, reload, then navigate to another view.

- The sidebar is still collapsed after the reload and after route changes.
- Expanding and reloading restores the expanded state.
- The persisted value is scoped so two different trackers served on different ports don't fight over one key (or the key is deliberately global — whichever, it is consistent and documented).

### SHL-13 · M1 · major · P6 P7
**The schema banner appears above the shell when the schema is not `current`.** Serve a tracker whose `.schema-version` is behind.

- The banner renders above the header/shell, spanning full width, and is visible without scrolling on every route.
- The rest of the app remains navigable — the banner informs, it does not blank the page.
- On a `current` tracker the banner is absent entirely and reclaims no vertical space.

### SHL-14 · M1 · blocker · P8
**Theme switches between light, dark, and system.** Use the theme toggle in the avatar menu.

- Light and dark each apply immediately across the header, sidebar, main pane, banner, and any open menu — no region stays in the old theme.
- "System" follows the OS setting, and changing the OS setting while the app is open flips the theme without a reload.
- The choice persists across reloads and across route changes.

### SHL-15 · M1 · blocker · P2
**Browser back and forward move between views without leaving the app.** Navigate List → Board → a filtered List → Timeline, then press Back three times.

- Each Back step undoes exactly one navigation, in reverse order, including the filter change.
- No Back step exits the app or lands on a blank route.
- Forward re-applies the steps in order and restores the same filter state.

### SHL-16 · M1 · major · P2 P6
**An unknown route renders a designed 404.** Navigate to `/nonsense`.

- A 404 state renders **inside** the shell — header and sidebar still present and functional.
- It names the problem (that page doesn't exist), shows the path requested, and offers a way back (link to the list view).
- It does not render a framework default error page or a blank pane.

## B. Edge cases

### B.1 Sidebar and layout

### SHL-17 · M1 · major · P6
**A corrupt `localStorage` value for the sidebar state falls back to the default.** Set the sidebar key to `"banana"`, `"null"`, or a JSON object of the wrong shape, then reload.

- The app renders with the default (expanded) sidebar; it does not crash, render a sidebar of zero width, or throw at boot.
- The bad value is replaced with a valid one on the next toggle, so the corruption is self-healing.
- No error toast is shown for this — it's recoverable and not the user's problem.

### SHL-18 · M1 · major · P6
**`localStorage` disabled or throwing does not break the shell.** Load the app in a browser with storage blocked (private mode with storage disabled, or a `SecurityError` on access).

- The shell renders normally with the default sidebar state.
- Toggling the sidebar still works for the session; it simply doesn't persist across reloads.
- No unhandled exception reaches the error boundary, and no error toast fires on every render.
- Theme selection degrades the same way — it works in-session even if it can't persist.

### SHL-19 · M1 · minor · P9
**A 200-character workspace path in the footer does not break the sidebar.** Serve from a deeply nested directory.

- The footer label truncates within the sidebar width; the sidebar does not widen and the page body does not scroll horizontally.
- The full label is available on hover and on keyboard focus.
- The Settings link stays visible and clickable.

### SHL-20 · M1 · minor · P9
**A 20-item Recently viewed list stays usable.** Open twenty distinct tasks, then look at the sidebar.

- The group either caps at a documented number of entries or scrolls within its own bounds — it does not push the footer off-screen.
- Long task titles truncate with an ellipsis on one line; a long title does not wrap to three lines and shove the rest of the group down.
- The sidebar's own scroll does not scroll the main pane.

### SHL-21 · M1 · minor · P9 P3
**A tracker with many projects and labels keeps the sidebar navigable.** Configure 30 projects and 40 labels.

- The sidebar scrolls as a whole (or per-group) rather than growing beyond the viewport with no way to reach the footer.
- Group headers remain identifiable while scrolling.
- The footer with the workspace label and Settings link is still reachable.

### SHL-22 · M1 · minor · P9
**A very long project or label name truncates rather than widening the sidebar.** Add a 120-character label name.

- The entry truncates with an ellipsis; the sidebar width is unchanged.
- The full name is available on hover and on focus.
- The label's colour swatch and count badge remain visible — truncation eats the text, not the metadata.

### SHL-23 · M1 · major · P6 P9
**A saved filter whose count query is slow does not hold up the sidebar.** Make one built-in's count query take ten seconds.

- The other four badges render as soon as their own queries resolve; they do not wait on the slow one.
- The slow badge shows a pending affordance in a slot that already reserves its final width, so nothing shifts when it lands.
- The filter itself remains clickable while its badge is pending — the count is decoration, not a gate.
- If the count query never resolves, the badge eventually shows an unavailable affordance rather than spinning forever.

### SHL-24 · M1 · minor · P6
**Collapsing the sidebar keeps the current view's state intact.** Apply filters on `/list`, collapse the sidebar, expand it again.

- The URL is unchanged and the result set is unchanged; collapsing is pure chrome.
- No refetch of the task list is triggered by the collapse.
- In the collapsed state, group icons remain identifiable and expose their names on hover/focus.

### B.2 Routing, theme, and scroll

### SHL-25 · M1 · major · P2
**Scroll position is restored when navigating back to a scrolled list.** Scroll far down `/list`, open a task, press Back.

- The list returns to approximately the previous scroll offset rather than jumping to the top.
- Restoration happens after rows render, not before, so it doesn't land on a position that then collapses.
- Forward-navigating again to the task and back again restores the position a second time.

### SHL-26 · M1 · minor · P2
**A fresh navigation starts at the top.** From a scrolled `/list`, click Board in the sidebar.

- The board renders scrolled to the top; it does not inherit the list's scroll offset.
- Returning to the list via Back still restores the list's own offset (per SHL-25).

### SHL-27 · M1 · minor · P2
**Reloading a deep-linked filtered view reproduces it exactly.** Copy the URL of a filtered, sorted, paginated list and open it in a new tab.

- Filters, sort column and direction, page, active project, and archived toggle all match the source tab.
- The sidebar highlights whatever built-in filter corresponds to that state, if any.

### SHL-28 · M1 · minor · P6
**`prefers-reduced-motion` suppresses shell transitions.** Enable reduced motion at the OS level and toggle the sidebar and theme.

- The sidebar collapse is instant rather than animated; the theme change does not cross-fade.
- Nothing becomes unusable — states still change, they just don't animate.

### SHL-29 · M1 · minor · P8
**The theme survives a hard reload with no flash of the wrong theme.** Set dark theme, then hard-reload.

- The page paints dark on first frame; there is no visible white flash before the theme applies.
- The same holds for "system" when the OS is set to dark.

### SHL-30 · M1 · minor · P2
**Back from a 404 returns to the previous real view.** From `/list`, navigate to `/nonsense`, press Back.

- The list view returns with its previous state intact.
- The 404 does not trap the user or require two Back presses.

### SHL-31 · M1 · minor · P9 P6
**Two `loctt ui` instances for different trackers are distinguishable.** Serve two trackers on different ports and open both.

- Each footer shows its own workspace label, and the labels differ.
- Sidebar contents (projects, labels, counts) reflect each tracker independently.
- Toggling the sidebar in one window does not visibly fight with the other on the next reload (whether state is shared or per-port, the behaviour is consistent and not oscillating).

### SHL-32 · M1 · major · P7
**A saved view referenced by a sidebar pin but deleted from `queries.yaml` degrades quietly.** Delete a pinned saved view from the config while the UI is open, then refresh.

- The stale entry is dropped from the sidebar rather than rendering as a broken item or crashing the group.
- The rest of the Saved filters group renders normally.
- No error toast fires — a config the user edited themselves is not an error condition.

### SHL-33 · M1 · minor · P3
**A workflow with an unusual number of statuses does not distort the shell.** Configure ten statuses.

- The sidebar and header are unaffected — no group grows unbounded.
- Views group entries are unchanged; status count is a main-pane concern.

## C. Error cases

### C.1 Schema state — four distinct failure kinds

Each of these is a *different* condition with a *different* remedy. A
single generic "schema problem" banner covering more than one of them is
a violation of P4.

### SHL-34 · M1 · blocker · P4 P7
**`.schema-version` missing renders a "not a recognized tracker" banner.** Serve a tracker whose `.schema-version` file has been deleted (a legacy or hand-assembled `.loctt/`); `schemaStatus.kind` is `missing`.

- The banner states that `.loctt/` exists but has no recorded schema version, so LocTT cannot tell what format the data is in.
- The next action offered is running `loctt migrate` in the terminal to stamp and upgrade the tracker — **not** "reinitialize", which would risk data.
- The banner does **not** say the tracker is out of date; the version is unknown, not old.
- No version numbers are displayed, because none are known — the banner does not print `undefined` or `0`.
- The app does not route to `/init`; the directory is not uninitialized.

### SHL-35 · M1 · blocker · P4 P7
**A recorded version GREATER than current renders an "app is too old" banner.** Serve a tracker whose `.schema-version` is ahead of `CURRENT_SCHEMA_VERSION`; `schemaStatus.kind` is `future`.

- The banner states that this tracker was written by a newer version of LocTT and that **this app is too old to read it safely**.
- It shows both numbers: the on-disk version and the version this build supports.
- The next action is to **upgrade LocTT** (e.g. `npm install -g @loctt/cli@latest`), not to migrate.
- The banner explicitly does **not** offer `loctt migrate`, and in M4 does **not** render a "Migrate now" button — migration cannot help here and offering it would invite data loss.
- Writes are blocked or clearly marked unsafe rather than proceeding against a format the app doesn't understand.

### SHL-36 · M1 · blocker · P4 P7
**A recorded version LESS than current renders a "run `loctt migrate`" banner.** Serve a tracker whose `.schema-version` is behind; `schemaStatus.kind` is `outdated`.

- The banner states that the tracker is on an older schema and shows both the on-disk and current version numbers.
- The next action is the literal command `loctt migrate`, presented as copyable text.
- It notes that migration takes a backup before changing anything, so the user isn't afraid to run it.
- In M1 there is **no** "Migrate now" button — this kind, and only this kind, gains one in M4.3.
- The banner is distinct in wording from SHL-35: "your tracker is behind the app" reads differently from "the app is behind your tracker".

### SHL-37 · M1 · blocker · P4 P7 P5
**The `.schema-migration-in-progress` sentinel renders a crashed-migration banner and blocks boot.** Place the sentinel file in `.loctt/` and start `loctt ui`.

- Every entry point refuses to boot; the UI either fails to start with a terminal message, or renders a blocking screen — it does **not** render a normal, browsable shell.
- The message states that a previous migration did not finish and the tracker may be mid-upgrade.
- It surfaces the sentinel's recorded details: the `from` version, the `to` version, and the **backup path** (`.loctt.backup-v<from>-<ts>-<rand>/`).
- The next action is concrete manual recovery — inspect the backup, restore it if needed, then remove the sentinel — not "retry" and not "migrate now".
- No write path is reachable from this state. No button in the UI can delete the sentinel, because doing so blindly would resume against a half-migrated tracker.
- This is a distinct screen from SHL-34/35/36, not a variant of the banner.

### SHL-38 · M1 · major · P4 P7
**An unknown schema status is honest about being unknown.** Force `schemaStatus.kind` to `unknown` with a message (e.g. `.schema-version` contains `abc`).

- The banner states what was attempted (reading the tracker's schema version), that the result could not be interpreted, and includes the server-supplied `message`.
- It states what the user's data state is: untouched, nothing has been changed.
- The next action is concrete — inspect `.loctt/.schema-version`, or run `loctt doctor`.
- It does not fall back to the `outdated` copy and does not suggest `loctt migrate` as if the situation were understood. This is P4's rare exception (see [flow-error-handling.md](flow-error-handling.md) § F), and it still names attempt, data state, and next action.

### C.2 Shell and data failures

### SHL-39 · M1 · major · P4 P6
**A sidebar group whose request fails shows a scoped error, not a missing group.** Make the labels request return 500 while everything else succeeds.

- The Labels group renders with an inline failed state naming what failed and offering retry.
- The group does not silently render empty — "no labels" and "couldn't load labels" are different claims and must look different.
- Other groups and the main pane are unaffected.

### SHL-40 · M1 · major · P4 P6
**The current-user request failing degrades the header without breaking it.** Make `useCurrentUser`'s request fail.

- The avatar area shows an explicit unknown-user affordance, not a blank circle and not a default name that implies a real identity.
- The menu still opens and Settings is still reachable.
- Any action that would write attributed to a user is blocked with a message naming the reason (the current user could not be determined) rather than writing under a guessed identity.

### SHL-41 · M1 · blocker · P4 P6
**The server going away mid-session is reported, not silently swallowed.** Stop the `loctt ui` process while the browser is open, then click around.

- The next failed request produces a persistent, visible state (banner or blocking overlay) saying the LocTT server is not responding.
- The message tells the user the concrete next action: the terminal running `loctt ui` may have stopped; restart it.
- Views do not render as empty in the meantime — an unreachable server must never look like a tracker with no data.
- When the server comes back, retrying (or the next successful poll) clears the state without a manual reload.

### SHL-42 · M1 · major · P4
**A route-level render failure is caught by the error boundary inside the shell.** Force a component in the main pane to throw.

- The header and sidebar survive; only the main pane is replaced by the error state, so the user can navigate away.
- The message says what was being displayed, that the failure is a bug rather than a data problem, and offers reload plus a way back to the list.
- No raw stack trace is presented as the primary message.

### SHL-43 · M1 · minor · P4 P7
**A malformed config file names the file.** Corrupt `labels.yaml` (invalid YAML) and reload.

- The error names the specific file (`.loctt/config/labels.yaml`), states it could not be parsed, and includes the parse error's location if the server provides one.
- It offers the next action (fix the YAML, or run `loctt doctor`).
- Features not dependent on that file continue working — a broken `labels.yaml` does not take down the task list.

### SHL-44 · M1 · minor · P4 P2
**A deep link to a task that does not exist 404s inside the shell.** Open `/tasks/T-99999` on a tracker where that key was never allocated.

- A task-not-found state renders in the main pane with the shell intact.
- It names the key that was requested and distinguishes "no such key" from "you don't have it loaded".
- It offers a way back to the list. It does not redirect silently, which would hide the fact that a shared link is dead.

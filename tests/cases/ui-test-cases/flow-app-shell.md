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

> **Amended (K158, Ken 2026-09-29).** "Views" now names the section of
> built-in and saved views (SHL-50). The List / Board / Timeline group
> this case covers is stored as `layouts` and labelled "Layouts (List /
> Board / Timeline)" in Customize sidebar, so the two are not confused.

### SHL-5 · M1 · major · P3 P2
**The Projects group lists projects with the default highlighted.** On a tracker with three projects, one marked default in `projects.yaml`.

- All non-archived projects render with their `label`, in config order.
- The workspace default (or the user's default when set) is visually marked as the active project.
- Clicking a project scopes the current view to it and reflects that in the URL, so the scoped view is shareable.
- Archived projects do not appear in the group.

### SHL-6 · M1 · blocker · P2 P10
**The six live built-in saved filters click through to URL filter state.** Click Assigned to me, Reported by me, Mentions me, Due this week, Overdue, and High priority in turn. (Each is live once its precondition holds — the three user filters need a current user; "Mentions me" (CMT-10) also needs a task whose comment mentions that user to produce a non-empty result.)

- Each sets filter state in the URL such that pasting the URL into a new tab reproduces the same result set.
- The resulting result set matches what the equivalent `loctt list --query` returns for the same filter — no UI-only filter semantics.
- The clicked filter is marked active in the sidebar while its state is in the URL, and stops being marked active once the user changes the filters.

### SHL-7 · M1 · major · P9
**Built-in saved filters show live count badges.** Same five filters, on a tracker where each matches a different non-zero number of tasks.

- Each badge shows the total from `/api/tasks` for that filter's query, not the count of the current page.
- The badge for a filter matching zero tasks shows `0`, not a blank.
- Creating a task that matches a filter updates that badge without a full page reload (on refetch at the latest).

> **Amended (K158, Ken 2026-09-29).** The badge is now the count in the
> row's trailing slot, capped at "99+" with the true total in the row's
> tooltip (SHL-51, VUE-16), and saved views show counts too (SHL-53).

### SHL-8 · M1 · blocker · P4 P6
**"Mentions me" is an active built-in filter when a current user is set, and inert only when there is none.** It resolves to `comment_mentions = currentUser()` (CMT-10 / A183), so it behaves exactly like the other user-scoped filters ("Assigned to me", "Reported by me").

- It renders in the Views section (K158, Ken 2026-09-29 — K125 had put
  the built-ins in a "Filters" section of their own; they are back in
  one "Views" section with the saved views) in its stored position, so
  the section order is stable.
- **With a current user set** (the default — `init` bootstraps one): it is a real link that navigates to the filter state, and it carries a count badge like the other live filters (the count may be `0` when no comment mentions the user, which is an honest count, not a blank).
- **With no current user** (the same precondition that makes "Assigned to me" inert): it renders inert — not clickable, no count. The disabled state is conveyed by more than colour and is exposed to assistive tech (see A11Y-31), and hovering or focusing it explains it is unavailable, rather than being silently dead. The explanation is the generic user-filter one, not a "comments land" promise (that feature has shipped).

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
**The window title names the project, and the sidebar footer holds a Settings link.** Read the browser tab / window title, then look at the bottom of the expanded sidebar.

- The document title is `LocTT — <project> — <view>` (e.g. `LocTT — Mobile App — Board`), so a user with two `loctt ui` windows open can tell them apart from the tab strip alone. The project named is the one the window is scoped to: the sole `?project=` filter value when exactly one is selected, otherwise the workspace's effective default.
- When no project resolves — several projects filtered at once, a filter id naming no project, or a tracker with no default — the title falls back to `<view> · LocTT`. It never renders an empty segment or a placeholder in the project's place.
- Nothing is added to the page for this: no workspace label, no filesystem path, no header or sidebar element.
- A Settings link sits in the footer and navigates to the settings route.
- The footer stays pinned to the bottom of the sidebar and does not scroll away with the groups.

### SHL-12 · M1 · major · P8
**Sidebar collapse state persists to `localStorage` across reloads.** Collapse the sidebar, reload, then navigate to another view.

- The sidebar is still collapsed after the reload and after route changes.
- Expanding and reloading restores the expanded state.
- The persisted value is scoped so two different trackers served on different ports don't fight over one key (or the key is deliberately global — whichever, it is consistent and documented).

### SHL-13 · M1 · major · P6 P7
**The schema banner appears above the shell when the schema is not `current`.** Serve a tracker whose `.schema-version` is behind.

- The banner renders above the header/shell, spanning full width, and is visible without scrolling on every route.
- For `future`, `missing` and `unknown`, the rest of the app remains navigable — the banner informs, it does not blank the page. **Navigable is not readable:** the server's schema guard returns 409 for every `/api/` route while the mismatch stands, so each view renders its shell and then an explained error rather than data. A user can move around and read the explanation; they cannot see or change tasks.
- On a `current` tracker the banner is absent entirely and reclaims no vertical space.
- `outdated` is not a banner: the Upgrade screen replaces the shell (ONB-C17), because nothing but upgrading can work there.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic upgrade (*"these stories are ai-created so i wouldnt completely treat is source of truth"*) and asked for a designed Upgrade banner (*"get ui agent to design banner if needed"*). An older tracker now gets the Upgrade screen instead of this banner over a navigable shell.

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

- Filters, sort column and direction, page, and active project all match the source tab.

> **Amended (K121 #1, Ken 2026-09-23).** Ken: *"i think i want to not allow viewing archived stuff. thats the point of archiving."* … *"remove everywhere. i dont even want a debug switch."* Dropped "archived toggle": there is none.
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

- Each window's title names its own project, and the two titles differ. Trackers whose projects share a name read alike — the projects are renameable, and that is the affordance for telling them apart.
- Sidebar contents (projects, labels, counts) reflect each tracker independently.
- Toggling the sidebar in one window does not visibly fight with the other on the next reload (whether state is shared or per-port, the behaviour is consistent and not oscillating).

### SHL-32 · M1 · major · P7
**A saved view deleted from `queries.yaml` while the sidebar lists it degrades with a visible explanation.** Delete a saved view from the config while the UI is open, then refresh.

This case previously asserted the entry was dropped silently. P7 admits
no carve-out for per-user preference drift (see README): a view that
vanishes without explanation is drift the user cannot account for, even
when they made the edit themselves — they may have edited a different
view, or on a different machine.

- The stale entry does not render as a broken item and does not crash the group.
- The user is told the view was removed — inline in the group, naming the view, and dismissible. Dismissing forgets the notice.
- The rest of the Views section (K158, Ken 2026-09-29 — was "Saved
  views" under K125, "Saved filters" before that) renders normally.
- **No error toast fires** — this is an explanation, not an error. A config the user edited themselves is not an error condition, but it is not invisible either.

> **Amended (K159, Ken 2026-09-29).** Ken chose **"Retire pins"**. This case named a sidebar pin; pins no longer exist. The notice is about a saved view the sidebar listed, and dismissing it now only forgets the notice.

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
- The next action offered is writing the tracker's format version into `.loctt/.schema-version` (`loctt doctor` says which) and reloading — **not** `loctt migrate`, which refuses a tracker with no recorded version (A366), and **not** "reinitialize", which would risk data.
- The banner does **not** say the tracker is out of date; the version is unknown, not old.
- No version numbers are displayed, because none are known — the banner does not print `undefined` or `0`.
- The app does not route to `/init`; the directory is not uninitialized.

### SHL-35 · M1 · blocker · P4 P7
**A recorded version GREATER than current renders an "app is too old" banner.** Serve a tracker whose `.schema-version` is ahead of `CURRENT_SCHEMA_VERSION`; `schemaStatus.kind` is `future`.

- The banner states that this tracker was written by a newer version of LocTT and that **this app is too old to read it safely**.
- It shows both numbers: the on-disk version and the version this build supports.
- The next action is to **upgrade LocTT** (e.g. `npm install -g loctt@latest`), not to migrate.
- The banner explicitly does **not** offer `loctt migrate`, and in M4 does **not** render a "Migrate now" button — migration cannot help here and offering it would invite data loss.
- Writes are blocked or clearly marked unsafe rather than proceeding against a format the app doesn't understand.

### SHL-36 · M1 · blocker · P4 P7
**A recorded version LESS than current renders the Upgrade screen.** Serve a tracker whose `.schema-version` is behind; `schemaStatus.kind` is `outdated`.

- The banner states that the tracker is on an older schema and shows both the on-disk and current version numbers.
- The next action is the **Upgrade** button (it runs the same upgrade as `loctt migrate`); the screen names no CLI command.
- It says "A backup is made first." so the user isn't afraid to run it.
- Only this kind offers an upgrade control (SET-30).
- The banner is distinct in wording from SHL-35: "your tracker is behind the app" reads differently from "the app is behind your tracker".

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic upgrade (*"these stories are ai-created so i wouldnt completely treat is source of truth"*) and asked for a designed Upgrade banner (*"get ui agent to design banner if needed"*). Was a banner quoting `loctt migrate` (later with a Migrate now button); the Upgrade screen (ONB-C17) replaces it.

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
- The message says what was being displayed, and offers reload plus a way back to the list.

> **Amended (K120, Ken 2026-09-23).** Dropped "that the failure is a bug":
> under the messaging rules the screen states the data outcome, not an
> explanation of the fault.

> **Amended (K126, Ken 2026-09-24).** Dropped "that the user's tasks were
> not affected". Ken: *"i dont think the 'your tasks werent affected'
> message is needed."*
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

### SHL-45 · M4 · major · P2 P8
**The sidebar's top-level groups can be shown/hidden and reordered.**

- A settings editor lets the user hide or reorder the built-in groups (Projects, Milestones, Sprints, Labels, Recently viewed) and built-in filters.
- The choice is a **per-user setting** and persists across reload.
- Per the which-layer rule, it is exposed on CLI + MCP with both reference docs updated, and it degrades on an unknown/duplicate group id per the corruption-handling guide.
- "Hidden by the user" is not "vanished": this needs a carve-out against SHL-9 bullet 4 / SHL-5 / SHL-10 ("a group whose config file has no entries renders an explicit empty affordance rather than vanishing") — a user-hidden group is a deliberate choice, not a missing config.

> Shape DECIDED (Ken, 2026-09-06): **per-user** settings; built-in groups and filters are **hideable AND reorderable**; exposed on **web + CLI + MCP** (full parity — an agent may configure the UI). Persisted per-user `sidebar_groups`; doctor-tolerant.

> **Amended (K159, Ken 2026-09-29).** Ken chose **"Retire pins"**. This case said the setting mirrors `sidebar_pins`; that setting is retired, and the choice is stored in `sidebar_groups` alone.

> **Amended (K125, Ken 2026-09-24).** Ken: *"Nest under 'Filters'"*. The
> six built-in filters (Assigned to me, Reported by me, Mentions me, Due
> this week, Overdue, High priority) no longer show as six flat top-level
> rows in the Customize-sidebar panel — they nest as children of ONE
> "Filters" group row, which is itself one more reorderable/hideable row
> alongside Projects/Milestones/Sprints/Labels/Recently viewed. Each
> child is still individually reorderable/hideable INSIDE the group.
> - The "Filters" group id (`filters`) is a real, stored `sidebar_groups`
>   entry (a new `SidebarGroupId`), not a presentation-only grouping — so
>   moving it moves the whole block as a unit, and hiding it hides every
>   built-in from the live sidebar regardless of each one's own `hidden`
>   flag.
> - **Migration:** an existing flat stored order from before this
>   ticket (when a filter id could only ever be a top-level entry) still
>   loads. The migrated group is placed at the position of the FIRST
>   individual filter id found in that stored order (falling back to the
>   group's own default catalog slot if none is present); every filter's
>   own inner order and hidden flag is preserved exactly.
> - **Show/Hide is now a Switch** (`ui/Toggle`, `role="switch"`), not a
>   Show/Hide button — Ken: *"yes use switch"*. Each switch is labelled
>   "Show {section} in the sidebar" for assistive tech; the strikethrough
>   previously used to mark a hidden row is removed (the switch carries
>   the state).
> - **Switching the group off disables its children.** Ken: *"when an
>   item is switched off, disable switching/reordering its child items
>   too"* — while the "Filters" group's own switch is off, every child's
>   switch AND its drag-reorder handle are disabled (still visible,
>   clearly inactive; not hidden).
> - CLI/MCP need no change beyond the new `filters` id joining the same
>   `order`/`hidden` flat-list catalog they already validate against
>   (`get_sidebar_groups`/`set_sidebar_groups`, `loctt user
>   sidebar-groups`) — parity holds automatically.
>
> **Amended again (K125 gap fix, Ken 2026-09-24).** The build above gave
> `filters` a real stored identity but no live-sidebar row of its own —
> the six built-ins kept rendering inside the "Views" section (saved
> views), so moving "Filters" in the Customize-sidebar panel changed
> nothing visible. Ken: *"As built, the customiser shows a movable
> 'Filters' row, but Sidebar.tsx returns null for case "filters" and
> still renders the six built-ins inside the saved-filters section
> (heading 'Views') above the saved views. So moving 'Filters' in the
> customiser changes nothing, which is the disconnect Ken complained
> about."* Fixed: the built-ins now render in their OWN section, headed
> "Filters", at the `filters` group's resolved position in the stored
> order — moving or hiding it in the panel now moves or hides a real
> section, the same way every other group already works. The
> saved-views-only section is renamed "Saved views" in BOTH the sidebar
> heading and the Customize-sidebar panel's own row label (was "Views"
> in the sidebar, "Saved filters" in the panel — two different labels
> for the same section, which is its own instance of the "can't map a
> customiser row to a sidebar section" problem) — it now matches the
> Settings "Saved views" page and the "Save as view" button.

> **Amended (K158, Ken 2026-09-29).** Ken: *"why are you splitting
> filters vs saved views?!?! when did you decide this? this is bad. it
> should be 1. then we can re-order them, and we can hide. then all of
> them should show numbers, and custom views can also have the '...' but
> it should align"*. The two groups above (`filters` and `saved-filters`)
> are one `views` group again, whose ordered, hideable children are the
> built-in views and the saved views (`view:<id>`); the List / Board /
> Timeline switcher is `layouts`, labelled "Layouts (List / Board /
> Timeline)" in Customize sidebar. The first bullet's "built-in filters"
> now reads "built-in and saved views, inside the Views group". The
> K125 nesting and disabled-children rules carry over to the Views group
> unchanged. Older stored settings migrate on read (SHL-54); the layout
> is SHL-50.

### SHL-46 · M1 · blocker · P2 P8
**The global header search works.**

- Typing in the header "Search tasks…" box and pressing Enter (or as-you-type) queries `/api/search` and shows results / navigates; a real network request fires.
- The box is not a dead input (the input has no handler today).
- Once wired, `/` focuses it (A11Y-2 becomes reachable).

### SHL-47 · M1 · minor · P6
**The brand loading mark spins in place about its own centre at every rendered size — it never orbits or drifts out of its box.** The mark appears wherever `LoadingState` or a loading `Button` renders (onboarding submit, panel loads, `DiagnosticsPanel`), at sizes from ~18px to 32px+.

Ken reported it directly: "the spinner svg is misaligned." The mark
(`LogoSpinner`, class `loctt-spin` on the outer `<svg>`) rotates via a
CSS animation; the pivot is `transform-origin`, and on an outer `<svg>`
that property is measured in CSS pixels of the *rendered box*, not in
`viewBox` units. A rule copied from the source SVG's native 64px
(`32px 32px`) is only centred at 64px — at the app's 21–24px sizes it
sits past the bottom-right corner, so the mark swings in a visible
orbit instead of rotating on the spot.

- At every size the app renders the mark (at minimum 21px, 24px, and
  64px), its bounding box stays fixed through the whole animation cycle
  — the box does not translate, grow, or drift as the mark rotates.
- The visual centre of the mark (the "L"/"o" pivot) coincides with the
  centre of its bounding box at every size, not only at one specific
  size the rule happened to be tuned for.
- This holds independent of `prefers-reduced-motion` — a reduced-motion
  user who still sees the frozen frame sees it centred, not offset.

### SHL-48 · M4 · minor · P8
**Chrome that summarises a Settings concept deep-links to the section that owns it, rather than leaving the user to hunt.** The header's user menu, and the `?` shortcut-reference overlay's footer.

- The user menu's generic "Settings" catch-all link is kept, but sits alongside differentiated items — "My profile" (anchored at the current user's row in Settings → Users), "My preferences", and "Customize sidebar" — each pointing at the exact section that owns the concept, not the Settings landing page.
- "My profile" is omitted (not shown pointing at a dead anchor) when the signed-in identity is unknown; the identity-independent items stay reachable.
- The `?` shortcut overlay's footer links to Settings → Keyboard, the full rebindable reference the overlay itself only summarises.
- Following any of these deep links closes the originating overlay — a modal layer left open over the destination panel would trap focus.

> Added (2026-09-23) to cover behaviour four tests already asserted
> under an invented `CONFIG-5` tag (`Header.test.tsx`,
> `ShortcutHelpDialog.test.tsx`) — see `docs/dev/backlog.md` B9.

### SHL-49 · M1 · minor · P6 P8
**The sidebar's Views section (built-in filters and saved views) marks the selected row active, and a saved-view row's trailing kebab lines up with a built-in row's trailing badge.** Sidebar rendered at `/list` with a saved view or a built-in filter selected.

- A saved view selected via `search.view` is marked with `aria-current="page"` and the row's own `data-active` marker, matching the treatment `ItemShell` already gives Projects and the view switcher.
- A built-in filter is marked active when the URL's `q` matches that filter's resolved query exactly; only one row in the Views section is active at a time.
- A saved-view row's trailing kebab (`RowActions`, a sibling of `ItemShell` outside its own padding) carries the same right inset (`pr-2.5`) as `ItemShell` gives a badge-ending row, so both row kinds end at the same right edge instead of the kebab sitting further out.

> Added (2026-09-23) to cover behaviour two tests already asserted under
> an invented `UI-16` tag (`Sidebar.test.tsx`, describe blocks tagged
> `UI-16b`/`UI-16c`) — see `docs/dev/backlog.md` B9.

> **Amended (K158, Ken 2026-09-29).** Ken: *"why are you splitting
> filters vs saved views?!?! ... it should be 1. then we can re-order
> them, and we can hide. then all of them should show numbers, and custom
> views can also have the '...' but it should align"*. The Views section
> is one list of built-in and saved views again (SHL-50). Every row now
> ends in one trailing slot the width of the ⋯ button, holding the count
> at rest and the ⋯ on hover or keyboard focus (SHL-51), so the third
> bullet's "kebab vs badge" alignment is now one shared slot at the same
> right inset (`right-2.5`, `ItemShell`'s `px-2.5`) as a project row's
> kebab.

### SHL-50 · M4 · major · P2 P8
**The sidebar has one "Views" section: the built-in views and the saved views in one ordered, hideable list.** A tracker with at least one saved view, and a user who reordered and hid some views in Customize sidebar.

- One section headed "Views" holds the six built-in views (Assigned to me, Reported by me, Mentions me, Due this week, Overdue, High priority) and every non-archived saved view. There is no separate "Filters" or "Saved views" section.
- The rows render in the user's stored order, built-in and saved views interleaved as the user placed them. A view the user never placed follows the placed ones: built-ins in their default order, then saved views (a new saved view appends at the end).
- A view the user hid is not rendered. Hiding the Views group hides the whole section, heading included.
- "+ New view" is the last row of the section.
- In Customize sidebar the Views group is one row with the built-in and saved views as its children, one level deep, each with its own switch and reorder handle; they reorder within the group only. While the Views group's switch is off, every child's switch and handle is disabled but still visible (K125's rule).
- The List / Board / Timeline switcher's row in Customize sidebar is labelled so it is not confused with Views: "Layouts (List / Board / Timeline)".
- The active-row highlight still marks exactly one row (K118).

> Added (K158, Ken 2026-09-29). Ken: *"it should be 1. then we can
> re-order them, and we can hide"*; order and unhide live in Settings →
> Customize sidebar (*"we have the settings, right? where you can reorder
> things, no?"*), not by dragging in the sidebar.

### SHL-51 · M4 · major · P2 P6
**Every Views row ends in one slot that shows the task count at rest and the ⋯ on hover or keyboard focus, without shifting anything.** The sidebar's Views section on a desktop browser with a mouse.

- Each row reads `[icon] [name] … [slot]`. The slot is exactly the ⋯ button's width, and the count is right-aligned in it.
- A count above 99 reads "99+"; 0 reads "0" (a real zero, not a blank).
- Hovering the row, or giving anything in it keyboard focus, replaces the count with the ⋯ in the same box: the ⋯'s left and right edges equal the count slot's, and the row's icon and name do not move. Leaving the row brings the count back.
- The slot ends at the same x as every other sidebar row's trailing control (a project row's ⋯).
- While a count is loading the slot is already reserved; a count that fails or times out shows an unavailable mark, never a permanent spinner (SHL-23).
- On a touch screen (no hover) the count stays and no ⋯ is offered in the sidebar; the same actions are in Settings (Customize sidebar, Saved views).

> Added (K158, Ken 2026-09-29): *"when you hover, replace task count
> with the '...'. but task count must have same width as the ... button,
> so maybe we make task count go to a max of 99 task, e.g. '99+' for 100
> onwards"*. The touch-screen bullet is the orchestrator's call recorded
> in K158.

### SHL-52 · M4 · major · P2 P5
**A Views row's ⋯ acts on that view: Hide for a built-in; Edit, Rename, Delete and Hide for a saved view.** The ⋯ opened on a built-in row, then on a saved-view row.

- A built-in's ⋯ offers only Hide.
- A saved view's ⋯ offers Edit, Rename, Delete and Hide. Edit and Rename open the existing view dialog (Rename with the name ready to type over); Delete opens the existing delete confirmation.
- Hide writes the per-user hidden flag and the row leaves the sidebar at once, and stays hidden after a reload. Nothing else in the stored order changes.
- A hidden view comes back from Settings → Customize sidebar by switching it on; it returns to its stored position.
- Deleting a saved view from the sidebar also drops it from the user's stored sidebar order in the same settings write, once the delete has landed.

> Added (K158, Ken 2026-09-29): *"custom views can also have the '...'
> but it should align"*; built-ins' ⋯ = Hide, saved views' ⋯ = Edit,
> Rename, Delete, Hide.

> **Amended (K159, Ken 2026-09-29).** Ken chose **"Retire pins"**. The stored-order clean-up on delete no longer also drops a pin; pins no longer exist.

### SHL-53 · M4 · major · P2 P6 P7
**Saved views show task counts too, and a broken saved view shows a warning mark instead.** A tracker with a saved view matching several tasks and a saved view whose filters no longer load (a hand edit to `queries.yaml`).

- A healthy saved view's count is the same number clicking it lists (the count is the list's own request for that view).
- The count updates after a task is created or edited that the view matches, without a full reload.
- A broken saved view shows a warning mark in the slot instead of a number. The mark has an accessible name ("Broken view") and its tooltip gives the parse error. The row is still a link (VUE-22), and its ⋯ offers Edit (the confirmed-replacement repair, VUE-42), Delete and Hide.

> Added (K158, Ken 2026-09-29): *"then all of them should show numbers"*;
> K158: *"Saved views show counts too; a broken view shows a warning mark
> instead."*

### SHL-54 · M4 · major · P1 P7 P8
**The one Views group is stored per user as one `views` group, a setting from before it is migrated without losing the user's order or hidden choices, and CLI and MCP read and write the same ids.** Per-user `sidebar_groups` in `settings.yaml`.

- The stored setting carries `version: 2`. Its groups are `layouts` (List / Board / Timeline), `projects`, `views`, `milestones`, `sprints`, `labels`, `recents`. The Views group's children are the built-in ids and `view:<id>` for each saved view, ordered by their relative position in `order` and hidden by `hidden`.
- A setting written before K158 (no `version`; `views` was the switcher; built-ins under `filters`, saved views under `saved-filters`) still loads and renders the way it did: the switcher's entry becomes `layouts` with its hidden flag; the one Views group sits where the earlier of Filters and Saved views sat; the children are the old sections' rows in the order they rendered (the built-ins' stored order, the saved views' pinned-then-file order, where a `sidebar_pins` value left from before K159 supplies the pinned ones); a hidden Filters or Saved views group hides each of its views; only when both were hidden is the Views group hidden. The first change after that writes the K158 shape.
- A deleted saved view drops out of the order; a new saved view appends.
- A malformed id (not a group, not a built-in, not `view:<id>`), a duplicate, a stray key or an unknown `version` is dropped field-locally on load: the rest of the setting still applies and `loctt doctor` names what was dropped. A `view:<id>` whose view no longer exists is not corruption: it is skipped when the sidebar resolves. A pre-K158 value is not reported.
- `loctt user sidebar-groups` and MCP `get_sidebar_groups`/`set_sidebar_groups` use these ids and report the resolved list the web sidebar renders: every group, the Views children straight after `views` (a saved view with its name, and `broken` when it no longer loads), and every child hidden while the Views group is hidden. A write naming an unknown id, including `view:<id>` for a view that does not exist, is refused, naming it.

> Added (K158, Ken 2026-09-29). Storage and migration rule recorded as
> A370.

> **Amended (K159, Ken 2026-09-29).** Ken chose **"Retire pins"**. A `sidebar_pins` value stored before this change is read only by this migration, to order the saved views once; the write that stores the K158 shape drops it, and nothing else reads it.

> **Amended (K160, Ken 2026-09-29).** Ken: *"actually can we just do a migration step: migrate old pins into the sidebar? i dont want to support this backward compatibility forever."* The migration above is no longer done on read: the 0.3.0 → 0.4.0 upgrade step converts every user's settings file once by the same rule, the pins seeding the saved views (ONB-C23), and deletes `sidebar_pins`. After it only the `version: 2` shape is read. A value without `version: 2` is corrupt: the sidebar shows the default layout (field-local) and `loctt doctor` names the file, telling the user to run `loctt migrate` if the tracker is older, or to reset the layout; a leftover `sidebar_pins` is ignored and reported the same way. The second bullet's "still loads and renders the way it did" and the fourth bullet's "A pre-K158 value is not reported" hold only until the upgrade.

# Flow: error handling

The cross-cutting quality bar every failure in the web UI must clear —
P4 made testable. Domain-specific failures (a rejected status value, an
archived-reference guard, a bad drag target) live in each flow doc's
§ C; this doc is about the *shape* of every message: correct placement,
honest state reporting, offered recovery, and no jargon leakage.
Section A is the baseline that must hold for every error the app can
produce, § B is unusual failure shapes, and § C is failures of the
error system itself — including P4's rare exception. Concurrency and
config-drift errors are [flow-cross-surface.md](flow-cross-surface.md);
empty and loading states are [flow-onboarding.md](flow-onboarding.md)
and [flow-list.md](flow-list.md).

## A. Happy path

The baseline behaviours that must hold for **every** error the app can
produce, verified against a representative sample from each category
below.

### Transport

### ERR-1 · M1 · blocker · P4 P6
**The server not running says the LocTT server is unreachable, and does not read as "no tasks".** Start the UI, load `/list`, press Ctrl-C in the terminal, then refresh.

- The message says the LocTT server is not responding and that it may have been stopped in the terminal where `loctt ui` was run — it names the actual likely cause, since this is a local process the user started.
- It does **not** render the empty state, "No tasks found", "0 tasks", or an empty table. A server that is down and a tracker that is empty must be visibly different screens; conflating them reads as data loss.
- The message does not blame the user's network — there is no network involved in a localhost app.
- A retry control is present and is a button the user can press, not a sentence telling them to refresh.

### ERR-2 · M1 · blocker · P4 P6
**The UI recovers on its own when the server comes back.** With the UI in the ERR-1 state, restart `loctt ui`.

- The app reconnects without a manual browser reload — a retry-on-interval or refetch-on-reconnect brings the data back.
- The error surface clears itself; the user does not have to dismiss it manually to see live data.
- Whatever route the user was on is preserved; recovery does not bounce them to `/list`.

### ERR-3 · M1 · blocker · P4 P1
**A request failing mid-write rolls the optimistic update back visibly and says the change was not saved.** Change a field on `/tasks/$key` and kill the server before the response.

- The optimistic value reverts to the prior value on screen, and the reversion is *visible* — the user sees the field snap back, not a silent quiet correction they might miss.
- The message says explicitly that the change was **not saved**. Not "an error occurred", not "failed to update" alone — the data-state claim is present.
- The message names what was being changed: the field and the task key.
- Retry is offered as a control, and retrying re-attempts the same field-level write.
- **This is the single most important error behaviour in the app**: a user must never be able to walk away believing a save succeeded when it did not. Verify by reading the file — if disk disagrees with the last thing the UI implied, this case fails.

### ERR-4 · M1 · blocker · P4 P1
**A write whose outcome is genuinely unknown says so rather than guessing.** Kill the server after the request is sent but before the response arrives.

- The message does not assert "saved" and does not assert "not saved" if the app cannot tell.
- It says the outcome is unknown and tells the user how to find out — reload the page, or check the file / `loctt show <KEY>`.
- It does not auto-retry a non-idempotent write on the user's behalf without saying so, since that could double-apply.

### ERR-5 · M1 · major · P4 P6
**A very slow request shows progress, then a bounded, actionable timeout.** Throttle the API so a request takes 30+ seconds.

- A loading indication appears within a few hundred milliseconds; the UI is not frozen and unlabelled.
- The wait is bounded — the spinner does not run forever. After the timeout the user gets a message and a retry control.
- The timeout message says what was being waited for (loading tasks, saving a field) and, for a write, what state the data is in per ERR-4.
- Interactive controls that would queue a second conflicting request are disabled while one is in flight.

### ERR-6 · M1 · blocker · P4
**A 500 carrying a specific server reason shows that reason verbatim.** Make a route fail with a specific core error, e.g. an archived-reference rejection or a project-resolution failure.

- The reason from the server is what the user reads. It is not flattened to "Server error", "Something went wrong", or "Request failed with status 500".
- The HTTP status code is not the headline. `500` may appear in expandable detail; it is not the sentence the user is given.
- The reason is placed where the action was taken, per ERR-14.
- Whatever core says — e.g. "cannot assign an archived user" — reaches the user in words core chose, because core's error text is already user-facing.

### ERR-7 · M1 · blocker · P4 P6
**A 404 on a resource the UI thought existed names the resource and offers a way out.** Delete a task from the CLI, then click its row in the still-rendered list.

- The message names the task by **key** (`T-12`), never by ULID.
- It says the task was not found, and — where the app can tell — that it may have been deleted from the CLI or another surface.
- A control back to the list is offered; the user is not stranded on a dead route.
- The stale row is removed from the list on the next read; it does not persist as a permanently-404ing entry.

### ERR-8 · M1 · major · P4 P2
**A 404 from a hand-typed or stale URL is distinguishable from an app crash.** Paste `/tasks/T-99999` for a key that never existed.

- A designed not-found state renders inside the app shell — sidebar and header intact — not a blank page and not the top-level error boundary.
- The message names the key that was requested.
- Navigation elsewhere in the app still works from that state.

### Filesystem

### ERR-9 · M1 · blocker · P4 P6 P9
**One malformed `task.md` does not take down the list.** Corrupt the YAML frontmatter of one task, then load `/list` with 50 tasks.

- The other 49 tasks render. The view loads.
- The bad task surfaces as a distinct problem row (or a banner naming it) — it is neither silently dropped nor allowed to crash the render.
- The surface names the **file path** (`.loctt/tasks/<id>/task.md`) and the **parse error** — the specific YAML problem, so the user can go fix it.
- The count is honest: either the total excludes it and the problem surface accounts for it, or the total includes it as a problem row. The user can reconcile what they see with what is on disk.
- Per [flow-cross-surface.md](flow-cross-surface.md) XS-51, the message may confidently attribute this to a hand-edit — atomic writes rule out a torn write.

### ERR-10 · M1 · blocker · P4 P7
**A malformed config file names the file, the failing field, and what was expected.** Break `workflow.yaml` against its Zod schema — a status missing `key`, a sprint with `end_date` before `start_date`, a label with a non-hex colour.

- The message names the config file by path.
- It names the failing field with enough path to find it (e.g. "the third status entry", or `statuses[2].key`).
- It says what was expected — Zod knows this and the UI must not discard it. "workflow.yaml is invalid" alone fails this case.
- The headline is plain language; the raw Zod issue is available on expand, not in the first sentence.
- Views that do not depend on the broken file still load where possible.

### ERR-11 · M4 · major · P4 P1
**A read-only or wrong-ownership `.loctt/` is named as a permission problem, ideally before work is lost.** `chmod -w .loctt` (or change ownership), then use the UI.

- The message says the tracker directory is not writable, names the path, and identifies it as a permissions/ownership problem — not "save failed".
- Detection happens on load or on the first write attempt, so the user learns before typing a long body, not after.
- If it is discovered at save time, the typed content is retained on screen so the user can copy it out.
- The suggested next action is concrete (check permissions on the named path), not "contact support" — there is no support; this is a local tool.

### ERR-12 · M2 · blocker · P4 P1
**Disk full names the cause and does not discard the user's typed content.** Fill the disk, then save a long body.

- The message identifies the disk being full as the cause, rather than reporting a generic write failure.
- It says the change was not saved.
- **The typed content stays in the editor.** The user can select it and copy it out. Nothing clears the buffer on failure.
- A retry control is present, since freeing space and retrying is the actual fix.

### Partial failure

### ERR-13 · M1 · blocker · P4 P9
**A bulk operation where some items fail states the split and names each failure.** Select 20 tasks and bulk-set a status where 3 will be rejected (e.g. archived tasks, or a guard on the target value).

- The result states the split in numbers: 17 succeeded, 3 failed. Not "some items failed".
- **Each failure is named with its own key and its own reason** — not one collapsed message for all three. Three tasks can fail for three different reasons.
- The 17 successes are **not** rolled back — unless rollback is a deliberate, documented design choice, in which case the message says so and the file state matches.
- The 3 failures remain in the selection so the user can retry exactly those, without re-selecting from scratch.
- The list reflects the 17 successes after the operation; it does not show all 20 as changed.
- Verify against disk: `loctt list` agrees with the reported split exactly.

### ERR-14 · M1 · blocker · P4
**Every error appears where the problem is, not only in a corner toast.** Trigger a field-level validation rejection (invalid date, out-of-range custom number) and a bulk failure.

- A field-level rejection renders **at the field** — adjacent to the input, with the field visibly marked invalid.
- A row-level failure in a bulk op is attributable to its row.
- A view-level failure renders in the view's own region.
- A toast may accompany a placed message but must not be the only carrier of information the user needs to act on. A message that exists only in a toast the user has already dismissed is a failing result.
- Focus or scroll brings a placed error into view when it is off-screen after a submit.

### ERR-15 · M1 · blocker · P4
**Recovery is offered as a control, not merely described.** Sample every error surface in the app.

- Where retry is the right action, a **Retry button** exists. "Please try again" as prose with no button fails this case.
- Where reload is the right action, a **Reload button** exists.
- Where the fix is in a different surface (a CLI command, a config file), the exact command or path is shown and is **copyable**, since the user must retype it into a terminal.
- Where nothing can be done in the app, the message says so plainly rather than offering a control that cannot help.

### ERR-16 · M1 · blocker · P4
**No jargon leaks into user-facing copy.** Read every error message the app can produce.

- No raw ULIDs where a key is available. `T-12`, never `01HK2X7N3Q...`.
- No `ZodError` / "Zod validation failed", no `ENOENT`, no `EACCES`, no `422 Unprocessable Entity`, no `TypeError: Cannot read properties of undefined`.
- No React component names, no file paths from the LocTT source tree, no stack traces in the headline.
- Detail *may* be available behind an expand/"Show details" affordance for a bug report — it just is not the headline.
- Filesystem paths inside `.loctt/` are the exception and *should* appear, because they are the user's own files and the thing they must go fix.

### ERR-17 · M1 · major · P4 P6
**Errors are dismissible and coalesce rather than stacking into a wall.** Trigger ten failures in quick succession — e.g. bulk-edit 10 tasks against an unreachable server.

- The user does not get ten toasts. Repeats of the same error coalesce into one surface with a count, or one surface listing the affected items.
- Every error surface can be dismissed, and dismissal does not require hitting a 12px × in a corner.
- Dismissing does not erase state the user still needs: a bulk failure list stays available (or the selection is retained) after the toast is gone.
- Toasts do not cover the controls the user needs to fix the problem.

### ERR-18 · M1 · major · P4 P1
**Every message that reports a failure also reports the data state.** Sample every write-path error in the app.

- Each says one of: the change was saved, the change was not saved, or the outcome is unknown (with how to check).
- None leaves the data state implicit. "Failed to update priority" without a saved/not-saved claim fails this case, because the user's next action depends on it.
- The claim is verifiable against disk in every case tested.

## B. Edge cases

### Unusual failure shapes

### ERR-19 · M1 · major · P4
**A truncated or malformed response body is handled as a failure, not parsed into a broken UI.** Return a truncated JSON payload from a list route.

- The UI treats it as an error rather than rendering half a list or a row of `undefined` cells.
- The message says the response from the LocTT server could not be read, and offers retry.
- The data state claim applies: for a read this is "nothing was changed"; for a write it is the unknown-outcome wording of ERR-4.

### ERR-20 · M1 · major · P4
**A response with the right shape but nonsense values does not silently corrupt the view.** Return a task list where `total` is negative, or a task whose `status` is `null`.

- The count shown is never a negative number or `NaN`.
- A null/absent required field renders as an explicit unknown marker, matching the config-drift treatment in [flow-cross-surface.md](flow-cross-surface.md) XS-22 — not as blank and not as `undefined`.
- Sorting and filtering against such a row do not throw.

### ERR-21 · M1 · minor · P4
**An empty error body from the server still produces a useful message.** Return a 500 with no body.

- The user gets a message naming what was attempted, not an empty toast or a toast reading "Error: ".
- Since the cause genuinely is not available, this is a legitimate instance of the rare exception — it must still meet the three obligations in ERR-30.

### ERR-22 · M1 · major · P4
**A 400/422 from request validation is presented as a field problem, not a protocol problem.** Send a value the server's request schema rejects.

- The user sees which field was wrong and why, at the field.
- The status code and the phrase "validation" do not lead the message.
- If the UI could have caught it client-side, that is a bug worth filing — a well-formed UI should rarely produce a server-side shape rejection. Note any instance found.

### ERR-24 · M4 · major · P4 P1
**An attachment upload failure does not leave a phantom attachment.** Fail an upload mid-transfer.

- No entry appears in the attachments grid for the failed file.
- The message names the file and says it was not attached.
- Retry is offered; retrying does not create a duplicate if the first attempt partially landed.
- Nothing is left in `tasks/<id>/attachments/` — verify by listing the directory.

### ERR-25 · M1 · major · P4 P9
**A bulk op that fails entirely says nothing was applied, distinctly from partial success.** Bulk-edit 20 tasks with the server unreachable.

- The message says **nothing was applied** — 0 of 20 — in wording clearly different from the partial-success wording in ERR-13.
- The full selection is retained so one retry re-attempts everything.
- The list is unchanged; no optimistic changes linger on any row.
- Verify against disk: no task was modified.

### ERR-26 · M1 · major · P4 P9
**A bulk op where every item fails for a different reason lists every reason.** Bulk-set a milestone across 5 tasks each failing differently (archived milestone, deleted task, permission, malformed file, unknown key).

- Five distinct reasons appear, each attached to its task key.
- The list does not truncate silently; if it truncates for length it says how many more there are and offers a way to see them.
- Reasons are not collapsed into a most-common-error summary.

### ERR-27 · M2 · minor · P4 P1
**A body save failure is loud and stays.** Fail a body save with the user still typing.

- The user is told the save failed.
- The indication persists (not a 2-second toast that vanishes while the user is looking at the keyboard).
- Typing continues to work; the editor is not locked.
- Content is retained per ERR-12.

> **Amended (K124, Ken 2026-09-24).** Ken: *"once in editing mode, i think there should be a save button to save, and cancel."* The description no longer auto-saves (TSK-15), so there is no failure "the user did not click a button" for; the first bullet now states the save failure is reported. The rest is unchanged.

### ERR-28 · M1 · minor · P4 P6
**An error state inside a sidebar group is contained to that group.** Fail `GET /api/recents` while everything else is healthy.

- The Recently viewed group shows an error affordance; the other sidebar groups and the main pane are unaffected.
- The affordance is distinguishable from that group's empty state — "couldn't load" and "nothing here yet" are different.
- Retry for that group alone is available, or the group recovers on the next global refetch.

### ERR-29 · M1 · minor · P4
**Two unrelated errors at once are both legible.** Fail a list fetch and a sidebar fetch simultaneously.

- Both are surfaced; the second does not overwrite the first.
- They are attributable to their own regions rather than merged into one ambiguous banner.
- Dismissing one does not dismiss the other.

## C. Error cases

Failures of the error system itself.

### The rare exception

### ERR-30 · M1 · blocker · P4
**A genuinely unknown failure may say the cause is unknown — but must still answer three questions.** Force an opaque fault the app cannot attribute (an unknown error shape thrown from a dependency, a truncated response with no status).

- The message states **what was attempted** — "saving the priority on T-12", not "an operation".
- It states **what state the data is in** — saved, not saved, or possibly partial with how to check.
- It states **what to do next** — retry, reload, or inspect the file / run `loctt show <KEY>` — offered as a control per ERR-15.
- Saying the cause is unknown is permitted *only here*, and only alongside all three of the above.
- **"Something went wrong." with none of those is a FAILING result for this case**, regardless of how genuinely unknown the cause was.

### ERR-31 · M1 · blocker · P4
**The unknown-cause wording is honest about being unknown, not vague to hide a known cause.** Review each place the generic handler can fire.

- Where the app *does* know the cause, it says it. A generic message on a path where the server sent a specific reason is a P4 violation, not a stylistic choice.
- The generic message is not used as a catch-all convenience for errors the developer did not want to enumerate.
- The message does not imply the user did something wrong when the app has no idea what happened.

### ERR-33 · M4 · major · P4
**The generic handler is reachable at all, and is tested.** Confirm the fallback exists rather than assuming it is dead code.

- An intentionally unattributable fault produces the ERR-30 surface rather than an unhandled rejection, a blank region, or a console-only error.
- The fallback is exercised by at least one test, so it does not rot into a path that itself throws.
- The generic handler stays: opaque faults are real, so removing it is not a way to avoid generic copy.

### Error boundaries

### ERR-34 · M1 · blocker · P4 P6
**A render crash is contained to a region where possible, not a white page.** Force a render throw inside one component — a task row, the body editor, one sidebar group.

- The rest of the app keeps rendering: shell, sidebar, header, and unaffected regions stay usable.
- A white page for a crash in one row is a failing result. The top-level boundary is the last resort, not the first.
- Navigation away from the broken region works and clears the boundary.

### ERR-35 · M1 · blocker · P4 P1
**The error boundary makes no claim about the data it cannot back.** Trigger the boundary.

- The message makes no statement about the user's data when nothing was being written.
- It does not claim data *was* saved if a write was in flight; it says the last change may not have been saved.


> **Amended (K120, Ken 2026-09-23).** Previously required naming the
> `.loctt/` path and explaining "a display fault, not a data fault".
> Ken chose the wording *"Your tasks weren't affected."* under the
> messaging rules (`docs/dev/design/messaging.md`): the data-state
> statement stays; the path and the explanation go.

> **Amended (K126, Ken 2026-09-24).** The "Your tasks weren't affected."
> line is removed. Ken: *"i dont think the 'your tasks werent affected'
> message is needed."* Only the in-flight-write warning remains.

> **Amended (K127, Ken 2026-09-24).** The in-flight warning reads
> *"Your changes may not have been saved. Please check and try again."*
### ERR-36 · M1 · blocker · P4 P6
**The error boundary offers reload as a control and names what broke.** Trigger the boundary.

- A **Reload** button is present and works.
- The message names the region that broke in user terms ("the task list", "the description editor"), not the React component name.
- A route-level boundary (the whole main pane) pairs **Reload** with **Back to the task list**. A region-scoped boundary (a sidebar group, a single panel) pairs **Reload** with **Try {region} again** — naming the region, not a generic "Try again" — so a fault contained to one part of the page does not cost the user their whole page state.

### ERR-37 · M1 · major · P4
**Crash detail is retrievable, just not in the headline.** Trigger the boundary and look for the detail.

- The stack trace and component stack are logged to the browser console and/or the `loctt ui` server log.
- A "Show details" / "Copy details" affordance exposes it for a bug report.
- The detail is not shown by default and is not the first thing the user reads.
- The copyable detail includes enough to be useful: the error message, the route, and the LocTT version.

### ERR-38 · M4 · major · P4 P6
**An error in the error surface does not cascade.** Force a throw inside the toast provider or the error-boundary fallback itself.

- The app does not enter an infinite render/throw loop.
- Something legible still reaches the user — at worst a plain static fallback.
- The console still receives the original error, not only the secondary one, so the root cause is not lost.

### Message quality regressions

### ERR-39 · M1 · blocker · P4
**No failure is silent.** Sweep every write path with the server failing.

- Every failed write produces a visible surface. A `console.error` with no UI is a failing result.
- Every failed *read* produces a visible surface too, distinct from an empty result.
- Nothing is swallowed by an empty `catch {}`. Grepping the client for bare catches that neither rethrow nor surface is a legitimate way to run this case.

### ERR-40 · M1 · blocker · P4
**No success is claimed for a failure.** Sweep every write path.

- No success toast fires on a rejected request.
- No optimistic UI state survives a failure — the list, the board, the detail panel all reflect what is on disk after the failure settles.
- Verify against disk after each swept path: what the UI last implied matches `loctt show` / `loctt list`.

### ERR-41 · M1 · major · P4 P6
**An error state and an empty state are never the same rendering.** Compare, side by side: a filter matching nothing, a fresh tracker, an unreachable server, and a failed query parse.

- All four are visibly distinct surfaces with distinct copy.
- The three failure-ish ones (unreachable, parse failure, malformed data) never render the "No tasks found" copy.
- The two legitimate empties never render an error colour or an error icon.

### ERR-42 · M1 · major · P4
**Error copy is written for the person running the tool, not for the developer who wrote it.** Read every message aloud.

- Each names a thing the user recognizes: a task key, a field label from `workflow.yaml`, a file under `.loctt/`, a `loctt` command.
- None uses internal vocabulary the user has never seen: "mutation", "query key", "hydration", "core", "contracts", "route handler", "serializer".
- None apologizes at length in place of information.
- Each fits in one or two sentences before any expandable detail.

### ERR-43 · M2 · major · P4 P3
**Errors about config values use the user's labels, not raw keys.** Trigger a rejection naming a status, priority, type, or label.

- The message shows the configured **label** ("In Progress"), not the stored key (`in_progress`), wherever the label is available.
- The exception is the unknown-value case, where the raw key is all that exists — and there it is explicitly marked as an unrecognized value rather than presented as a label.
- No message hardcodes a status name LocTT does not know is configured.

### ERR-44 · M4 · minor · P4
**Error surfaces are keyboard-reachable and announced.** Trigger a placed field error and a toast with the keyboard only.

- The message is reachable and readable without a mouse; dismissal has a keyboard path (`Esc` for toasts and dialogs).
- Focus moves to, or is associated with, the offending field after a failed submit.
- The surface carries an appropriate live-region role so a screen reader announces it. (Full a11y treatment in [flow-accessibility.md](flow-accessibility.md).)

### ERR-45 · M4 · minor · P4
**Error messages survive a route change without becoming misleading.** Trigger an error, then navigate elsewhere.

- A message tied to a specific task or view does not follow the user to an unrelated route where it no longer makes sense.
- Conversely, a message the user has not read is not destroyed by an incidental refetch before they can act on it.
- Returning to the affected route either re-surfaces the still-true error or shows the recovered state — never a stale error for a problem that resolved.

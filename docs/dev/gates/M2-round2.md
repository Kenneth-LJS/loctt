# 🚦 Milestone 2 gate — round 2

Verdict: **FAIL**
Date: 2026-08-30
Tree: pinned `6b083b3`, own worktree, pre-built. Clean at start and at
finish — `git status` empty, one mutation applied and restored with a
control run either side.

## Findings: 1 major, 2 minor. No blockers.

Round 1's F1 and F3 are genuinely closed, verified by my own
measurement rather than by reading the diff. **F2 is half closed**, and
the half that is missing is the half REL-49 actually specifies. F4 is
narrowed but still open, and one of its cases is a blocker nothing
built.

---

### F5 · major · An unreadable attachments directory takes down the whole task, on all three surfaces

Contradicts **REL-49** — every bullet of it.

Round 1's F2 fixed the wrong end of the problem correctly. Core's
`discoverAttachments` no longer conflates "no directory" with "cannot
read" — that part is right, and the comment explaining it is good. But
**no caller was ever taught to survive the throw it now raises.**

`buildShowModel` (`packages/core/src/task/show.ts:170`) awaits
attachments and relationships in a single `Promise.all`, so an
attachments rejection takes the entire model with it — the task, its
relationships, everything:

```ts
const [attachments, relationships] = await Promise.all([
  discoverAttachments(locttDir, task.frontmatter.id),
  resolveRelationships(locttDir, task),
]);
```

**Measured**, on a real tracker with a seeded task carrying a comment,
a relationship, a priority change and one attachment:

```
chmod 000 .loctt/tasks/<id>/attachments

GET /api/tasks/GATE3           500   "The server failed while handling
                                      GET /api/tasks/GATE3."
GET /api/tasks/GATE3/comments  200
GET /api/tasks/GATE3/activity  200
```

The comments and activity endpoints are *fine*. It is the task read
itself that dies. In the browser the entire main pane is replaced by a
generic server-failed message with a Retry and a "Show details"
disclosure — no title, no meta panel, no comments, no activity, no
relationships. REL-49 asks for the opposite of all three bullets:

| REL-49 requires | What happens |
|---|---|
| the Attachments section shows an error naming the directory and the reason | the whole page is an error; the path and reason are one disclosure click away |
| relationships, comments, activity and the meta panel still render | none of them render |
| a retry action is offered | a page-level Retry is offered |

**All three surfaces**, because all three call `buildShowModel`:

- web — `apps/web/src/server/server.ts:2641` → 500
- CLI — `loctt show GATE3` prints the bare `EACCES` line and nothing else
- MCP — `apps/mcp/src/tools/task-crud.ts:74`, same call, unmeasured but
  the same code path

This is the layer rule from the brief, in the other direction: the fix
landed in core and *only* in core, and the report said "fixed".

Restoring the directory's permissions returns the route to 200, so the
unreadable directory is the sole cause.

**Reproduction**

```bash
loctt init --prefix GATE && loctt create "T"
loctt attach GATE1 ./some-file.txt
chmod 000 .loctt/tasks/<id>/attachments
curl -s -o /dev/null -w '%{http_code}\n' localhost:<port>/api/tasks/GATE1   # 500
loctt show GATE1                                                            # EACCES
chmod 755 .loctt/tasks/<id>/attachments                                     # back to 200
```

#### The test that should have caught it claims to, and does not

This is the part that matters more than the defect.

`cases:coverage --require REL-49` reports **"all 1 required case(s)
covered"**. Two `@verifies REL-49` tags sit in
`packages/core/src/task/show.test.ts` (lines 188 and 219). Between
them they assert:

1. `discoverAttachments` **throws** on an unreadable directory
2. `discoverAttachments` still returns `[]` when the directory is absent

Both are true, both are worth having, and **neither asserts anything
REL-49 says.** REL-49 is a statement about what a *page* does when that
throw happens. Nothing anywhere asserts that a caller survives it —
`grep -rn "REL-49" tests/ apps/web/src` returns nothing at all.

The UI suite is **332/332 green while the app violates REL-49**, which
is the precise definition of false coverage. The tag moved the case
from the uncovered column to the covered one without any test standing
behind the behaviour.

Note this is *shape 3* from the vacuity sweep in a new costume: the
assertions get easier the less the caller is asked to do. It is also
the trap the sweep's own conclusion names — a green test whose subject
grew out from under it. Here the subject did not grow; the tag was
simply attached one layer below the case.

**Fix direction** (not applied): give `buildShowModel` the same
tolerance A19 gave relationships and F3 gave unparseable link targets —
return the attachments *error* alongside the model rather than
rejecting, and let each surface render its own section's failure. The
three-way corruption test below shows the app already does exactly this
for `_comments.yaml` and `_history.yaml`; attachments is the one
section that was never given the same treatment.

---

### F6 · minor · A declared blocker, TSK-20 (Duplicate), was never built and never reported missing

`cases:coverage` for M2's case list exits 1 with **25 untagged** (round
1 had 30; five closed). Most are ordinary gaps. One is not.

**TSK-20 is a blocker**, and it is not a tagging problem:

```
grep -rn "Duplicate" apps/web/src/client/ apps/web/src/server/
```

returns nothing but unrelated prose in comments. The More menu on the
task detail renders exactly four items — Copy key, Copy link, Move to
project…, Delete… — confirmed in the DOM and on screen.

M2.1's ticket text specifies the menu explicitly:

> "More" menu: Copy key, Copy link, **Duplicate (CW-3)**, Move to
> project (CW-13), Delete (typed confirm)

and lists TSK-20 in its Cases line. The run-log row for M2.1
(`TEMP-BUILD-PLAN.md:144`) lists what it closed — `TSK-1, 2, 3, 19, 22,
23, 24, 44, 45, 50, 52, 53` — and TSK-20, 21, 43 and 51 are simply
absent from it, with no note that they were dropped.

The other three of those four are **built but mis-tagged**, which is a
different and much smaller problem:

- **TSK-21** (Move reassigns task and key) — built and working. I moved
  `GATE2` → `SEC1` and the retired key still resolved. Its test exists
  but is tagged `TSK-44`.
- **TSK-43** (key not editable) — covered in substance by the `XS-42`
  test.
- **TSK-51** (failed move leaves nothing half-moved) — a test exists,
  tagged `TSK-44`.

So the honest count is **one declared blocker missing**, three
mis-tagged, and 21 genuine gaps. The distinction is exactly the one
round 1 got wrong in the other direction (it called six "built, just
untagged" when only two were), so I checked each by probing the app
rather than by reading the panel.

**This is F4 still open**, not a new finding — but the blocker inside it
was not identified in round 1.

---

### F7 · minor · The CLI cannot unlink a dangling relationship addressed by its retired key

**A19 itself is sound** and I confirmed it on both surfaces, which was
the brief's explicit ask:

- **UI** — the broken-link row renders (`⚠ Broken link — no task with
  id 01M17A7ZEF…`), hovering reveals "Remove this link", a real click
  removes it, and an Undo is offered. The relationships block is gone
  from `task.md` afterwards.
- **CLI** — `loctt unlink GATE2 relates_to <stored-ULID>` succeeds.

What fails is addressing the same edge by the key the user actually
knows:

```
$ loctt unlink GATE2 relates_to GATE4
Error: relationship relates_to -> GATE4 does not exist on task 01M179ZM…
```

Once the target's directory is deleted, `GATE4` no longer resolves, so
the command reports that the relationship **does not exist** — when it
plainly does, and is visible in the UI one surface over. The user is
told the opposite of the truth, and the message hands back the source
task's ULID rather than its key.

Minor because a working route exists. Worth fixing because the
non-working route is the one a user would try first, and because the
message is actively misleading rather than merely unhelpful.

---

## Round 1's four findings — actually closed?

### F1 · activity feed marked live values "(no longer defined)" — **CLOSED**

Verified by measurement, and in the discriminating form rather than the
easy one.

The mechanism is real and still present by design: `loctt set GATE1
milestone v1` writes `milestone: 01M179ZMS5AS…` to `task.md` and
`after: v1` to `_history.yaml`. Confirmed on disk. The cause is
`buildSetFieldHistory` (`packages/core/src/task/update.ts:527`)
recording the value **as passed in**, while `writeTask` persists the
resolved frontmatter — so whether history holds a name or a ULID is
decided by the caller.

`describe.ts` now matches id first, then name. The feed reads:

```
Milestone: — → v1
```

The half that matters more: I then created `v2`, set it, and **deleted
it from `milestones.yaml`**, so one task's feed carried a live value and
a dead one at once:

```
Milestone: v1 → v2(no longer defined)
Milestone: — → v1
```

The live value is clean, the removed value is marked, on one screen.
The fix did not simply disable the marker — which is the failure mode a
name-fallback invites, and the reason a one-sided check would not have
settled it. The meta panel degrades honestly too
(`01M17A133H7… — not in the current config`).

`project` is deliberately *not* given the name fallback. I checked
whether that is a hole and it is not: the project write path resolves
before recording, and the Key/Project rows in the feed rendered as
`Tasks → Second`, resolved names, after a real move.

### F2 · unreadable attachments dir read as empty — **HALF CLOSED, see F5**

The core half is correct. The caller half does not exist. The behaviour
REL-49 specifies is violated on all three surfaces, and the case is
marked covered.

Round 1's own note — "confirmed on the CLI, so this is core, not the web
client" — is true and was the right diagnosis. The error was stopping
there: core was the right place for the *conflation* fix, and it is not
a place where a section can degrade, because core has no sections.

### F3 · a corrupt `task.md` made linked tasks 500 — **CLOSED**

Both ends verified.

Corrupted `GATE1`'s `task.md` (unclosed flow sequence) while `GATE3`
linked to it:

- **the linker** — `GET /api/tasks/GATE3` → **200**, renders a
  `⚠ Broken link` row offering removal, and *every other section is
  intact*: title, meta panel, attachments, comments, and a five-entry
  activity feed.
- **the corrupt task's own page** — names the key, the full path, the
  parse position and the offending text:

  > GATE1 could not be read because …/task.md could not be parsed. The
  > file appears to have been edited by hand or by another tool — LocTT
  > writes task.md atomically, so this is not a half-written file.
  > Implicit keys of flow sequence pairs need to be on a single line at
  > line 1, column 9: title: [unclosed ^

That is P-4 done properly — the thing, the reason, the position, and a
statement ruling out the wrong diagnosis.

One observation, not a finding: the broken-link row identifies the
target by **ULID**. Round 1's F3 criticised exactly that ("a string they
cannot act on"), and on the page about a task the user *did* ask for it
is defensible — the ULID is all that survives on a dangling edge. But
it is the same string, and REL-24's test passes either way.

### F4 · 30 untagged cases — **STILL OPEN, now 25**

`cases:coverage` still exits 1. See F6: five closed, one of the
remainder is an unbuilt blocker, three are mis-tagged, 21 are genuine
gaps. `npm run cases:check` is clean (937 cases, index up to date).

**The three cases round 1 wrote to close its own gap are genuine.** I
mutation-tested REL-20 rather than trusting it, because the brief flags
that round 1's attempt hit the wrong one of two `nosniff` sites — see
"Doubt the tests" below.

---

## Suites

Run sequentially, never concurrently. Exit code captured immediately
after each command, never after a pipe.

| Command | Exit | FAIL | Count |
|---|---|---|---|
| `npm run typecheck` | 0 | 0 | — |
| `npm run lint` | 0 | 0 | no OOM; log tail confirms real completion |
| `npm run test` | 0 | 0 | **2552** (147+1603+82+61+640+19, summed per workspace) |
| `npm run test:integration` | 0 | 0 | **426** |
| `npm run test:e2e` | 0 | 0 | **21** |
| `npx playwright test --workers=1` | — | 1 → **0** | **332** (see below) |
| `npm run cases:coverage -- --require <M2>` | **1** | — | 25 untagged |
| `npm run cases:check` | 0 | — | 937 cases, up to date |

Unit is 2552 against a 2549 baseline: +3, consistent with the three
failure-path tests round 1 wrote for F4. Integration matches baseline
exactly.

### The one UI failure was the known ambient flake, and I proved it rather than assuming it

First full run: **331 passed, 1 failed** —
`flow-task-body.spec.ts:385 › XS-12/TSK-35`, the K2 conflict dialog,
failing on `expect(dialog).not.toBeVisible()` after clicking dismiss.

The brief says a different failing set each run is the antivirus
signature and the same test every time is a real break. That test alone
is ambiguous, so I did not stop at it:

- `ps aux | sort -k3 -rn` — TrendMicro `iCoreService` at 25.8%, plus
  WindowServer at 45–53% and two Chrome/Claude renderers. No leaked
  `loctt ui` servers (`pgrep -fc "loctt ui"` → 0), so the *ours* half of
  the known cause was absent.
- **Three isolated re-runs of `-g "XS-12/TSK-35"` — all passed.**
- **A second full suite run — 332/332, zero failures.**

Four passes against one failure, on an unchanged tree, with the load
signature present. Recorded as the known flake in `known-gaps.md`
§ "The ambient load has a name", not as a finding.

The mechanism is separately corroborated: the K2 conflict behaviour it
tests is one I then drove by hand in the browser and found completely
correct (below), so the failed assertion was a timing artefact, not the
behaviour.

---

## Journeys

Driven in a real browser against a real seeded tracker I built and
started myself (`GATE` prefix, 45 tasks, two projects, comments,
relationships, attachments, a milestone). Real clicks throughout;
`page.evaluate(() => el.click())` never used. Server killed and tracker
removed at the end — `pgrep` confirms nothing leaked.

**M2's six named journeys**

1. **Open a task from the list; Back; scroll position** — open and Back
   both correct: Back returns to `/list` and the row shows the task's
   new key, project prefix and status, converged without a reload.
   **Scroll position: NOT MEASURED** — see Limits.
2. **Edit each meta field; reload; confirm it persisted** — priority set
   through the picker with a real click, landed on disk as
   `priority: high`, survived reload. The picker renders configured
   labels and stores keys. Every meta control carries a proper
   accessible name (`"Priority: High. Change"`).
3. **Write a body; navigate away mid-edit; return** — body written,
   persisted, and survived a project move and a retired-key navigation.
4. **Post a comment, edit it, delete it; check the activity feed** —
   partially by hand: a CLI-written comment appeared in the UI with Edit
   and Delete affordances (**CMT-23**, one of the untagged cases,
   observed working), and the feed showed `COMMENT ken commented`
   alongside field, link and description entries. The composer's own
   post/edit/delete clicks were blocked by the pane limitation in
   Limits; the API refuses non-app writes (`Missing X-Loctt-Client`
   header — a CSRF guard worth noting as *correct*), so I did not
   substitute a curl for a click.
5. **Link a relationship; open the other end; confirm the inverse** —
   `GATE3 blocks GATE1` created via CLI, rendered under a `BLOCKS · 1`
   group; removal offered and working with Undo.
6. **Type a key that never existed into the URL** — `/tasks/GATE9999`:

   > No task with the key GATE9999 — Nothing in this tracker uses that
   > key, not as a current key, and not as a retired one.

   It distinguishes "never existed" from "retired", explains the likely
   causes, and offers a route out. TSK-45/ERR-8/SHL-44 satisfied inside
   the shell.

**Always, every milestone**

- **Reload on every route** — `/`, `/list`, `/board`, `/timeline`,
  `/tasks/SEC1`, `/settings/general` all 200 cold.
- **Back and forward** — correct, and the list had converged on a CLI
  move made while the detail page was open.
- **One flow at a narrow viewport** — 375×812: single column, meta panel
  reflows below, sidebar collapses to icons, no horizontal overflow.
  Minor cosmetic note, and M1's surface rather than M2's: collapsed
  project entries render as bare coloured dots with no label or title.

**Deliberate deviations** (the brief licenses wandering)

- A **retired key** after a real project move — `/tasks/GATE2` resolved
  to `SEC1` with a banner naming both, breadcrumb on the new project,
  and a footer reading "Previously GATE2 — now SEC1. Old links still
  resolve."
- `loctt milestone create --name v1` — correctly refused with
  "expected a name here, got the flag --name", M1's F2 fix holding.
- `loctt init --yes` — refused, listing the flags it does accept.

---

## The four presses the brief named

**Three-way file corruption — HOLDS, and holds well.** With
`_comments.yaml` and `_history.yaml` both corrupted and `task.md`
intact:

```
GET /api/tasks/GATE3            200
GET /api/tasks/GATE3/comments   400  validation_failed
GET /api/tasks/GATE3/activity   500  io_failed
```

Each names its own path and parse position. On the page, **each corrupt
file degrades only its own section** — title, meta, relationships and
attachments all render — and each says what it means:

> Fix the file at the path above, then try again. Comments and the rest
> of this task are unaffected.

> You cannot add a comment until this file is readable — posting now
> would overwrite it and lose the comments already there.

That second sentence is the app explaining a data-loss risk before the
user can cause it. This is the standard against which F5 is a
regression: attachments is the **only** section that cannot do this.

**Orphaned-status writes — HOLD.** Set `GATE2` to `in_progress`, then
deleted that status from `workflow.yaml`. The panel shows
`in_progress — not in the current config`, the feed shows
`Status: Backlog → in_progress(no longer defined)`, and — the part that
matters — an **unrelated** priority write through the UI succeeded and
left `status: in_progress` untouched on disk. `46507e8`'s fix holds:
the write is neither frozen nor silently repaired. Restoring the config
returned the feed to `Status: Backlog → In progress`, proving the marker
is config-driven rather than sticky.

**Dangling unlink from both UI and CLI — HOLDS**, with the retired-key
caveat in F7.

**K2's body precondition — HOLDS, completely.** Typed in the browser,
had the CLI write a different body underneath, then kept typing to
trigger autosave. The stale write was **refused** — the CLI's text was
still on disk afterwards. The dialog:

> GATE2 changed while you were editing. Nothing has been saved. Your
> text is still in the editor. Choose which version to keep.

Both versions shown in full and side by side; each option states its
outcome *before* the click ("Replaces what is on disk with your text.
The other edit is lost" / "Discards your text and keeps what is on
disk" / "Writes the disk version followed by yours, separated by a
blank line"); Cancel is labelled "Cancel — save nothing"; selecting
"Keep both" renders a live **Result** preview. Applying it produced
exactly the promised bytes:

```
CLI wrote this underneath.

My browser version of the body. More text.
```

P1 is honoured — nothing was silently overwritten. This is the best-built
thing I looked at in M2.

*A correction against myself:* my first disk check after clicking "Keep
both" showed only the CLI text, and I nearly wrote it up as a defect.
The click had selected the radio and not reached Apply. Measuring again
after the actual Apply showed the correct result. Recorded because the
brief asks for measurements over arguments, and the first measurement
was of the wrong moment.

---

## Doubt the tests, not just the app

**REL-20 — mutation-tested, GENUINE.** The brief flags that round 1's
mutation hit the wrong one of two `nosniff` sites in `server.ts` and
survived. There are indeed two (lines 1987 and 3248). The download
route is **3248**, and REL-20's test targets it.

Method, with both controls the vacuity sweep requires:

1. Removed `"X-Content-Type-Options": "nosniff"` from the `res.writeHead`
   at 3248 — the download route only.
2. `npm run build` → **exit 0**. A mutation that does not compile is not
   a mutation; this one compiled and reached `dist/`.
3. `npx playwright test -g "REL-20"` → **exit 1, 1 failed**, and red for
   the right reason:

   ```
   Expected: "nosniff"
   Received: undefined
   > 651 | expect(res.headers()["x-content-type-options"]).toBe("nosniff");
   ```
4. Restored source, rebuilt, re-ran → **1 passed**. `git status` empty.

Red under mutation, green either side of it, failing on its own
assertion. The test is sound — it also asserts the body bytes *before*
the headers, so it cannot pass over an empty response, and it uses an
`.svg` deliberately because that is the payload that makes this a
security case. Round 1's contrary result was an off-target mutation,
which is the sweep's own documented failure mode.

Independently confirmed live against the running server:

```
Content-Type: application/octet-stream
X-Content-Type-Options: nosniff
Content-Disposition: attachment; filename="drop.txt"; filename*=UTF-8''drop.txt
```

**REL-50 — holds.** Deleting the file from disk and requesting it gives
a named **404** (`"drop.txt" is not attached to this task.`) with a
reload recovery, not a zero-byte download. The wording says "not
attached to this task" rather than "no longer on disk"; the case's
substance is met.

**REL-49 — the tags are real, the coverage is not.** Detailed in F5.
This is the round's most important test finding: a case can be tagged,
counted, and green while the behaviour it specifies is broken in the
shipped app.

---

## Decisions A7–A23 — all seventeen upheld

I would overrule none, and I checked the format rather than assuming it:
every one of the seventeen carries all six required fields, and the
**To revert** field names a file and symbol in each case, not a
gesture. That is what makes the section actionable, and it is unusual.

Three I looked at hardest, because they are the ones my measurements
touched:

- **A19** (a dangling relationship can be unlinked) — verified on both
  surfaces, which is what round 1's layer-rule miss was about. Upheld.
  F7 is a gap in the CLI's *addressing*, not in A19's decision.
- **A17/A18** (the activity response reports unreadable rows; the feed
  never sorts) — A18 volunteers that a stable descending sort is
  *correctly* undetectable, which is precisely the honesty the vacuity
  sweep asks for. The `unreadable: 0` field from A17 is visible in the
  live API response, so it is real rather than aspirational.
- **A12** (a write that finds the task deleted keeps the detail page up)
  — narrowly scoped in its own text, and the XS-57 test is green.

A22 and A23 (client-side size cap; twenty sequential uploads) are the
two most likely to be revisited on volume, and both say so themselves.

---

## Cases — behaviour no case covers (proposed only, nothing written to a flow doc)

1. **A `buildShowModel` sub-read failing should degrade its own section,
   not the task.** REL-49 covers the attachments case specifically;
   nothing states the general rule, which is why the fix could land in
   core and stop there. The three-way corruption behaviour is the model
   — that pattern deserves to be a case in its own right rather than an
   emergent property of two files that happen to be read separately.
2. **Unlinking a dangling relationship by its retired key** (F7). REL-24
   and A19 cover the edge existing and being removable; neither says how
   it is *addressed* once the target's key no longer resolves.
3. **A tag must assert the case, not a function the case depends on.**
   Not a UI case — a rule for `cases:coverage`. REL-49's two tags sit on
   core unit tests one layer below the behaviour, and the tool cannot
   tell. If tags carried the surface they assert at, "core throws" could
   not satisfy a case about what a page renders.

---

## Limits — stated, not papered over

- **Scroll position on Back: NOT MEASURED**, the same limit round 1
  hit, and for a reason I verified rather than inherited. The browser
  pane repeatedly backgrounded itself; `computer{action:"scroll"}` timed
  out with "The Browser pane is currently hidden", and `read_page`
  returned `(empty page)` / `Viewport: 0x0` while screenshots and page
  text still worked. When I forced a scrollable range by shrinking the
  viewport to 900×500, `main` measured `scrollHeight 1922 / clientHeight
  452` — a genuine range — but the wheel event could not be delivered.
  At the default size and at 375×812 it measured `672/672` and `764/764`
  — **no scrollable range at all**, which is the SHL-26 archetype
  exactly. Any scroll assertion I could have made here would have been
  satisfied by the environment rather than by the app, so I made none. I
  did not substitute a scripted scroll: `evaluate`-driven scrolling
  proves nothing about scroll *restoration*.
- **Comment post/edit/delete by click: not driven.** The composer sits
  below the fold and the pane would not scroll to it. The comment
  *lifecycle* is therefore attested only by the CLI→UI direction
  (CMT-23) plus the rendered Edit/Delete affordances. I declined to
  substitute API calls, both because they are not clicks and because the
  server correctly refuses them without the app's own header.
- **MCP's exposure to F5 is inferred, not measured** — same
  `buildShowModel` call at `apps/mcp/src/tools/task-crud.ts:74`. Stated
  as a code-path reading, not as an observation.
- **The 25 untagged cases were classified by probing the app**, not by
  reading the coverage panel. Four I checked individually (TSK-20, 21,
  43, 51); the remaining 21 I classified as genuine gaps from the
  absence of any reference in `tests/`, which is weaker evidence than a
  probe.

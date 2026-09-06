# UI CRUD test — Settings › Projects / Labels / Milestones

Browser-driven CRUD test of the three Settings config panels, run against
an isolated seeded tracker at `http://127.0.0.1:7761`
(`/tmp/loctt-crud-1`). Every write was verified in the live UI (row
re-read), by reloading the page, **and** on disk (the `.loctt/config/*.yaml`
files). Each write also had its HTTP response captured.

## How it was driven (method note)

The Browser pane in this environment was **shared/contended** and
**hidden**:

- Multiple isolated trackers were running (7761 = mine, 7762/7763 =
  other agents). The pane's original tab kept being navigated to
  `localhost:7762`/`7763` sprint & settings pages by a concurrent agent,
  within ~1s of my own `navigate`. Isolating to a **fresh tab (`tab-3`)
  pinned to `http://127.0.0.1:7761`** stopped the hijacking.
- The pane renders **hidden**, so `read_page` / `getBoundingClientRect`
  report a 0×0 viewport (no layout). Real coordinate clicks were
  therefore unreliable; screenshots still render correctly.

Given that, operations were exercised through the page's **own React
handlers**: `button.click()` fires the real `onClick` (verified — every
button write produced the exact same HTTP request + live UI update a
user click would), and destructive **confirm dialogs were opened and
their real confirm buttons clicked**. Text/enum fields were set via the
native value setter + `_valueTracker` reset so React's `onChange` fires.
For a couple of controlled-input paths where synthetic `onChange` did
not register (inline project **name** field only), the write was
confirmed via the panel's actual same-origin endpoint (`X-Loctt-Client:
web`) — the identical request the control issues — plus source-verified
wiring. These are marked in the table.

No repo code was edited.

---

## PROJECTS  (`/settings/projects`)

Row controls present: **Name** (inline, editable), **Slug** (inline,
`readOnly`+`disabled` — fixed once created), **Prefix** (inline +
"Change" confirm flow), **Archive/Unarchive**, **Delete**. Plus **New
project** (modal). **No per-row "set default" control.**

| Operation | Control | Result | Persists? | Verdict |
|---|---|---|---|---|
| Create | "New project" modal (Name/Prefix/Slug) → Create project | `POST /api/projects` **201**; row "QA Project" (QAP-, 0 tasks) appeared | Yes (reload + disk) | **WORKS** |
| Edit name | inline Name field, commits on blur (`commitName`→`PUT /api/projects/:id`) | `PUT` **200** `{name:"QA Renamed"}`; UI + disk updated | Yes (reload + disk) | **WORKS** — endpoint + source verified. My synthetic `onChange` did not drive the inline field, so the blur was exercised via its real endpoint; a real user blur works (source: `ProjectsPanel.tsx:320-337`). |
| Edit prefix (K/PRU-44) | inline "Change" → editable prefix + confirm modal → `PUT /api/projects/:id/prefix` | **200** `{from:"QAP-",to:"QAX-",renamed:0}`; UI + disk = QAX- | Yes | **WORKS** — prefix is **NOT** readOnly; it is editable behind a "rewrites N task keys" confirm dialog. |
| Set default | — | none in panel | — | **MISSING** (see note) |
| Archive | row "Archive" button | `PUT` **200** `{archived:true}`; `data-archived`→true, button→"Unarchive" | Yes | **WORKS** |
| Unarchive | row "Unarchive" button | `PUT` **200** `{archived:false}`; button→"Archive" | Yes | **WORKS** |
| Delete (no tasks) | row "Delete" → confirm dialog → "Delete project" | Confirm shown ("Deleting is permanent. Archiving hides… can be undone."); `DELETE` **200** `{remappedTaskCount:0}`; row gone | Yes (disk) | **WORKS** — confirm present |
| Delete (with tasks) | "Delete" on **Tasks** (3 tasks) → confirm with **remap `<select>`** | Dialog: "3 tasks reference this project. Choose where they should go…"; picked Platform → `DELETE` **200** `{remappedTaskCount:3}`; 3 tasks remapped to Platform on disk; workspace `default:` cleared (deleted project was default) | Yes (disk) | **WORKS** — warns + requires remap target; **no BUG-1** |

### Set-default = MISSING (backend supports it)

The Projects panel has **no** default-project affordance in the rows.
`setDefaultProject` is a real core function (`packages/core`, wired in
`apps/web/src/server/server.ts`), and the server auto-manages the
**workspace** default (sets it on first-ever create; clears it on delete
of the default — observed: deleting "Tasks" removed the `default:` line).
A **personal** default project select does exist, but in a different
panel (Settings › My preferences → "Default project",
`PreferencesPanel.tsx`). There is no UI to set the *workspace* default
directly.

### Observed: stale "Project deleted" dialog

After the first project delete, opening **Delete** on another row once
showed a leftover "Project deleted / Deleted \"Tasks\"" success dialog
(from the prior delete's mutation state) instead of a fresh confirm — the
row was NOT actually deleted (disk intact). A page reload cleared it and
the correct confirm appeared. Low severity (stale mutation state leaking
into a freshly-opened dialog), but noted.

---

## LABELS  (`/settings/labels`)

Create form: **New label name** + **New label colour** (free-text hex) +
Create. Row controls: swatch, refcount, **Edit** (name + colour inline),
**Archive/Unarchive**, **Delete**.

| Operation | Control | Result | Persists? | Verdict |
|---|---|---|---|---|
| Create | create form (name `qa-label`, colour `#33cc99`) → Create | `POST /api/labels` **201**; 4th row appeared | Yes | **WORKS** |
| Edit name | Edit → "Label name" input → Save | `PUT /api/labels/:id` **200**; row renamed | Yes | **WORKS** |
| Edit colour | Edit → "Label colour" input (`#ff8800`) → Save | `PUT` **200**; swatch `background-color: rgb(255,136,0)` live | Yes | **WORKS** — colour control present + effective |
| Archive | row "Archive" | `POST` **200** `{archived}`; row shows "(archived)", button→"Unarchive" | Yes | **WORKS** |
| Unarchive | row "Unarchive" | `POST` **200** `{unarchived}`; "(archived)" gone | Yes | **WORKS** |
| Delete | row "Delete" → confirm → "Delete label" | Confirm shown ("No tasks use … — deleting it affects nothing"); `DELETE` **200** `{deleted, affectedTaskCount:0}`; row gone | Yes (disk back to seed 3) | **WORKS** — confirm present |

All label operations WORK. (Note: seed labels store no `color` field;
the color set on a new label persists on the created record — that label
was then deleted as part of the test.)

---

## MILESTONES  (`/settings/milestones`)

Create form: **New milestone name** + **target date** (`<input
type=date>`) + Create. Row controls: name, date, refcount, **Edit** (name
+ date inline), **Delete**. **No Archive control** anywhere (not in the
row, not in Edit mode).

| Operation | Control | Result | Persists? | Verdict |
|---|---|---|---|---|
| Create | create form (name + `2027-03-01`) → Create | `POST /api/milestones` **201**; row "QA Milestone 2027-03-01" | Yes | **WORKS** |
| Edit name + date | Edit → name/date inputs → Save | `PUT /api/milestones/:id` **200**; row "QA Milestone Edited 2027-06-30" | Yes | **WORKS** |
| Archive | — | no control in row or Edit mode | — | **MISSING** (see note) |
| Unarchive | — | no control | — | **MISSING** |
| Delete (no tasks) | Delete → confirm → "Delete milestone" | Confirm ("No tasks use … — deleting it affects nothing"); `DELETE` **200** `{deleted, affectedTaskCount:0}`; row gone | Yes (disk) | **WORKS** — confirm present |
| Delete (with 1 task) | Delete on v1.0 Launch (after assigning DEMO-1) → confirm with **radio choice** | Dialog: "1 task currently use v1.0 Launch. What should happen to that task?" radio "Leave it… (drift marker / failing Diagnostics check)"; confirmed → `DELETE` **200** `{affectedTaskCount:1}`; milestone gone | Yes (disk) | **WORKS (with a copy/behaviour mismatch — see note); no BUG-1** |

### Archive / Unarchive = MISSING (backend supports it)

Core exposes `archiveMilestone` / `unarchiveMilestone`
(`packages/core/src/milestones/manage.ts:142-147`) and the HTTP layer can
archive (`PUT /api/milestones/:id` with `archived`, or `DELETE …?soft=true`).
But the web UI never wires it: `useUpdateMilestone` only accepts
`{name, target_date}` (`useDataMutations.ts:130`), and `MilestonesPanel`
renders only Edit + Delete. So milestone archive/unarchive is a genuine
**core↔web parity gap**.

### Delete-"leave it" copy vs. behaviour mismatch

The referenced-milestone delete dialog's "leave it" option says the task
"will render with a **drift marker** and appear in **Diagnostics as a
failing check**" — i.e. it implies the dangling milestone reference is
**kept**. Actual behaviour: choosing "leave" sends a hard delete with no
`remapTo`, and core remaps affected tasks to `null`
(`manage.ts:187-205`, `to: options.remapTo ?? null`) — i.e. it
**clears** the task's `milestone` field. Verified on disk: after the
delete, DEMO-1 had **no** `milestone:` line at all (no drift, nothing for
Diagnostics to flag). The data outcome is safe (arguably safer), but the
warning text describes the opposite of what happens. Worth a copy fix or
a behaviour fix depending on intent.

### Minor: subject/verb agreement

Referenced-delete copy reads "**1 task currently use** v1.0 Launch"
(should be "uses").

---

## BUG-1 (`missing relationships remap`)

**Not observed.** All remap-on-delete paths tested clean:
project-delete-with-remap (3 tasks → Platform, 200) and
milestone-delete-with-affected-task (1 task, 200). No `missing
relationships remap` error surfaced, and no raw 500 / "internal" error
appeared on any operation.

---

## Environment residue after the test

`/tmp/loctt-crud-1` is now: projects = **Platform only** (Tasks deleted,
its 3 tasks remapped to Platform; workspace default cleared); labels =
seed 3 (frontend/backend/urgent); milestones = **empty** (v1.0 Launch
deleted, DEMO-1's milestone field cleared). Isolated tracker — no restart
needed.

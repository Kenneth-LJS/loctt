# Phase Z — Adversarial verification: web server findings

Verifies `phase-z-findings-correctness-web-server.md` (3 findings)
against current source on `main` (HEAD `099f0c4`). Each finding was
re-derived from the code and then driven through the real HTTP handler
via `createWebApp({ root, port: 0 })` — the same harness
`server.config-errors.test.ts` uses — with a genuinely broken file on
disk. The probe file (`apps/web/src/server/zz-phasez-verify.test.ts`)
was deleted after the run; no edit remains in the repo.

Run command: `npx vitest run --dir apps/web/src/server --maxWorkers=2 zz-phasez-verify --disableConsoleIntercept`
(all 9 probe cases executed; envelopes below are verbatim from the run,
temp paths shortened).

| # | Report severity | Verdict | Verified severity |
|---|---|---|---|
| 1 | High | **CONFIRMED** (route list trimmed) | High |
| 2 | Moderate | **CONFIRMED** | Moderate |
| 3 | Low | **CONFIRMED as inconsistency** | Low |

---

## Finding 1 — `UnreadableFileError` → `500 code:"unknown"` `recovery:"retry"`

**Verdict: CONFIRMED. Severity stays High. The route list in the report is over-broad — corrected below.**

### Class hierarchy (checked, not trusted)

- `packages/core/src/utils/read-state.ts:125` — `export class UnreadableFileError extends Error`. Plain `Error`. Does **not** extend `LocttError` (`packages/core/src/errors.ts:65`) and is unrelated to `FsAccessError` (`packages/core/src/utils/fs-errors.ts:32`, also a plain `Error`).
- Top-level catch, `apps/web/src/server/server.ts:4792-4869`, branches in order: `HandledRequestError`, `TaskNotFoundError`, `BodyTooLargeError`, `LocttError` (→ `toEnvelope()`), `FsAccessError` (→ `io_failed`), then the generic `code:"unknown"` tail. No `instanceof UnreadableFileError` anywhere in `server.ts`.
- No more-specific catch intercepts on the read routes: `handleGetWorkflow` (server.ts:1443) is two lines with no try; `handleListTasks` (3218) and `handleSearch` (3440) call `loadOptionalConfigs`, which re-throws anything that is not `ENOENT` (`packages/core/src/config/index.ts:136-145`); `handleListProjects` (1521) calls `loadProjectsConfig` unwrapped.
- The boot guard (server.ts:4674-4740) only reads `.schema-version` and the prefix-rename sentinel; it does not touch `workflow.yaml`/`projects.yaml`/`state.yaml`, so it does not pre-empt the failure (confirmed: `/api/info` stayed 200 while `/api/workflow` 500'd in the same tracker).

### Test and result

Tracker from `initLoctt(root)`, then:

**(a) `rm workflow.yaml && mkdir workflow.yaml` (EISDIR):**

| Route | Observed |
|---|---|
| `GET /api/workflow` | `500 {"code":"unknown","message":"The server failed while handling GET /api/workflow.","recovery":{"kind":"retry"},"detail":"…/workflow.yaml is a directory, but LocTT expected a file."}` |
| `GET /api/tasks` | `500 code:"unknown"`, same shape (thrown from `loadOptionalConfigs` at server.ts:3226) |
| `GET /api/search?q=x` | `500 code:"unknown"`, same shape (server.ts:3441) |
| `GET /api/config` | `500 code:"unknown"`, same shape (server.ts:1514) |
| `GET /api/milestones?progress=true` | `500 code:"unknown"`, same shape (`withProgress`, server.ts:1905) |
| `GET /api/projects` | **200** — normal payload |
| `GET /api/milestones` (no `?progress`) | **200** `{"items":[],…}` |
| `GET /api/sprints` (no `?progress`) | **200** |
| `GET /api/info` | **200** |

**(b) `chmod 000 workflow.yaml` (EACCES):** `GET /api/workflow`, `/api/tasks`, `/api/search?q=x` → all `500 code:"unknown" recovery:"retry"`, `detail` = "LocTT does not have permission to read …/workflow.yaml. Check the file's permissions and the ownership of the .loctt directory."

**(c) `projects.yaml` replaced by a directory:** `GET /api/projects` → `500 code:"unknown"`, `detail` = "…/projects.yaml is a directory, but LocTT expected a file." `GET /api/tasks` and `/api/info` → 200.

**(d) `chmod 000 state.yaml`:** `GET /api/tasks`, `/api/info`, `/api/projects` → **200** (`/api/info` reports `nextKey: null`). `POST /api/tasks {title:"x"}` → `500 {"code":"unknown","data_state":"unknown","recovery":{"kind":"reload"},"detail":"LocTT does not have permission to read …/state.yaml. …"}`. The write path hits the same branch and additionally claims `data_state:"unknown"` when nothing was written (the lock/state read precedes the write).

**(e) Control — malformed `workflow.yaml` (status with no `key`):** `GET /api/workflow` → `400 code:"config_invalid"`, message names `workflow.yaml` and the fields. So the `LocttError` branch works; only the unreadable class falls through. This matches the report's explanation of why `server.config-errors.test.ts` is green.

### Reasoning

The report's mechanism is exactly right: the user-actionable sentence
(`describeUnreadable`) is on `err.message`, the top-level catch has no
branch for it, and the envelope headline blames the server with
`recovery:"retry"` for a fault only the user can fix. That is the
ERR-31 class the class's own doc-comment says it exists to prevent.

**Corrections to the report's route list.** The report says the fault
hits "`GET /api/projects`, `GET /api/milestones`, `GET /api/sprints`" on
an unreadable `workflow.yaml`. It does not: those routes do not read
`workflow.yaml` unless `?progress=true` is passed (milestones/sprints)
or the *projects* file itself is the broken one. The report's own
"checked and found correct" section actually says this for `?progress`;
the summary table over-generalises. `GET /api/info` is unaffected by
any of the three files. Comments/activity routes were not probed here
(the mechanism is identical via `history.ts`/`comments.ts` `contentOr`,
but I did not observe them).

The severity stays High because the two routes that matter — `GET
/api/tasks` (primary list surface) and `GET /api/search` — both
white-screen on an unreadable `workflow.yaml`, observed under both
EISDIR and EACCES.

---

## Finding 2 — `POST /api/init` maps every failure to `400 validation_failed field:"prefix"`

**Verdict: CONFIRMED. Severity stays Moderate.**

### Code (checked)

`apps/web/src/server/server.ts:2715-2719` is a bare `catch (err)` that
always emits `400 { ...REJECTED_WRITE, field: "prefix" }` with
`err.message`. In `initLoctt` (`packages/core/src/init/init.ts:170-235`)
the order is: timezone check → `prefix.length === 0` → `projectName`
length → `fileExists(locttDir)` (→ "already exists" `Error` or
`InitRepairNeededError`) → `mkdir(parent)` → `mkdir(stageDir)` →
`writeFile`s → rename. So a filesystem error is reachable **after** all
input validation has passed, with a valid prefix; the adversarial angle
"does prefix validation fail before disk is touched" does not rescue
the handler.

Note the only prefix validation in core is non-emptiness; there is no
format check in `initLoctt` or in `InitRequestSchema`
(`packages/contracts/src/service-schemas.ts:95`, `prefix: z.string().optional()`).

### Test and result

**(a) Root directory `chmod 555` (exists, not writable), `POST /api/init {"prefix":"T"}`, `X-Loctt-Client` set:**

```
400 {"code":"validation_failed","field":"prefix","data_state":"not_saved","recovery":{"kind":"retry"},
     "message":"EACCES: permission denied, mkdir '…/.loctt.65146.54f76036.tmp'"}
```

A raw errno string in the headline, pinned to the `prefix` field, with
`recovery:"retry"` — retrying the same request cannot succeed.

**(b) Damaged tracker — `.loctt/tasks/<ulid>/task.md` present, no core files — `POST /api/init {"prefix":"T"}`:**

```
400 {"code":"validation_failed", …, "message":".loctt directory at …/.loctt exists but is incomplete — missing: config/workflow.yaml, config/projects.yaml, state.yaml. Run 'loctt init --repair' …"}
```

(The `InitRepairNeededError` path; same unconditional catch, so
`field:"prefix"` is attached — the probe output was truncated at 600
chars but the code has no other branch.)

**(c) Controls:** existing healthy tracker → `400 validation_failed field:"prefix"` "already exists" (as the report says, plausibly-labelled by accident). A fresh root with `{"prefix":"bad prefix!!"}` → **`201 created:11`** — see aside below.

### Reasoning

Confirmed as written. An IO failure (`EACCES`) and a repair-needed
state both surface as a prefix validation error with a retry
affordance. `data_state:"not_saved"` is at least true for both — the
staging-dir design means nothing landed under `.loctt/`.

**Aside (out of the report's scope, not a Finding-2 verdict):** the
report describes `initLoctt` as refusing "a bad prefix"; the only
refusal is an *empty* prefix. `"bad prefix!!"` (spaces, punctuation)
was accepted end-to-end and a tracker was created with it. Whether a
prefix format rule is meant to live here, in the wizard, or nowhere is
not something I checked against the docs; flagging it for whoever owns
init, not asserting it as a defect.

---

## Finding 3 — `GET /api/search` silently drops unreadable tasks

**Verdict: CONFIRMED as a surface inconsistency. Severity stays Low. Whether it is a defect depends on a decision that is not recorded.**

### Code (checked)

`server.ts:3440` — `const tasks = await loadAllTasks(locttDir)`;
`loadAllTasks` is literally `(await loadAllTasksDetailed(locttDir)).tasks`
(`packages/core/src/task/load-all.ts:60-62`), so the `unreadable` array
is computed and discarded. `handleListTasks` (3225) and
`handleExportTasks` (3480) use the detailed form and surface it.

### Test and result

Two tasks created via `POST /api/tasks`: "pelican alpha", "pelican
beta". `chmod 000` on alpha's `task.md`. Then:

| Route | Observed |
|---|---|
| `GET /api/tasks` | `200`, `items:[beta]`, `total:1`, **plus** `"unreadable":[{"id":"01M1…","path":"…/task.md","reason":"EACCES: permission denied, open '…'"}]` |
| `GET /api/search?q=pelican` | `200`, `items:[beta]`, `total:1`, **no `unreadable` key** — response keys are exactly `items,total,offset,limit` |
| `GET /api/tasks/export?format=csv` | `200`, header `X-Loctt-Unreadable: …/01M1…/task.md` |

### Reasoning

Observed exactly as described: the same tracker, the same broken file,
list and export name it, search does not. `grep -i` of
`docs/dev/decisions.md` and `docs/dev/known-gaps.md` for
`UnreadableFileError`, search+unreadable, or a best-effort-search note
found nothing, so there is no recorded decision making search
deliberately best-effort. Low is right: the task is still reachable
and named from the list view, and search matching on a file that
cannot be read is impossible anyway — the most search could do is
carry the same `unreadable` field so the UI can say "1 task could not
be read" beside the results. The report's own hedge ("may be an
intentional best-effort scope … a one-line decision note would settle
it") is the correct framing; this is a decision to record either way,
not a bug to argue about.

---

## Also noted while verifying

- `git status` after cleanup: my probe file is gone. Untracked
  `packages/core/src/zz-phasez-verify.test.ts` is present and is **not
  mine** — it belongs to another Phase Z verifier running concurrently;
  I left it alone.
- Report's "checked and found correct" items were not re-verified here
  (out of the stated scope of the three findings).

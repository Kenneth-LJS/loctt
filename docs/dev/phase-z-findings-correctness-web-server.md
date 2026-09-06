# Phase Z — Correctness review: web server layer (`apps/web/src/server/`)

Scope: HTTP API handlers in `server.ts` and siblings — request
parsing/validation, core-result/error → HTTP status + envelope,
pagination, the `?progress`/counts/broken wiring, workflow PUT, bulk
endpoints, search. Read-only review. Client (`apps/web/src/client`)
excluded.

Verified against the code and the existing `server*.test.ts` suite. One
scenario was reproduced with a throwaway test (since removed); the rest
are traced through the source.

---

## Finding 1 — An unreadable config/state file (EACCES / EISDIR / ELOOP) is flattened to `500 code:"unknown"` with `recovery:"retry"`, blaming the server for a file the user must fix

**Severity: High** (this is the SET-39 / ERR-31 class the review brief
names explicitly, and it hits the primary list surface, not just a
settings panel.)

**Where**
- Top-level error mapping: `apps/web/src/server/server.ts:4792-4869`
  (the `catch` in `handleRequest`). It handles `HandledRequestError`,
  `TaskNotFoundError`, `BodyTooLargeError`, `LocttError`, and
  `FsAccessError` — but **not** `UnreadableFileError`.
- The error class: `packages/core/src/utils/read-state.ts:125` —
  `export class UnreadableFileError extends Error` (a **plain `Error`**,
  not `LocttError`, and unrelated to `FsAccessError`).
- Thrown by every `readFileState`-based loader on the `unreadable`
  branch: `config/workflow.ts:237`, `config/projects.ts:197`,
  `config/queries.ts:175`, `config/calendar.ts:169`,
  `config/list-view.ts:174`, `config/milestones.ts:140`,
  `config/sprints.ts:147`, `config/labels.ts:174`, `state/state.ts:98`,
  `task/history.ts:166,207`, `task/comments.ts:185`.
- `loadOptionalConfigs` (`packages/core/src/config/index.ts:136-145`)
  **re-throws** anything that is not a missing file, so the unreadable
  error propagates up through `GET /api/tasks` and `GET /api/search`
  too — it is not confined to the config routes.

**Why it happens**
The malformed-YAML case is fine: `WorkflowConfigError`,
`QueriesConfigError`, etc. all `extend LocttError`, so the top-level
`if (err instanceof LocttError)` branch (server.ts:4850) renders their
`toEnvelope()` (`code:"config_invalid"`, or `conflict` for a held
lock). The **unreadable** case is not a `LocttError` and is not an
`FsAccessError`, so it drops through to the generic tail
(server.ts:4864):

```
error(res, `The server failed while handling ${method} ${path}.`, 500, {
  code: "unknown",
  recovery: { kind: isRead ? "retry" : "reload" },
  detail: err instanceof Error ? err.message : String(err),
});
```

The actionable, user-facing reason (`describeUnreadable`, e.g. "LocTT
does not have permission to read …/workflow.yaml. Check the file's
permissions …") is present on `UnreadableFileError.message` and
carried only into `detail`, while the headline blames the server and
`recovery:"retry"` tells the user to do the one thing that cannot help.

**Concrete failing scenario (reproduced)**
`initLoctt(root)`, then make `workflow.yaml` unreadable — e.g. replace
it with a directory so `readFile` yields `EISDIR` (portable; `chmod 000`
gives the same class via `EACCES`):

```
rm .loctt/config/workflow.yaml && mkdir .loctt/config/workflow.yaml
```

`GET /api/workflow` returns (verbatim, from the reproduction):

```json
{
  "status": 500,
  "code": "unknown",
  "message": "The server failed while handling GET /api/workflow.",
  "error":   "The server failed while handling GET /api/workflow.",
  "recovery": { "kind": "retry" },
  "detail": "…/.loctt/config/workflow.yaml is a directory, but LocTT expected a file."
}
```

Expected (per ERR-31 / the `UnreadableFileError` doc-comment): a
`5xx` `io_failed` (or a named permission error) whose `message` is the
`describeUnreadable` sentence, with `recovery:{kind:"none"}` or a
"fix the file" affordance — not `unknown` + `retry`, and not a message
that says the *server* failed.

Same fault, same envelope, on every route that requires such a file:
- `GET /api/tasks` and `GET /api/search` (via `loadOptionalConfigs`,
  which re-throws) — the main list surface **white-screens** on an
  unreadable `workflow.yaml`, which is the exact outcome the brief's
  degrade requirement forbids.
- `GET /api/config`, `GET /api/workflow/usage`, `GET /api/projects`
  (`loadProjectsConfig` at server.ts:1524 is **not** wrapped),
  `GET /api/milestones`, `GET /api/sprints` (and their `?progress=true`
  path, via `loadWorkflowConfig` in `withProgress`, server.ts:1905),
  `GET /api/tasks/:ref/comments`, `GET /api/tasks/:ref/activity`.

**Why existing tests miss it**
`server.config-errors.test.ts` exercises only the *malformed-YAML*
path — it writes syntactically-parseable-but-schema-invalid content
(e.g. a status with no `key`, test at line 65) and asserts
`code === "config_invalid"`. That path goes through
`WorkflowConfigError` (a `LocttError`) and is correctly mapped, so the
test is green. No test in the suite makes a config or state file
*unreadable* (no `chmod`, no directory-in-place-of-file), so the
`UnreadableFileError` → generic-500 branch is never taken. The test at
`server.config-errors.test.ts:296` even asserts `code` is **not**
`io_failed` for the malformed case, reinforcing that only the parse
path is covered.

**Test that would catch it** (write against `GET /api/tasks` or
`GET /api/workflow`): replace `workflow.yaml` with a directory (or
`chmod 000` it on POSIX), then assert the response is **not**
`code:"unknown"` and **not** `recovery:{kind:"retry"}`, and that
`message` (not just `detail`) names the file.

---

## Finding 2 — `POST /api/init` maps every failure to `400 validation_failed` on `field:"prefix"`, including filesystem failures and the repair-needed case

**Severity: Moderate**

**Where** `apps/web/src/server/server.ts:2715-2719`

```js
} catch (err) {
  // initLoctt refuses on an existing tracker and on a bad prefix;
  // either way nothing was created.
  error(res, (err as Error).message, 400, { ...REJECTED_WRITE, field: "prefix" });
}
```

**Why it happens**
`initLoctt` (`packages/core/src/init/init.ts`) throws a bare `Error`
for several unrelated causes: a bad prefix (`init.ts:183`), a
non-empty project name (`init.ts:186`), an already-existing tracker
(`init.ts:201`), an `InitRepairNeededError` for a damaged/incomplete
`.loctt/` (`init.ts:204`), **and** any raw filesystem error from the
`mkdir`/`writeFile`/`rename` sequence (`init.ts:106-108, 141, 215-228`
— e.g. `EACCES` on a read-only parent directory, `ENOSPC` on a full
disk). The handler attributes all of them to the `prefix` input.

**Concrete failing scenario**
`POST /api/init` with a valid body (`{ "prefix": "T" }`) against a
`root` whose parent directory is not writable. `mkdir` throws `EACCES`;
the client receives `400 code:"validation_failed" field:"prefix"` with
the errno message. The UI (per ERR-14) will pin a red error on the
prefix input and offer retry, when the real cause is a directory
permission and retrying the same request cannot succeed. A caller
sending an already-good prefix has no way to see that the prefix is not
the problem.

Related: an `InitRepairNeededError` (damaged tracker reaching the
guard-exempt `/api/init`) is likewise reported as a prefix validation
failure rather than the distinct repair path it represents.

**Why existing tests miss it**
`server.init.test.ts` covers success and the ordinary refusals (bad
prefix, existing tracker) where `field:"prefix"` happens to read
plausibly. No test drives `initLoctt` into a raw filesystem error, so
the mislabel of an IO failure as a prefix-validation failure is never
asserted against.

---

## Finding 3 — `GET /api/search` silently drops unreadable tasks; unlike `/api/tasks` and export, it neither reports them nor sets a header

**Severity: Low**

**Where** `apps/web/src/server/server.ts:3440` — search uses
`loadAllTasks(locttDir)` (the plain loader), whereas
`handleListTasks` (server.ts:3225) and `handleExportTasks`
(server.ts:3480) use `loadAllTasksDetailed` and report the
`unreadable` set (as a body field and an `X-Loctt-Unreadable` header
respectively).

**Why it happens**
`loadAllTasks` returns only the tasks that parsed; the unreadable ones
are dropped with no channel to report them. The search response
(`json(res, paginated(frontmatters, …))`, server.ts:3456) carries no
`unreadable` field.

**Concrete failing scenario**
A task whose `task.md` is unreadable (or fails to parse) but whose
title/body would match the query `q`. `GET /api/search?q=<term>`
returns `200` with that task absent from `items` and no indication it
exists. The user searching for a task they know exists is told, in
effect, "no such task" — the same "short result presented as a
legitimate complete result" that ERR-9 / P-5 require to be named on the
list and export surfaces. Search is the one read surface that stays
silent.

This may be an intentional best-effort scope for search; flagging it as
an inconsistency to confirm rather than a definite defect. If intended,
a one-line decision note would settle it.

**Why existing tests miss it**
`server.search.test.ts` seeds only well-formed tasks, so the
drop-without-report path is never exercised;
`server.unreadable-task.test.ts` covers the list/detail routes, not
search.

---

## Checked and found correct (no finding)

- **`?progress=true` shape (K28).** `withProgress` (server.ts:1895)
  reads `report.unreadable` from `milestoneProgressDetailed` /
  `sprintProgressDetailed`, which degrade rather than throw on
  unreadable tasks (`packages/core/src/task/progress.ts:174-195`), and
  emits it at the top level alongside `broken` only when non-empty
  (server.ts:1936, 2029). The `progress` default
  (`{done:0,total:0,discarded:0,fraction:0}` for a milestone/sprint
  with no report entry, server.ts:1913) cannot throw. Shape is correct.
  (The one way this path can 500 is `loadWorkflowConfig` throwing
  `UnreadableFileError` at server.ts:1905 — that is Finding 1, not a
  separate defect.)
- **`broken` on config endpoints.** Milestones/sprints/projects emit
  `cfg.broken` only when present and non-empty; a corrupt *entry*
  degrades to `broken` and the surface still 200s. Correct.
- **Held state lock on writes.** `StateLockedError extends LocttError`
  with `code:"conflict"` (`state/lock.ts:59`). `PUT /api/workflow`
  catches `LocttError` first (server.ts:1475) and renders `toEnvelope()`
  → `409`, so the SET-39 "lock reported as config_invalid/400" bug is
  not present on that route. Config set/unset rethrow non-`ConfigRouterError`
  to the top-level `LocttError` branch, giving the same `409`.
- **Pagination.** `parsePagination` (server.ts:751) rejects negatives,
  non-integers, and `> MAX_PAGE_LIMIT` with `400`; `limit=0` yields an
  empty page with a correct `total` (acceptable). `paginated`
  (server.ts:795) slices safely when `offset > total` (returns `[]`,
  true `total`). No off-by-one; no unbounded read (list opts out of
  core's default limit deliberately and slices in `paginated`).
- **DSL injection.** `dslAtom` (server.ts:842) quotes any value not
  matching `^[A-Za-z_][A-Za-z0-9_.-]*$`; search passes `q` structurally
  (`text ~ ${JSON.stringify(q)}`, server.ts:3447). Filter values cannot
  inject query structure.
- **Bulk endpoints.** All four return `200` with a `succeeded`/`failed`
  split for partial failure and only reach `bulkAborted` (server.ts:616)
  when the whole batch aborts; `bulkAborted` renders a `LocttError`'s
  own envelope (so a held lock → `409`, not a generic `400`). Correct.
- **`X-Loctt-Unreadable` header (export).** The `|` join
  (server.ts:3525) is safe in practice: task paths are
  `.loctt/tasks/<ULID>/task.md`, which cannot contain `|`. Not a
  finding.

---

## Summary

| # | Severity | Route(s) | Issue |
|---|----------|----------|-------|
| 1 | High | `GET /api/tasks`, `/api/search`, `/api/workflow`, `/api/config`, `/api/projects`, `/api/milestones`, `/api/sprints`, comments, activity | Unreadable config/state file → `500 code:"unknown"` `recovery:"retry"`; `UnreadableFileError` is unhandled by the top-level catch |
| 2 | Moderate | `POST /api/init` | All failures (incl. filesystem errors, repair-needed) mapped to `400 validation_failed field:"prefix"` |
| 3 | Low | `GET /api/search` | Unreadable tasks silently dropped; not reported (unlike list/export) |

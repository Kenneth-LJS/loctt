# Init, schema, and diagnostics

`loctt init` and its options, schema versioning and migration, doctor, and
`info`.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Init options

### ONB-C1 · blocker · P4 P10 · CLI MCP
**Every accepted init option is honoured, or rejected.**
`--project-key` and `--project-label` are silently discarded on **all
three** surfaces — `apps/mcp/src/tools/tracker.ts:86-92` and
`apps/web/src/server/server.ts:1405-1406` do the same conditional spread as
the CLI. `InitRequestSchema` (`packages/contracts/src/service-schemas.ts:75-80`)
*declares* both as public API while its docstring claims it "Mirrors core's
`InitOptions`" — it does not, and because it is `.strict()` it rejects
unknown keys while accepting and dropping these two. Verified:
`initLoctt({projectLabel:"Bug tracker"})` yields `name: "Tasks"`. The worked
example at `docs/user/cli/reference.md:44` is a command where two of three
flags are no-ops. Zero tests repo-wide mention any spelling of the option.

- Running the reference's exact example yields
  `projects[0].name === "Bug tracker"`, not `"Tasks"`.
- `projects[0].prefix` is `BUG-`, proving the prefix path still works.
- `state.yaml`'s `keys[<project id>].prefix` is `BUG-` and the id matches
  `projects[0].id`.
- MCP `init` with `project_label` produces the same project name.
- Every key in the MCP tool's declared `inputSchema` maps to a field core
  actually reads — no declared parameter is discarded.
- If `--project-key` is *removed* rather than implemented (recommended —
  `projects.yaml` has no slug field), passing it exits non-zero with an
  unknown-option message and it no longer appears in `usage.ts` or the
  reference. Either resolution is fine; silently accepting is not.

**Given** an empty directory, **when** the documented init example runs on
each surface, **then** the project carries the given label and no accepted
flag is discarded.

### ONB-C2 · major · P10 · CLI MCP
**`--timezone` works everywhere init works.** It is CLI-only; MCP and web
omit it, and `.strict()` 400s it.

- MCP `init` with `{timezone:"Asia/Singapore"}` records that zone in
  `calendar.yaml`.
- An invalid zone returns an error naming it, and no `.loctt/` is created.
- The MCP init parameter set is a superset-or-equal of the CLI's documented
  flags, so parity cannot silently regress.

**Given** an agent initializing for a team in another zone, **when** it
passes `timezone`, **then** `calendar.yaml` records that zone rather than
the server machine's.

---

## B. Recovery and schema state

### ONB-C3 · blocker · P4 P6 · CLI
**Re-running `init` over a damaged `.loctt/` repairs it or names a repair
path.** `apps/cli/src/commands/init.ts:6-9` says init "only writes the
missing files"; `init.ts:92-94` throws unconditionally. Verified: delete
`.loctt/config/` and doctor reports 3 errors while init refuses with
"already exists" — the only way back is `rm -rf .loctt/`, destroying
surviving tasks.

- Init over a `.loctt/` whose `config/` was deleted does not exit with only
  `.loctt directory already exists` and no further guidance.
- The message either reports what was repaired, or names the missing files
  and the command that fixes them.
- The pre-existing tasks are present and readable afterwards, whichever
  branch is taken.
- `loctt doctor` after the repair path reports zero `error` checks.

**Given** a `.loctt/` whose `config/` was deleted but whose tasks survive,
**when** `loctt init` runs, **then** the user gets a route to a working
tracker that does not require deleting their tasks.

### ONB-C4 · blocker · P4 P7 · CLI
**`loctt doctor` reports schema-version problems.** Doctor has 17 checks
and none reads `.schema-version`. Verified: set it to `99` and doctor
returns all-`ok` while every command is blocked by the guard.
`computeSchemaStatus` already exists next door in
`packages/core/src/diagnostics/info.ts:96-107`.

- With `.schema-version` set to `99`, a check named for the schema version
  reports `error`, stating both the on-disk version and the supported one.
- The exit code is non-zero — today it is 0, because no check fails.
- With `.schema-version` deleted, an `error` check distinguishes
  "uninitialized/legacy" from "outdated", matching the distinction
  `../ui-test-cases/flow-cross-surface.md` XS-33 requires of the UI.
- With a migration sentinel present, an `error` check quotes the sentinel
  path and the backup path it records.
- On a healthy tracker the same check reports `ok` with the current
  version.

**Given** a tracker whose recorded schema version does not match the build,
**when** `loctt doctor` runs, **then** it names the schema version as the
failing check rather than reporting the tracker healthy.

### ONB-C5 · minor · P4 P10 · CLI
**`loctt info` reports schema status.** Both CLI and MCP compute it and
neither prints it.

- On a fresh tracker, `loctt info` includes the current schema version.
- Below current, the output names the mismatch and points at
  `loctt migrate`, matching the wording the UI banner uses.

**Given** a tracker at a non-current schema version, **when** `loctt info`
runs, **then** the mismatch is stated.

### ONB-C6 · major · P4 P7 · CLI MCP
**Migration is reachable from every surface that can be blocked by the
guard.** There is no `/api/migrate` route while the schema guard 409s at
`apps/web/src/server/server.ts:2093`. The UI is honest about it —
`SchemaBanner.tsx:49-57` renders a P4-compliant message naming the versions
and `loctt migrate`, with the M4 deferral recorded at `:11-13` — so this is
a capability gap, not an error-quality bug.

- Either an HTTP migrate route exists, or the banner's CLI instruction is
  the documented remedy and the reference says so.
- **Cold load:** the banner is built from `info.schemaStatus`, but
  `/api/info` itself 409s under the guard — so a client must still be able
  to learn *why* it is blocked when every endpoint is refusing.
- `rebuild_index` is reachable from the web, or documented as CLI/MCP-only.

**Given** a tracker whose schema is outdated, **when** a fresh browser
session loads the app, **then** it can determine and display the reason
without a prior successful `/api/info`.

### ONB-C7 · minor · P4 · MCP
**`doctor` output is machine-checkable.**

- On a tracker with a deliberately broken `workflow.yaml`, the `doctor`
  result is distinguishable from a healthy run without substring-matching
  prose — via `isError` or a structured field.

**Given** an agent running `doctor` to decide whether to proceed, **when** a
check fails, **then** the failure is detectable from the result shape.

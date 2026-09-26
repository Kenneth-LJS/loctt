# Init, schema, and diagnostics

`loctt init` and its options, schema versioning and migration, doctor,
`info`, installing each published package, and the security posture.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Init options

### ONB-C1 · blocker · P4 P10 · CLI MCP — **resolved**
**Every accepted init option is honoured, or rejected.**
`--project-key` and `--project-label` were silently discarded on all three
surfaces: core's option is `projectName`, and every surface passed
`projectLabel`, which `InitOptions` does not have. A conditional spread is
not excess-property-checked, so this cost nothing at the type level despite
`strict` and `exactOptionalPropertyTypes` both being on.

Resolved as recommended — `--project-key` removed (`projects.yaml` stores
`{id, name, prefix}` with no slug, so it could never be honoured);
`--project-label` implemented, mapping to `projectName`.

- Running the reference's exact example yields
  `projects[0].name === "Bug tracker"`, not `"Tasks"`.
  → `tests/integration/cli/init.test.ts`
- `projects[0].prefix` is `BUG-`, proving the prefix path still works.
  → `tests/integration/mcp/init.test.ts`
- `state.yaml` is keyed by the project id from `projects.yaml`.
  → `tests/integration/mcp/init.test.ts`
- MCP `init` with `project_label` produces the same project name.
  → `tests/integration/mcp/init.test.ts`
- `--project-key` now exits 2 with an unknown-option message naming the
  accepted flags, and appears in neither `usage.ts` nor the reference.
  → `apps/cli/src/cli.test.ts`

**Given** an empty directory, **when** the documented init example runs on
each surface, **then** the project carries the given label and no accepted
flag is discarded.

**Note:** the CLI only validates unknown flags where a command opts in via
`rejectUnknownFlags`. `init` does; other commands still ignore unrecognized
flags silently. Extending that is a separate change — several commands take
pass-through arguments that must not be rejected.

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

---

## B. Installing and running what is published

### ONB-C8 · blocker · P4 P10 · CLI MCP UI
**The published package installs on its own and runs all three
surfaces.** Found by the release-gate audit (RR-B4, K136): outside the
monorepo, `loctt ui` from the installed CLI answered `/` with a 404 (the
CLI shipped no web client and `resolveClientDir` only found one inside
the repo), and the separately published MCP and web packages could not
run at all. K139 makes `loctt` the one published package.

`loctt` is packed (`npm pack`) and installed into an empty directory
outside the repository with only its declared dependencies:

- `loctt --version` prints the package version. `loctt init` then
  `loctt create` make a tracker with a task.
- `loctt ui --no-open` serves `/` as HTML (200) with its script assets,
  and `/api/info` and `/api/tasks` answer for that tracker. An install
  without the web client refuses to start and says the install is
  damaged, rather than serving an API with a 404 page.
- `loctt mcp` answers `initialize` with name `loctt`, the package version
  and the agent instructions, lists every tool the MCP server registers
  (99 or more), and a read tool returns the task the installed CLI
  created.
- Pointed at a tracker whose schema is newer than it knows, a CLI
  command and an MCP tool call are both refused with "newer version of
  LocTT".
  → `tests/packaging/install.test.ts` (`npm run test:packaging`)

**Given** a user who installs `loctt` from npm, **when** they run
`loctt`, `loctt ui` or `loctt mcp`, **then** each works with no other
LocTT package present.

> **Amended (K139, Ken 2026-09-27).** Ken: *"lets combine into one
> surface for loctt"*. Was "each published package installs on its own"
> over `@loctt/cli`, `@loctt/mcp` (`loctt-mcp`) and `@loctt/web`
> (`loctt-ui`); now one package, `loctt`, and the `loctt-mcp`/`loctt-ui`
> bullets are gone.

### ONB-C9 · blocker · P10 · CLI MCP UI
**The published manifest tells the truth, and it is the only one.**
RR-B1 (K136): license and version metadata were right but nothing
checked them, and nothing checked that a package declares what its
bundle loads (a `yaml` crash in the old `@loctt/web` was exactly that).

- `loctt` (`apps/cli`) is the only publishable package: every other
  workspace, and the root, is `private`.
- `loctt` is public, MIT, and ships its LICENSE. It, every app
  workspace and the root carry one version and one Node floor.
- Its one launcher is `loctt`. Every `bin` and `main` target is in the
  tarball, and the bin starts with a Node shebang.
- Its runtime `dependencies` are exactly the bare packages its shipped
  bundle imports: nothing undeclared, nothing unused, and no internal
  `@loctt/*` workspace.
- `prepublishOnly` rebuilds, so a stale `dist` cannot ship.
- The tarball contains the web client `loctt ui` serves.
  → `tests/packaging/manifest.test.ts` (`npm run test:packaging`)

**Given** a release, **when** the package is packed, **then** its
manifest matches what it contains and loads, and nothing else is
publishable.

> **Amended (K139, Ken 2026-09-27).** Ken: *"lets combine into one
> surface for loctt"*. Was three public packages (`@loctt/cli`,
> `@loctt/mcp`, `@loctt/web`) with launchers `loctt`, `loctt-mcp` and
> `loctt-ui`; now one, and the others must be private.

### ONB-C10 · blocker · P1 · UI
**The documented security posture holds.** RR-B2 (K136): SECURITY.md and
the README's "Data & security" section make promises that no case
required, and SECURITY.md linked to a README anchor that did not exist.

- The web server listens on `127.0.0.1` only, and neither `loctt ui` nor
  the dev server's entry (`apps/web/src/server/main.ts`) has a flag or
  variable that binds it elsewhere. `dev:host`
  exposes the Vite client only; its API proxy targets loopback.
- A request with a `Host` header that is not a loopback name is refused
  (403, DNS rebinding); `localhost` and `127.0.0.1` are served.
- The page is served with a Content-Security-Policy that restricts
  sources to `'self'`, forbids plugins and framing, and allows no inline
  script beyond hashed ones.
- The API sends no CORS headers, even to a request with a foreign
  `Origin`.
- SECURITY.md's link into the README resolves to an existing heading.
  → `apps/web/src/server/server.security-posture.test.ts`

**Given** the security documentation, **when** its checkable claims are
tested against the running server, **then** each holds.


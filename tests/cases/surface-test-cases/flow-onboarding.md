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
- `loctt` is public, AGPL-licensed, and ships its LICENSE. It, every app
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

### ONB-C11 · blocker · P10 · CLI MCP UI
**A format version is the `loctt` release that introduced it (K142).**
`.loctt/.schema-version` holds a semver string, not a counter.

- `loctt init` (and web/MCP init) writes this build's format version,
  `0.3.0`, the release that introduced ordered links.
- Versions compare as semver: `0.10.0` is newer than `0.3.0`.
- No pre-release tags: `0.3.0-rc.1` is not a format version.
- Upgrade steps are keyed by semver from/to (the first is 0.1.0 → 0.3.0).
- `loctt info`, doctor, `loctt migrate`, MCP `migrate_schema`, the web
  banner and the backup header print format versions as written
  (`0.1.0`), never `v1`.
  → `packages/core/src/schema/version.test.ts`, `migrations.test.ts`,
  `init/init.test.ts`, `tests/integration/cli/info-schema.test.ts`

**Given** a fresh `loctt init`, **when** `.loctt/.schema-version` is
read, **then** it holds `0.3.0`.

### ONB-C12 · blocker · P4 P7 · CLI MCP UI
**A tracker the code cannot read is refused with what to do.** K142.

- A tracker newer than the code is refused with "This tracker needs
  loctt <its version> or newer." on every surface (CLI exit 1, MCP
  `isError`, web 409 `schema_mismatch` with no command).
- `.schema-version` holding anything that is not a format version —
  the old `1`, garbage, or nothing — is refused with a message that
  says what the file must contain ("must hold a format version such as
  0.3.0 (three whole numbers separated by dots)"). For `1` the remedy
  says to write `0.1.0` (a tracker made by loctt 0.2.x or earlier).
  There is no compatibility for `1` (Ken edits his trackers by hand).
- Nothing is written and no backup is made when refused.
- A backup file recording a newer format is refused the same way; one
  recording an older format (or 0.2.x's integer) is refused by name.
- A git branch published in a newer format is refused on sync/publish,
  naming the release to install; one holding 0.2.x's integer `1` is
  older, and proceeds.
  → `tests/integration/cli/format-upgrade.test.ts`,
  `packages/core/src/schema/upgrade-0.3.0.test.ts`,
  `backup/format.test.ts`, `git/schema-remote-newer.test.ts`,
  `apps/web/src/server/schema-guard.test.ts`

**Given** `.schema-version` = `9.9.9`, **when** any command runs,
**then** it says "This tracker needs loctt 9.9.9 or newer." and writes
nothing.

### ONB-C13 · blocker · P1 P4 P10 · CLI MCP UI
**An upgrade with no risky step runs automatically on first use.** K143.

- The first command (CLI), tool call (MCP) or API request (web) that
  opens a tracker needing only non-risky steps upgrades it: it backs up
  `.loctt/` to a sibling `.loctt.backup-v<from>-…` first, runs the steps
  with the crash sentinel around each, and stamps the new version.
- It says so in one line: "Upgraded this tracker from 0.1.0 to 0.3.0
  (backup: <path>)." — on the CLI's stderr, after the MCP call's own
  content (and in the server log), and in the web shell (ONB-C17).
- The command then runs as normal; later commands say nothing.
- A path with a risky step is not run automatically: every surface
  refuses and points at `loctt migrate`.
- On the CLI, `loctt doctor` and `loctt info` describe an older tracker
  (and say the next command upgrades it) without upgrading it (they are
  exempt from the guard; MCP `info`/`doctor` are not, and upgrade like
  any tool). `loctt migrate` and MCP `migrate_schema` still preview
  before applying.
  → `tests/integration/cli/format-upgrade.test.ts`,
  `tests/integration/mcp/migrate.test.ts`, `apps/mcp/src/mcp.test.ts`,
  `apps/web/src/server/schema-guard.test.ts`,
  `packages/core/src/schema/upgrade-0.3.0.test.ts`, runthrough
  `upgrade/upgrade-on-first-use`

**Given** a tracker at 0.1.0, **when** `loctt list` runs, **then** it
prints the upgrade line, a backup exists, the tracker is at 0.3.0, and
the list is shown.

### ONB-C14 · blocker · P1 P7 · CLI MCP UI
**An upgrade that crashes part-way stops every surface until it is
recovered.**

- A throw inside a step leaves `.schema-migration-in-progress` naming
  the step's from/to and the backup; the version is not advanced past
  the last completed step.
- The next start on any surface refuses with the recovery message
  (restore from the named backup, remove the sentinel), and does not
  re-run the upgrade.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts` (injected throw),
  `tests/integration/cli/format-upgrade.test.ts`

**Given** an upgrade whose step throws, **when** any command runs next,
**then** it refuses with "A schema migration was interrupted mid-run."
and the restore instructions.

### ONB-C15 · major · P7 · CLI MCP UI
**A retired `ranked` setting never breaks loading.** K143 removed
`ranked` from the relationship schema.

- A `ranked:` line on a relationship in `workflow.yaml` is dropped on
  read: the kind loads and is not reported broken.
- `loctt doctor` reports it as a warning ("'ranked' on <kind> no longer
  does anything: every link is ordered since loctt 0.3.0. Remove that
  line").
- The 0.1.0 → 0.3.0 upgrade removes the lines, keeping the rest of the
  file (comments included); any later write of `workflow.yaml` drops them.
- `loctt relationship add/edit` no longer take `--ranked`, MCP
  `edit_workflow_entity` no longer reads `fields.ranked`, and the
  settings UI has no ranked control.
  → `packages/core/src/config/retired-keys.test.ts`

**Given** `ranked: true` on `blocks`, **when** doctor runs, **then** it
warns naming `blocks`, and every surface still loads the kind.

### ONB-C16 · major · P1 · CLI MCP UI
**Two processes opening an old tracker at once upgrade it once.**

- Under the migration lock, one upgrades; the other waits for it (its
  sentinel is not mistaken for a crash while the lock is held), finds the
  tracker current, runs no step and prints no line.
- Exactly one backup is made; every command succeeds.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts`,
  `tests/integration/cli/format-upgrade.test.ts` (three CLI processes)

**Given** a 0.1.0 tracker, **when** three commands start at once,
**then** exactly one prints the upgrade line and one backup exists.

### ONB-C17 · major · P4 · UI
**The web says it upgraded the tracker, once.** K143 (the notice is an
agent call recorded in A361).

- After the server upgrades a tracker on the first API request,
  `/api/info` carries `completedUpgrade` (from, to, backup, and the one
  line) for the life of the server process.
- The shell shows the line above the app as a `role="status"` notice
  with a Dismiss control; the app is usable (not the mismatch banner).
- Dismissed, it stays gone across the `/api/info` poll and a reload in
  the same session; a later upgrade (another backup) shows again.
  → `apps/web/src/client/shell/UpgradeNotice.test.tsx`,
  `apps/web/src/server/schema-guard.test.ts`,
  `tests/ui/flow-schema-mismatch.spec.ts`

**Given** a 0.1.0 tracker, **when** `loctt ui` opens it, **then** the
shell shows "Upgraded this tracker from 0.1.0 to 0.3.0 (backup: …)."
until dismissed.

### ONB-C18 · blocker · P1 · CLI MCP UI
**The 0.1.0 → 0.3.0 step ranks every link in the order it was shown.**
Not risky (K143).

- After the step every link has a rank, and each task's group of each
  type lists (by rank) exactly as 0.1.0 showed it: a kind set `ranked:
  true` by rank then unranked in stored order; any other kind in stored
  order, ignoring stale ranks.
- Only `relationships` changes (no `updated_at`, no history entry); a
  task that cannot be read, or whose `relationships` cannot, is left.
- Running it again changes nothing, and the result is doctor-clean.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts` (frozen seed),
  `schema/steps/rank-every-link.test.ts`, runthrough
  `upgrade/upgrade-on-first-use`

**Given** the frozen 0.1.0 seed, **when** it is upgraded, **then** every
group lists as before, and a second run writes nothing.

### ONB-C19 · blocker · P10 · CLI
**The installed package upgrades an old tracker and refuses a newer one.**

- The `loctt` installed from the packed tarball upgrades a 0.1.0 tracker
  on first use, printing the line, and runs the command.
- It refuses a tracker at 9.9.9 with "This tracker needs loctt 9.9.9 or
  newer."
  → `tests/packaging/install.test.ts` (`npm run test:packaging`)

**Given** the installed package, **when** it opens a 0.1.0 tracker and a
9.9.9 one, **then** the first is upgraded and the second refused.

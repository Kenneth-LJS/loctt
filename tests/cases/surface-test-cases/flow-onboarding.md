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
  Upgrade screen and the backup header print format versions as written
  (`0.1.0`), never `v1`.
  → `packages/core/src/schema/version.test.ts`, `migrations.test.ts`,
  `init/init.test.ts`, `tests/integration/cli/info-schema.test.ts`

**Given** a fresh `loctt init`, **when** `.loctt/.schema-version` is
read, **then** it holds `0.4.0`.

> **Amended (K160, Ken 2026-09-29).** Ken: *"actually can we just do a
> migration step: migrate old pins into the sidebar? i dont want to
> support this backward compatibility forever."* Format **0.4.0** adds
> the 0.3.0 → 0.4.0 step (ONB-C23), so this build writes `0.4.0` and a
> 0.1.0 tracker upgrades through 0.3.0 to 0.4.0 in one run.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. This case only renames the web surface it lists (the Upgrade screen
> replaced the schema banner for an older tracker).

### ONB-C12 · blocker · P4 P7 · CLI MCP UI
**A tracker the code cannot read is refused with what to do.** K142.

- A tracker newer than the code is refused with "This tracker needs
  loctt <its version> or newer." on every surface (CLI exit 1, MCP
  `isError`, web 409 `schema_mismatch` with no command).
- `.schema-version` holding anything that is not a format version —
  the old `1`, garbage, or nothing — is refused with a message that
  says what the file must contain ("must hold a format version such as
  0.3.0 (three whole numbers separated by dots)"). For `1` the remedy
  says to write `0.1.0` (a tracker made by loctt 0.2.x or earlier), then
  run `loctt migrate`. There is no compatibility for `1` (Ken edits his
  trackers by hand).
- Nothing is written and no backup is made when refused.
- A backup file recording a newer format is refused the same way; one
  recording an older format (or 0.2.x's integer) is refused by name.
- A git branch published in a newer format is refused on sync/publish,
  naming the release to install; one holding 0.2.x's integer `1` is
  refused with how to fix the branch (K151).
  → `tests/integration/cli/format-upgrade.test.ts`,
  `packages/core/src/schema/upgrade-0.3.0.test.ts`,
  `backup/format.test.ts`, `git/schema-remote-newer.test.ts`,
  `apps/web/src/server/schema-guard.test.ts`

**Given** `.schema-version` = `9.9.9`, **when** any command runs,
**then** it says "This tracker needs loctt 9.9.9 or newer." and writes
nothing.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. Here: the remedy for `1`/garbage said "The next command upgrades the
> tracker from there"; it now names `loctt migrate` as the step after
> writing the file.

### ONB-C13 · blocker · P1 P4 P10 · CLI MCP UI
**An older tracker is refused on every surface until the user upgrades
it on purpose.** K154.

- Every CLI command (except the guard-exempt `init`, `migrate`,
  `doctor`, `info`, help), every MCP tool (except `init`,
  `migrate_schema`, `info`, `doctor`) and every web API route (except
  `/api/init` and the two migrate routes) on an older tracker is refused
  with "This tracker needs upgrading from <from> to <to>. Run `loctt
  migrate` (a backup is made first)." (CLI exit 1 on stderr, MCP
  `isError` text, web 409 `schema_mismatch` with kind `outdated`, both
  versions, and the `loctt migrate` command). `<from>` is the version
  as written (`0.2.1` stays `0.2.1`).
- Nothing is written and no backup is made: the tracker's files are
  byte-for-byte what they were.
- A risky step does not change the trigger: every upgrade waits for the
  user. Risk is shown in the preview (`[risky]`, `[RISKY]`, a Risky tag).
- The upgrade runs only through `loctt migrate` (ONB-C21), MCP
  `migrate_schema` with `confirm: true` (ONB-C22), or the web Upgrade
  button (ONB-C17), each backing up `.loctt/` to a sibling
  `.loctt.backup-v<from>-…` first, with the crash sentinel around each
  step. The refused command then runs.
  → `tests/integration/cli/format-upgrade.test.ts`,
  `tests/integration/mcp/migrate.test.ts`, `apps/mcp/src/mcp.test.ts`,
  `apps/cli/src/commands/migrate.test.ts`,
  `apps/web/src/server/schema-guard.test.ts`,
  `packages/core/src/schema/upgrade-0.3.0.test.ts`, runthrough
  `upgrade/upgrade-intentional`

**Given** a tracker at 0.1.0, **when** `loctt list` runs, **then** it
exits 1 with "This tracker needs upgrading from 0.1.0 to 0.3.0. Run
`loctt migrate` (a backup is made first)." and no file changes.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. This case was "An upgrade with no risky step runs automatically on
> first use", with the one-line notice on each surface.

### ONB-C14 · blocker · P1 P7 · CLI MCP UI
**An upgrade that crashes part-way stops every surface until it is
recovered.**

- A throw inside a step leaves `.schema-migration-in-progress` naming
  the step's from/to and the backup; the version is not advanced past
  the last completed step.
- The next start on any surface refuses with the recovery message
  (restore from the named backup, remove the sentinel), and does not
  re-run the upgrade.
- While another process's upgrade holds the migration lock, its
  sentinel is live, not a crash: a command says "This tracker is being
  upgraded by another loctt process." and to wait.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts` (injected throw,
  the held lock), `tests/integration/cli/format-upgrade.test.ts`

**Given** an upgrade whose step throws, **when** any command runs next,
**then** it refuses with "A schema migration was interrupted mid-run."
and the restore instructions.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. Here: the upgrade that crashes is one the user started (`loctt
> migrate`, `migrate_schema`, the Upgrade button), not a first use; the
> live-lock bullet replaces K143's "the second opener waits".

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

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. Unchanged in substance: the upgrade that removes the lines is the one
> the user runs.

### ONB-C16 · major · P1 · CLI MCP UI
**Two upgrades started at once upgrade the tracker once.**

- Under the migration lock, one upgrades; the other finds the tracker
  current ("already at format 0.3.0. Nothing to do.") or, if it looks
  while the first holds the lock, says the tracker is being upgraded by
  another loctt process. Neither runs a step twice or reads the live
  sentinel as a crash.
- Exactly one backup is made.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts`,
  `tests/integration/cli/format-upgrade.test.ts` (two `loctt migrate
  --yes`)

**Given** a 0.1.0 tracker, **when** two `loctt migrate --yes` start at
once, **then** exactly one prints "Upgraded this tracker from 0.1.0 to
0.3.0." and one backup exists.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. This case was "Two processes opening an old tracker at once upgrade
> it once" (any two commands, the second waiting up to 60 s).

### ONB-C17 · major · P4 · UI
**The web shows an Upgrade screen, and only that, until the user
upgrades.** K154 (Ken: *"get ui agent to design banner if needed"*).

- On an older tracker the app renders the Upgrade screen in place of
  the shell: a brand bar and one centered panel (`role="alert"`), no
  sidebar, no routed page. Every API route refuses the tracker, so
  nothing else could work.
- The panel says "This tracker needs upgrading from <from> to <to>."
  and "A backup is made first.", lists the steps in plain words in a
  collapsed disclosure (a risky step tagged Risky), and has one primary
  **Upgrade** button, focused on load, at least 24px tall. No em dashes.
  It names no CLI command (the button is the web's remedy).
- Upgrade POSTs `/api/migrate` once, even on a same-tick double click
  (A333), shows the spinner while it runs, and reloads the app on
  success.
- A failure after the backup says the upgrade didn't finish, that the
  tracker may be partly upgraded, and shows the backup path to restore
  from, with Reload (not Upgrade). A refusal before anything ran says
  why and "Nothing was changed.", and Upgrade stays.
- Tokens only, so it works in both themes.
  → `apps/web/src/client/shell/UpgradeRequired.test.tsx`,
  `AppBootstrap.test.tsx`, `tests/ui/flow-schema-mismatch.spec.ts`

**Given** a 0.1.0 tracker, **when** `loctt ui` opens it, **then** only
the Upgrade screen shows, and clicking Upgrade loads the app with every
link in the order 0.1.0 showed it.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. This case was "The web says it upgraded the tracker, once": a
> dismissable `role="status"` notice after the server upgraded on the
> first request (`/api/info.completedUpgrade`, now removed).

### ONB-C18 · blocker · P1 · CLI MCP UI
**The 0.1.0 → 0.3.0 step ranks every link in the order it was shown.**
Not marked risky.

- After the step every link has a rank, and each task's group of each
  type lists (by rank) exactly as 0.1.0 showed it: a kind set `ranked:
  true` by rank then unranked in stored order; any other kind in stored
  order, ignoring stale ranks.
- Only `relationships` changes (no `updated_at`, no history entry); a
  task that cannot be read, or whose `relationships` cannot, is left.
- Running it again changes nothing, and the result is doctor-clean.
- The preview describes it in plain words: "Save the order of every
  task's links" and what changes.
  → `packages/core/src/schema/upgrade-0.3.0.test.ts` (frozen seed),
  `schema/steps/rank-every-link.test.ts`, runthrough
  `upgrade/upgrade-intentional`

**Given** the frozen 0.1.0 seed, **when** it is upgraded, **then** every
group lists as before, and a second run writes nothing.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. Here: "Not risky (K143)" meant it ran automatically; risk now only
> marks a step in the preview.

### ONB-C19 · blocker · P10 · CLI
**The installed package refuses an old tracker until `loctt migrate
--yes`, and refuses a newer one.**

- The `loctt` installed from the packed tarball refuses a 0.1.0 tracker
  with the upgrade message, exit 1, writing nothing; `loctt migrate
  --yes` upgrades it (one backup), and the refused command then runs.
- It refuses a tracker at 9.9.9 with "This tracker needs loctt 9.9.9 or
  newer."
  → `tests/packaging/install.test.ts` (`npm run test:packaging`)

**Given** the installed package, **when** it opens a 0.1.0 tracker and a
9.9.9 one, **then** the first is refused until `loctt migrate --yes`
and the second refused.

> **Amended (K154, Ken 2026-09-28).** Ken reversed K143's automatic
> upgrade, telling the orchestrator not to follow the K143-era cases
> blindly: *"these stories are ai-created so i wouldnt completely treat
> is source of truth"*. On MCP a background agent would change the data
> format without the user seeing it, and on a git-shared tracker whoever
> runs the new version first forces everyone else to upgrade. Upgrades
> are now intentional on every surface. This case was "The installed package upgrades an old tracker" on
> first use, printing the line.

### ONB-C20 · blocker · P1 P4 · CLI MCP UI
**Doctor and info are read-only on every surface and say an upgrade is
needed.** K154.

- CLI `loctt info` / `loctt doctor`, MCP `info` / `doctor`, and web
  `/api/info` / `/api/doctor` never write to an older tracker, repairs
  requested or not.
- CLI and MCP info print "Schema: needs upgrading from <from> to <to>.
  Run `loctt migrate` (a backup is made first)". Doctor's schema check
  is an error: "needs upgrading from <from> to <to>. Run loctt migrate
  (a backup is made first)". On the web both routes answer the guard's
  409 (kind `outdated`, the same message).
- Every requested repair (`--fix`, `--rebuild-index`,
  `--repair-relationships`; MCP `fix`, `rebuild_index`,
  `repair_relationships`, `restore_missing`) is skipped with "skipped.
  This tracker needs upgrading first. Run loctt migrate, then run the
  repair again".
  → `packages/core/src/schema/upgrade-0.3.0.test.ts`,
  `apps/cli/src/commands/migrate.test.ts`, `apps/mcp/src/mcp.test.ts`,
  `apps/web/src/server/schema-guard.test.ts`,
  `tests/integration/cli/format-upgrade.test.ts`

**Given** a 0.1.0 tracker, **when** `loctt doctor --fix` runs, **then**
it reports the upgrade, skips the repairs saying why, and no file
changes.

### ONB-C21 · blocker · P1 P4 · CLI
**`loctt migrate` previews, then asks.** K154.

- It prints "This tracker needs upgrading from <from> to <to>.", each
  step (from → to, a one-line description, what it changes in plain
  words, `[risky]` on a risky step) and where the backup goes
  (`<.loctt>.backup-v<from>-<date and time>`), then asks "Upgrade this
  tracker now? [y/N]".
- `y` upgrades and says "Upgraded this tracker from <from> to <to>."
  with the backup path. Anything else: "Not upgraded. Nothing was
  changed.", exit 0.
- `--dry-run` prints the preview only: no prompt, nothing changed.
- `--yes` skips the prompt.
- Not at a terminal and no `--yes`: refused naming the flag ("Pass
  --yes"), exit 2, nothing changed.
- On a current tracker: "already at format 0.4.0. Nothing to do."
  → `apps/cli/src/commands/migrate.test.ts`,
  `tests/integration/cli/format-upgrade.test.ts`

**Given** a 0.1.0 tracker and a script, **when** it runs `loctt
migrate` without `--yes`, **then** it exits 2 naming `--yes` and the
tracker is unchanged.

> **Amended (K160, Ken 2026-09-29).** Ken: *"actually can we just do a
> migration step: migrate old pins into the sidebar? i dont want to
> support this backward compatibility forever."* Format **0.4.0** adds
> the 0.3.0 → 0.4.0 step (ONB-C23), so from 0.1.0 the preview lists both steps
> and "already at format" names 0.4.0.

### ONB-C22 · blocker · P1 · MCP
**Agents ask the user before upgrading.** K154.

- `migrate_schema`'s description and the server instructions
  (`MCP_INSTRUCTIONS`) both say "Don't call migrate_schema unless the
  user asked you to upgrade the tracker. Tell the user it needs
  upgrading and ask."
- `migrate_schema` keeps preview (`confirm` false or omitted: from → to,
  each step and what it changes, `[RISKY]`, the backup location, and
  "Show the user this plan") and apply (`confirm: true`: "Upgraded this
  tracker from <from> to <to>." and the backup path). The preview writes
  nothing.
  → `apps/mcp/src/mcp.test.ts`, `tests/integration/mcp/migrate.test.ts`

**Given** an agent connected to an older tracker, **when** it reads the
tools, **then** the ask-first rule is in `migrate_schema` and in the
server instructions.

### ONB-C23 · blocker · P1 P7 · CLI MCP UI
**The 0.3.0 → 0.4.0 step moves each user's sidebar settings to the Views
layout.** K160. Not marked risky.

- Every `users/*/settings.yaml` holding a pre-K158 `sidebar_groups` (no
  `version`) becomes the K158 `version: 2` layout by SHL-54's rule: the
  switcher becomes `layouts` in its place; one Views group where the
  earlier of Filters and Saved views sat, their views in the order they
  showed; a hidden old group hides each of its views, and Views is hidden
  only when both were.
- `sidebar_pins` orders the saved views once (pinned first, in pin order;
  a pin naming a missing, archived or broken view is skipped), then is
  deleted. A file with pins and no `sidebar_groups` is read as an empty
  pre-K158 value, so the pins still lead.
- Every other key, comment and line of the file is untouched; a file
  with neither key is not written; a `version: 2` value is kept (its pins
  are only deleted).
- A file that cannot be read or parsed, or whose pre-K158 value is not
  clean, is left exactly as it is, and `loctt doctor` names it after the
  upgrade.
- Running it again changes nothing. From 0.1.0 it runs after 0.1.0 →
  0.3.0 in the same upgrade, and every preview (CLI, MCP, the web
  Upgrade screen) lists both steps.
- The preview describes it in plain words: "Move sidebar settings to the
  Views layout" and what changes.
  → `packages/core/src/schema/upgrade-0.4.0.test.ts` (frozen 0.3.0 seed),
  `tests/integration/cli/user-sidebar-groups.test.ts`,
  `tests/integration/mcp/sidebar-groups.test.ts`, runthrough
  `upgrade/upgrade-sidebar-settings`, `tests/packaging/install.test.ts`,
  `tests/ui/flow-schema-mismatch.spec.ts`

**Given** the frozen 0.3.0 seed with pre-K158 sidebar settings and pins,
**when** it is upgraded, **then** each user's sidebar shows what it
showed, the old keys are gone, and a second run writes nothing.

> Added (K160, Ken 2026-09-29): *"actually can we just do a migration
> step: migrate old pins into the sidebar? i dont want to support this
> backward compatibility forever."* Rules recorded as A372.

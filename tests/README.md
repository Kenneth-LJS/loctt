# LocTT Test Plan

Integration, E2E, and performance tests for the LocTT CLI and MCP server. Core-library unit tests live alongside the source under `packages/core/src/**/*.test.ts`.

There are two kinds of test in this folder:

- **Automated (deterministic)** — described below. Vitest, real CLI binary spawns, real MCP-stdio transport, isolated tmpdir per test. Run via `npm run test:integration`, `npm run test:e2e`, etc.
- **LLM runbook** — `tests/llm/README.md`. Manual scenarios for verifying that an LLM can drive the MCP tools correctly. Run after the automated suite, results logged to `tests/llm/results/`.

---

## Layout

```
tests/
  README.md                  # this doc
  scripts/
    smoke.sh                 # manual install-mode smoke check
  integration/
    fixtures/                # tmp-loctt, git-loctt, git-loctt-with-remote
    adapters/                # cli-in-process, cli-spawn, mcp-stdio
    scenarios/               # shared scenario DSL for parity tests
    cli/                     # CLI-spawn tests, one file per command
      edges/                 # CLI argv / parser edge-case tests
    mcp/                     # MCP-stdio tests, one file per tool
      edges/                 # MCP-protocol edge-case tests
    git/                     # git-backed scenarios
    parity.test.ts           # one scenario across all adapters
  e2e/
    *.test.ts                # full user journeys
  perf/
    01-bulk-create.test.ts   # bulk task creation throughput (in-process)
    02-chain-traversal.test.ts # parent-chain walk on a 1k-node DAG (in-process)
    03-concurrent-create.test.ts # spawned CLI; serializes via state lock
  llm/
    README.md                # manual LLM runbook
    lib/                     # runner + verify helpers
    scenarios/               # one folder per scenario
    verify/                  # post-run checks
    results/                 # gitignored: per-run logs
  workspace/                 # per-test tmpdirs created here
    .gitkeep
    .gitignore               # ignores everything except .gitkeep
```

Test workspaces are created via `mkdtemp(repoRoot/tests/workspace/loctt-)`. They're visible (good for post-mortem on a failing test) but gitignored. A global `afterAll` sweeps any `loctt-*` older than test-start.

## How to run

```bash
npm run test                 # unit + thin integration (existing) + tools
npm run test:integration     # builds CLI/MCP, runs tests/integration
npm run test:e2e             # builds CLI/MCP, runs tests/e2e
npm run test:ui              # builds, runs the Playwright specs in tests/ui
npm run test:perf            # opt-in, runs tests/perf — does NOT rebuild
```

`pretest:integration`, `pretest:e2e` and `pretest:ui` run `npm run build` so the spawned CLI/MCP binaries are current.

**Never run two of these suites concurrently.** Each `pretest` hook runs
`tsc --build`, which empties and rewrites `dist/` — and `integration`,
`e2e`, `ui` and `perf` all spawn `apps/cli/dist/index.js`. A build started
by one suite while another is running replaces the binary mid-run, and the
second suite fails in scattered, unrelated-looking ways (~30 failures
across ~16 files, none reproducible in isolation). The failures are an
artifact of the race, not a defect. Run the suites one at a time.

**`test:perf` does not have a pretest hook by design.** `concurrent-create.test.ts` spawns the bundled CLI binary, so when iterating on CLI / MCP / core source you must `npm run build` first. The other perf tests use core APIs in-process and don't need the build.

For interactive sanity checks, [`tests/scripts/smoke.sh`](./scripts/smoke.sh) runs E2E journey #1 against the bundled binary directly — useful when you want pass/fail in <1 second without Vitest startup overhead.

### Watch mode

`apps/cli` and `apps/mcp` each have an `npm run dev` script that runs `tsup --watch`. Use it in a separate terminal so `dist/index.js` rebuilds on source change. Pairs naturally with `npm link --workspace apps/cli` for testing the global `loctt` binary.

---

## Testing layers

| Layer | What it tests | Tool | Where |
|---|---|---|---|
| Unit | Pure functions in `packages/core/` | Vitest | `packages/*/src/**/*.test.ts` |
| Core integration | Core mutations against a real tmpdir | Vitest + mkdtemp | `packages/core/src/**/*.test.ts` |
| Frontend integration (in-process) | CLI `main()` and MCP `executeTool()` called directly | Vitest | `apps/{cli,mcp}/src/*.test.ts` |
| Frontend integration (transport) | Real CLI binary via `execa`, real MCP server over stdio | Vitest + spawn | `tests/integration/{cli,mcp}/` |
| Parity | Same scenario through all adapters, assert `.loctt/` identical | Vitest + scenario DSL | `tests/integration/parity.test.ts` |
| E2E | Full user journeys end-to-end | Vitest + spawn | `tests/e2e/` |
| Stress / perf | Bulk tasks, concurrent writers, deep trees | Vitest, separate config | `tests/perf/` |

---

## Cleanup discipline (critical)

Every test must clean up its workspace even on failure, exception, or timeout. Half-cleaned workspaces leak disk and can leak processes (stray MCP servers holding stdio handles).

Rules for fixtures and tests:

- Use `afterEach` for tmpdir cleanup. Per-test, not per-suite.
- Cleanup runs `rm(root, { recursive: true, force: true })` wrapped in try/catch — never propagates.
- For spawned processes (CLI via `execa`, MCP server over stdio): register a cleanup that calls `child.kill('SIGTERM')`, waits up to 2s, then `SIGKILL`. Run this in `afterEach` even if the test body already stopped the process.
- Wrap scenario bodies in `try { ... } finally { await cleanup() }` inside the fixture helper. Vitest's `afterEach` is a safety net; the fixture owns its resources.
- Tests must not write outside their workspace. Use absolute paths rooted at the fixture's `root`. Never rely on `process.cwd()` at test level — fixtures set it, fixtures restore it.
- Snapshot `process.cwd()`, `process.env`, `process.argv` in fixture setup; restore in cleanup.
- Global `afterAll` sweeps `tests/workspace/loctt-*` older than test-start as belt-and-braces for kill -9 scenarios.

---

## Test matrix

### Frontends

Every operation has up to three frontends:

1. **CLI in-process** — `main()` called directly, `process.cwd` mocked. Fast, good for coverage.
2. **CLI spawned binary** — `execa('node', ['apps/cli/dist/index.js', ...args])`. Catches argv parsing, exit codes, stdout/stderr framing.
3. **MCP over stdio** — real JSON-RPC via `@modelcontextprotocol/sdk` client. Catches schema validation, transport errors.

### CLI ↔ MCP operation parity map

Loctt aims for full parity between the CLI and the MCP server: an LLM agent should be able to do anything a human user can, including bootstrapping trackers and managing git infrastructure. The only CLI commands without an MCP equivalent are server-lifecycle commands (which can't expose tools to start themselves) and `help`.

| Operation | CLI | MCP |
|---|---|---|
| Init | `init [--prefix <p>] [--no-docs]` | `init` (server's bound root only) |
| Tracker info | `info` | `info` |
| Doctor | `doctor` | `doctor` |
| List saved views | `views` | `list_views` |
| Show workflow config | `schema` | `get_workflow_config` |
| Create | `create <title> [--status --priority --type]` | `create_task` |
| Read one | `show <ref>` | `get_task` |
| List | `list [--query --view --limit --archived]` | `list_tasks` |
| Set field | `set <ref> <field> <value>` | `update_task` |
| Unset field | `unset <ref> <field>` | `unset_field` |
| Replace body | `body <ref> --set <text>` | `replace_task_body` |
| Append body | `body <ref> --append <text>` | `append_task_body` |
| Archive | `archive <ref>` | `archive_task` |
| Unarchive | `unarchive <ref>` | `unarchive_task` |
| Delete (soft) | `delete <ref>` | `delete_task` |
| Delete (hard) | `delete <ref> --hard` | `delete_task` with `hard: true, confirm: true` |
| Link | `link <ref> <rel> <target>` | `link_tasks` |
| Unlink | `unlink <ref> <rel> <target>` | `unlink_tasks` |
| History | `log <ref> [--limit]` | `get_task_history` |
| Attach | `attach <ref> <path> [--force]` | `attach_file` |
| Detach | `detach <ref> <name>` | `detach_file` |
| Git enable | `git enable` | `enable_git` |
| Git disable | `git disable` | `disable_git` |
| Git status | `git status` | `get_git_status` |
| Git publish | `git publish` | `publish_to_git` |
| Git sync | `git sync` | `sync_from_git` |
| Config get | `config get <key>` | `get_config_value` |
| Config set | `config set <key> <value>` | `set_config_value` |
| Config unset | `config unset <key>` | `unset_config_value` |
| Config list | `config list` | `list_config_values` |

**CLI-only (by definition):**
- `mcp` — starts the MCP server itself.
- `ui` — starts the web HTTP server and UI (foreground).
- `help` / `--help` / `-h` — usage text. MCP equivalent is `tools/list`.

The parity runner asserts byte-equal `.loctt/` state across surfaces for the operations that exist on both. The MCP-specific tool descriptions for higher-authority operations (`init`, `enable_git`, `publish_to_git`, `set_config_value`, `unset_config_value`) include intent guidance reminding the agent these are infrastructure changes, not routine task edits.

### Modes

Every applicable scenario runs in all three modes:

- **No-git** — `mkdtemp` + `loctt init`. Default.
- **Git-backed, no remote** — `git init` + `loctt init` + `loctt git enable`. Local `loctt` branch only.
- **Git-backed with fake remote** — same as above, plus a sibling `git init --bare` tmpdir added as `origin`. Tests push/fetch without any network.

---

## Edge cases

### Ref resolution
- Lookup by key, by ID (ULID), by old key from `key_history` after rekey
- Nonexistent ref → clean error, non-zero exit / MCP `isError`
- Archived ref behavior on `show`/`log`/`unarchive` vs `set`
- Ambiguous refs after prefix change

### Workflow / queries config
- Minimal workflow (1 status, no priorities, no types, no custom fields, no relationships)
- Non-default key prefix (`BUG-`, `FOO-`); prefix change after tasks exist
- Missing `queries.yaml` — `list` works, `list --view` errors cleanly
- Malformed `workflow.yaml` — YAML syntax error, missing required keys, duplicate status keys
- Status / priority / type / relationship value not in workflow — rejected at set-time
- Custom field set on task, then field removed from workflow — task readable, field shown as orphaned
- Enum custom field with value not in `values`
- Relationship with no `inverse` defined vs with `inverse_label`

### `loctt config`
- `config get <key>` before `git enable` returns the default (not an error)
- `config set <key>` before `git enable` errors: "git mode is not enabled; run 'loctt git enable' first"
- `config set git.enabled true` runs `enableGit`, validates git repo presence
- `config set git.enabled false` runs `disableGit`
- `config set git.auto_push notabool` lists accepted forms (`true/false/1/0/yes/no`)
- Boolean parsing case-insensitive: `TRUE`, `Yes`, `0` all accepted
- `config set <unknown.key>` lists valid keys
- `config unset git.remote` restores `DEFAULT_GIT_REMOTE`
- `config list` before `git enable` shows every key with its default
- `sync.yaml` written by older version (no `remote` / `auto_push` / `auto_fetch`) — migrate-on-read fills defaults

### Relationships
- Self-link rejected
- Cycle (A→B→C→A) rejected at link time
- Link to nonexistent target rejected
- Link with unknown relationship type rejected
- Inverse edge auto-created on target — verify both sides
- Delete a task that's a link target — dangling reference handling
- Archive parent with live children — children's parent ref, tree traversal

### Task body
- Empty body
- Very large body (1 MB+ markdown)
- Unicode / emoji
- Body containing `---` (frontmatter delimiter) must not corrupt re-parse
- Binary content / invalid UTF-8
- `replace_task_body` preserves frontmatter; consistent trailing newline
- `append_task_body` spacing

### Query
- Unparseable query → clean error, not a crash
- Empty result set → exit 0, empty output
- Operator mismatch (`status > high`)
- `text ~` with regex metacharacters
- `parent = T-999` where T-999 doesn't exist
- Saved view referencing a now-removed status value

### Concurrency / filesystem
- Two CLI invocations creating tasks simultaneously → unique keys, `state.yaml` consistent
- Reader sees old or new frontmatter, never partial
- SIGKILL during `set` → no half-written `task.md`
- Case-insensitive FS (macOS default) — key collision `T-1` vs `t-1`

### Git
- `git enable` when `.git` missing → clean error
- Publish before initial sync
- Remote `loctt` branch force-pushed since last sync
- Sparse worktree corruption / partial checkout
- Reconcile abort leaves no stale lock

**Push:**
- No remote configured + `auto_push=true` → publish skips push silently
- Remote configured but unreachable → warning on stderr, exit 0, local commit durable
- Auth required (e.g. SSH key missing) → friendly hint via `classifyAuthError`, no hang (GIT_TERMINAL_PROMPT=0)
- Non-fast-forward push (remote has newer commit) → warning, no rollback

**Fetch:**
- No remote + `auto_fetch=true` → sync skips fetch
- Remote unreachable → warning, falls back to local-only sync

**Custom names:**
- `config set git.branch my-tasks` → commits land on `my-tasks` ref locally and on remote
- `config set git.remote upstream` → push targets `upstream`

### Install / environment
- Node < 20 → clean error, not cryptic syntax error
- `.loctt/` owned by different user (permissions error)
- `.loctt/` is a symlink
- Run from subdirectory of project (walks up to find `.loctt/`?)
- CLI invoked with no `.loctt/` — every command except `init` errors cleanly
- MCP server started with no `.loctt/` — structured per-tool errors

### Output format
- `list --limit 0` — empty or error?
- `show` on task with null/missing fields — no crash
- `log --limit N` where N > history length
- Non-TTY stdout (pipes) — color codes stripped

---

## Build plan

Each step is shippable: tests pass, repo builds, no skipped cleanup.

### Step 0 — prep

- Confirm test root at `tests/` (not per-workspace).
- Add root dev deps: `execa`. (`@modelcontextprotocol/sdk` already in `apps/cli`.)
- Add root scripts: `test:integration`, `test:e2e`, `test:perf`, plus `pretest:integration` / `pretest:e2e` → `npm run build`.
- Create `tests/{scripts,integration,e2e,perf,workspace}` skeleton with `.gitkeep` files.
- `tests/workspace/.gitignore` ignores everything except `.gitkeep`.
- Root `vitest.config.ts` for `tests/integration/**/*.test.ts` etc.

**Exit:** `npm run test:integration` runs (zero tests, exits clean).

### Step 1 — tmpdir fixture with guaranteed cleanup

- `tests/integration/fixtures/tmp-loctt.ts` — `withTmpLoctt(fn)`:
  - creates `mkdtemp(repoRoot/tests/workspace/loctt-)`
  - snapshots `process.cwd`, `process.env`, `process.argv`
  - calls `fn(root)`
  - in `finally`, restores snapshots and `rm(root, { recursive: true, force: true })` wrapped in try/catch
- `tests/integration/fixtures/global-sweep.ts` — `afterAll` removes any `tests/workspace/loctt-*` older than test-start.
- Self-test: fixture creates a dir, throws inside `fn`, dir is still gone afterward.

**Exit:** fixture self-test passes; forced failure still cleans up.

### Step 2 — MCP stdio adapter + one tool

- `tests/integration/adapters/mcp-stdio.ts` — spawns `node apps/mcp/dist/index.js` rooted in `root`, wraps `@modelcontextprotocol/sdk` client, exposes `callTool(name, args)`. Registers process-kill cleanup (SIGTERM → 2s → SIGKILL).
- `tests/integration/mcp/create-task.test.ts` — init tmpdir, call `create_task`, assert `T-1` returned and `task.md` exists on disk.

**Exit:** real MCP server spawned, JSON-RPC round-trip works, no stray processes after run.

### Step 3 — CLI spawn adapter + one command

- `tests/integration/adapters/cli-spawn.ts` — wraps `execa('node', ['apps/cli/dist/index.js', ...args], { cwd: root })`. Returns `{ stdout, stderr, exitCode }`.
- `tests/integration/cli/create.test.ts` — init via fixture, spawn `create "hello"`, assert exit 0 and output contains `T-1`.

**Exit:** real CLI binary spawned, argv/exit code paths exercised.

### Step 4 — happy-path coverage for every command and tool

- One test per MCP tool (14 remaining) under `tests/integration/mcp/`.
- One test per CLI command under `tests/integration/cli/`. Include every top-level command from `apps/cli/src/index.ts`.
- Every test uses the tmpdir fixture. No state leaks.

**Exit:** every CLI command and MCP tool has at least one happy-path integration test.

### Step 5 — parity runner

- `tests/integration/adapters/cli-in-process.ts` — wraps existing in-process `main()` pattern.
- `tests/integration/scenarios/basic-lifecycle.ts` — scenario DSL: ordered ops (`create`, `setStatus`, `link`, `archive`, `log`). Returns a normalized snapshot of `.loctt/` (timestamps and ULIDs masked).
- `tests/integration/parity.test.ts` — runs the scenario through all three adapters, asserts snapshots equal.

**Exit:** one scenario produces byte-equal state via CLI-in-process, CLI-spawn, and MCP-stdio.

### Step 6 — edge cases

Pick the highest-value edges first. Each is ~1–3 tests under `tests/integration/{cli,mcp}/edges/`:

- Ref resolution: nonexistent ref, lookup by ID, lookup by old key after rekey
- Relationships: self-link rejected, cycle rejected, unknown type rejected, inverse auto-created
- Workflow config: malformed `workflow.yaml`, missing `queries.yaml`, value not in workflow
- `loctt config`: get-before-enable returns default, set-before-enable errors, bool parsing, unknown key, custom-handler routing for `git.enabled`, sync.yaml migration on read
- Body: empty, large, contains `---`, unicode
- Query: unparseable, empty result, invalid operator
- Delete: missing `--force` / missing `confirm: true`

**Exit:** all edge cases above have a test, or a written-down "skipped, see [reason]".

### Step 7 — git-backed (single machine, with optional fake remote)

- `tests/integration/fixtures/git-loctt.ts` — `git init`, sets `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env, runs `loctt git enable`. Cleanup removes the workspace.
- `tests/integration/fixtures/git-loctt-with-remote.ts` — adds a sibling `mkdtemp` containing `git init --bare`, registers it as `origin`. Cleanup removes both.
- `tests/integration/git/*.test.ts`:
  - **No-remote:** enable → create → publish → local `loctt` branch contains task files; sync round-trip; enable on non-git dir errors cleanly; abort mid-reconcile cleans `reconcile.yaml`
  - **With-remote:** default `auto_push=true` lands commit on bare repo; `auto_push=false` skips push; `auto_fetch=true` picks up out-of-band commits on bare repo; `auto_fetch=false` skips fetch; custom remote name (`upstream`) targets correct remote; custom branch name lands on correct ref; unreachable remote → warning + exit 0 + local commit intact; `GIT_TERMINAL_PROMPT=0` makes auth-required remote fail fast (5s test timeout)

**Exit:** git-backed single-machine path covered, both with and without a remote, including auto_push / auto_fetch toggles and failure modes.

### Step 8 — E2E journeys

Under `tests/e2e/`. Same fixtures, same cleanup. Each journey exercises a full user flow.

1. Init → create → set → link → archive → log → list-with-query (CLI only)
2. Init variants: default, `--prefix BUG-`, `--no-docs`, re-init refusal
3. CLI-only full lifecycle: create → show → set status → set priority → body → link → unlink → archive → unarchive → delete
4. MCP-only full lifecycle: same ops via MCP tools
5. CLI ↔ MCP interop: create via CLI, read via MCP; update via MCP, read via CLI
6. Query & saved view: seed 50 tasks, run every operator and one saved view
7. Git-backed, no remote: enable → create → publish → sync round-trip
8. Git-backed, with fake bare remote: enable → create → publish (auto-pushes) → mutate bare out-of-band → sync (auto-fetches)
9. `loctt config` journey: list defaults, enable git, list shows enabled, toggle `auto_push` off, publish doesn't push, set custom branch, publish lands on custom branch
10. Error-path journey: unknown command, bad query, missing `.loctt/`, bad ref, cycle attempt, double-delete on already-archived task without `--hard`, `config set` before `git enable`
11. MCP schema contract: fetch `tools/list`, snapshot and compare

**Exit:** all 11 E2E journeys pass locally.

### Step 9 — stress / perf (opt-in)

- `tests/perf/stress.test.ts`:
  - 1,000 task create — wall time, final `state.yaml` size, list-all latency
  - 100-task chain (A→B→C…) — traversal performance
  - 10 parallel CLI `create` processes — no key collisions, `state.yaml` not corrupted
- Not in default `npm test`. Run via `npm run test:perf`.

**Exit:** numbers measured and recorded; no correctness regressions.

### Step 10 — dev loop polish

- Add `npm run dev` in `apps/cli` and `apps/mcp` (`tsup --watch`).
- Add `tests/scripts/smoke.sh` mirroring E2E journey #1 for manual reproduction.
- Document the test layout in `docs/dev/development.md`.

**Exit:** a new dev can add a test without reading the fixture source.

---

## Step ordering

```
0 prep
1 fixture ── must exist before anything spawns
2 MCP one tool ─┐
3 CLI one cmd ──┴─ prove adapters
4 happy-path coverage
5 parity runner ── depends on 2, 3
6 edge cases ── can interleave with 5
7 git-backed ── independent of 6
8 E2E journeys ── depends on 4, 7
9 perf ── optional, independent
10 dev loop ── any time
```

Each step exits green: tests pass, repo builds, no skipped cleanup.

---

## Tooling

- **Vitest** for everything (unit, integration, E2E, perf — separate configs).
- **`execa`** for spawning the real CLI binary.
- **`@modelcontextprotocol/sdk`** client transport for driving the MCP server over stdio.
- **`mkdtemp`** rooted at `tests/workspace/`.
- No Docker, no network, no real git remote — bare repos in tmpdirs are enough.

## Flake control

- Every test uses its own `mkdtemp` workspace — no shared state.
- Spawn-based tests set explicit `PATH` and `cwd`, never rely on ambient env.
- MCP stdio tests set a hard timeout (5s per op) — hanging processes fail fast.
- Git fixtures set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` so commits are deterministic.
- `GIT_TERMINAL_PROMPT=0` is set by the CLI itself — verify in tests, don't rely on the harness setting it.

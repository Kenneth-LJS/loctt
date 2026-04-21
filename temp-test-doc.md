# LocTT Test Strategy — Working Notes

Scope: CLI (`@loctt/cli`) and MCP server (`@loctt/mcp`). Web app out of scope except where it touches shared data.

---

## 1. What's already tested

### Unit / core-library coverage (strong)

`packages/core/` has 30+ test files. These cover the domain logic the CLI and MCP both depend on:

- **Task lifecycle**: [create.test.ts](packages/core/src/task/create.test.ts), [update.test.ts](packages/core/src/task/update.test.ts), [lifecycle.test.ts](packages/core/src/task/lifecycle.test.ts), [io.test.ts](packages/core/src/task/io.test.ts), [frontmatter.test.ts](packages/core/src/task/frontmatter.test.ts)
- **Lookup & traversal**: [lookup.test.ts](packages/core/src/task/lookup.test.ts), [traversal.test.ts](packages/core/src/task/traversal.test.ts), [show.test.ts](packages/core/src/task/show.test.ts)
- **Relationships**: [relationships.test.ts](packages/core/src/task/relationships.test.ts)
- **History**: [history.test.ts](packages/core/src/task/history.test.ts), [history-instrumentation.test.ts](packages/core/src/task/history-instrumentation.test.ts)
- **Query engine**: [tokenizer.test.ts](packages/core/src/query/tokenizer.test.ts), [parser.test.ts](packages/core/src/query/parser.test.ts), [evaluator.test.ts](packages/core/src/query/evaluator.test.ts), [list.test.ts](packages/core/src/query/list.test.ts), [query.test.ts](packages/core/src/query/query.test.ts)
- **Config**: [workflow.test.ts](packages/core/src/config/workflow.test.ts), [queries.test.ts](packages/core/src/config/queries.test.ts), [validation.test.ts](packages/core/src/config/validation.test.ts)
- **State / keys**: [state.test.ts](packages/core/src/state/state.test.ts), [keys.test.ts](packages/core/src/state/keys.test.ts), [sync.test.ts](packages/core/src/state/sync.test.ts), [reconcile.test.ts](packages/core/src/state/reconcile.test.ts)
- **Git sync**: [git-mode.test.ts](packages/core/src/git/git-mode.test.ts), [publish-sync.test.ts](packages/core/src/git/publish-sync.test.ts), [reconcile.test.ts](packages/core/src/git/reconcile.test.ts)
- **Init / diagnostics**: [init.test.ts](packages/core/src/init/init.test.ts), [diagnostics.test.ts](packages/core/src/diagnostics/diagnostics.test.ts), [paths.test.ts](packages/core/src/paths/paths.test.ts), [scaffold.test.ts](packages/core/src/scaffold.test.ts)

### CLI integration coverage (thin)

[apps/cli/src/cli.test.ts](apps/cli/src/cli.test.ts) — **7 tests**, only smoke:
- `init`, `info`, `doctor`, `create "title"`, `list`, `help`, unknown-command exit code.

Not tested at the CLI layer: `show`, `set`, `unset`, `body`, `archive`, `unarchive`, `delete`, `link`, `unlink`, `log`, `mcp`, `web`. No flags (`--prefix`, `--status`, `--priority`, `--type`, `--query`, `--view`, `--limit`, `--force`). No error paths. No stdout format assertions beyond `toContain`. Runs by calling `main()` in-process with mocked `process.cwd` — doesn't exercise the actual binary or argv parsing under a real spawn.

### MCP integration coverage (thinner)

[apps/mcp/src/mcp.test.ts](apps/mcp/src/mcp.test.ts) — **4 tests**:
- `getTools()` exports, tool list contains expected names, `create_task`+`list_tasks` round-trip, unknown tool returns error.

Not tested: 13 of the 15 MCP tools. No stdio transport test — calls `executeTool()` directly in-process, which skips JSON-RPC framing, schema validation, and server wiring. No parity check against CLI.

### Web (out of scope here)

[apps/web/src/web.test.ts](apps/web/src/web.test.ts) and [server.test.ts](apps/web/src/server.test.ts) only verify exports exist.

### Summary

**Core logic**: well-covered. **CLI/MCP surfaces**: essentially uncovered beyond smoke. **Cross-interface parity**: not tested. **Real binary / real stdio transport**: not tested.

---

## 2. Integration test plan

### 2.1 Installation & dev loop

Three install modes users actually hit — each needs a test path:

| Mode | How | Test |
|---|---|---|
| Published npm global | `npm install -g @loctt/cli` | Smoke test against a published version in CI on release tag. Verify `loctt --version`, `loctt init`, basic create. |
| Local from source | `npm install && npm run build && npm link` | Covered implicitly by our dev workflow — add a CI job that runs exactly this sequence in a clean container and runs the smoke script. |
| npx (no install) | `npx @loctt/cli init` | Same smoke script, different invocation. |

**Live refresh / dev loop**: CLI and MCP are built with `tsup` (see [apps/cli/tsup.config.ts](apps/cli/tsup.config.ts), [apps/mcp/tsup.config.ts](apps/mcp/tsup.config.ts)). Current `npm run build` is one-shot. Options:

- **Add `tsup --watch`** scripts (`npm run dev` in each app) so editing `.ts` rebuilds `dist/index.js`. With `npm link` in place, the globally-linked `loctt` binary picks up changes automatically. No MCP/CLI restart hot-reload — MCP server has to be restarted by the client; CLI is invoked fresh per command so it's a non-issue.
- **Bug-fix flow**: edit → tsup rebuilds → re-run `loctt <cmd>` or restart the MCP client. Worth documenting in [docs/dev/development.md](docs/dev/development.md) if not already.
- No hot-reload for MCP tool schemas — the agent host caches them at startup.

### 2.2 How we test — the matrix

Build a **scenario runner** that executes a scripted sequence of operations against a throwaway `.loctt/` and asserts on filesystem state + output. Every scenario runs through **three frontends**:

1. **CLI in-process** (current style — fast, good for coverage)
2. **CLI spawned binary** (`execa dist/index.js …` — catches argv parsing, exit codes, stdout/stderr framing)
3. **MCP over stdio** (real JSON-RPC via `@modelcontextprotocol/sdk` client — catches schema validation, transport errors)

Each frontend runs the same logical scenario. If the resulting `.loctt/` differs, that's a parity bug.

#### CLI ↔ MCP operation parity map

| Operation | CLI | MCP |
|---|---|---|
| Create | `create <title> [--status --priority --type]` | `create_task` |
| Read one | `show <ref>` | `get_task` |
| List | `list [--query --view --limit]` | `list_tasks` |
| List views | *(none)* | `list_views` |
| Read config | *(via `info`)* | `get_config` |
| Set field | `set <ref> <field> <value>` | `update_task` |
| Unset field | `unset <ref> <field>` | `unset_field` |
| Replace body | `body <ref> --set <text>` | `replace_task_body` |
| Append body | *(none — CLI gap?)* | `append_task_body` |
| Archive | `archive <ref>` | `archive_task` |
| Unarchive | `unarchive <ref>` | `unarchive_task` |
| Delete | `delete <ref> --force` | `delete_task` (needs `confirm: true`) |
| Link | `link <ref> <rel> <target>` | `link_tasks` |
| Unlink | `unlink <ref> <rel> <target>` | `unlink_tasks` |
| History | `log <ref> [--limit]` | `task_history` |

Gaps to surface: CLI has no `append_body` equivalent; MCP has no `doctor`/`info`/`init` equivalent (by design — agents don't bootstrap). Parity tests should codify these known gaps.

#### Stress / scale tests

- **1,000 task create** — measure wall time, final `state.yaml` size, list-all latency.
- **100 tasks linked in a chain** (A→B→C…) — traversal and tree query performance.
- **Deep relationship tree** (10 levels deep, 10 children per node = 10B tasks — cap at 3 levels × 10 = 1,110) — `show` with children, list with `parent=` query.
- **Wide query** — `list --query "text ~ foo"` across 1k tasks.
- **Concurrent writers** — spawn 10 CLI processes each doing `create` simultaneously, verify no key collisions and `state.yaml` not corrupted.

These live in a separate `*.perf.test.ts` / `*.stress.test.ts` so they don't run on every PR — gated to a nightly CI job.

#### With / without git

Every integration scenario runs in both modes via a fixture flag:

- **No-git**: `mkdtemp` + `loctt init`. Default.
- **Git-backed (single machine only)**: `mkdtemp` + `git init` + `loctt init` + `loctt git enable`. Then scenario runs. Skip two-machine sync scenarios for now — too much harness for too little return at this stage.

Git-specific scenarios (single worktree):
- Enable → create → publish → inspect `.loctt` branch contents
- Publish → mutate → sync (no conflict path) → verify round-trip
- Abort mid-reconcile → verify `.loctt/local/reconcile.yaml` cleaned up
- Enable on non-git dir → verify clean error

---

## 3. Edge cases to worry about

### Ref resolution

- Lookup by `key` (current), by `id` (ULID), by old key from `key_history` after rekey
- Nonexistent ref → clear error, non-zero exit / MCP `isError`
- Archived ref → should resolve for `show`/`log`/`unarchive`, should it for `set`?
- Ambiguous (pathological — different prefixes sharing a number? e.g. `T-1` and `BUG-1` both exist after prefix change)

### Config edge cases

- Minimal workflow (1 status, no priorities, no types, no custom fields, no relationships)
- Non-default key prefix (`BUG-`, `FOO-`) — and prefix change after tasks exist
- Missing `queries.yaml` — `list` without query, `list --view` should error cleanly
- Malformed `workflow.yaml` — YAML syntax error, missing required keys, duplicate status `key`s
- Status/priority/type/relationship value not in workflow — rejected at set-time
- Custom field set on task, then field removed from workflow — task still readable, field shown as orphaned
- Enum custom field with value not in `values` list
- Relationship with no `inverse` defined vs with `inverse_label`

### Relationship edge cases

- Self-link (`link T-1 blocks T-1`) — rejected
- Cycle (A→B→C→A) — rejected at link time
- Link to nonexistent target — rejected
- Link with unknown relationship type — rejected
- Inverse edge auto-created on target — verify both sides
- Delete a task that's a link target — dangling reference behavior
- Archive parent with live children — children's parent ref, tree traversal

### Task body edge cases

- Empty body
- Very large body (1 MB+ markdown)
- Unicode / emoji
- Body containing `---` (frontmatter delimiter) — must not corrupt parse on re-read
- Binary content / invalid UTF-8 in body file
- `replace_task_body` preserves frontmatter; doesn't drop trailing newline inconsistently
- `append_task_body` spacing (does it add `\n`? double `\n`?)

### Query edge cases

- Unparseable query → clean error, not a crash
- Empty result set → exit 0, empty output (not "not found" error)
- Operator mismatch (`status > high` — non-ordered field with `>`)
- `text ~` with regex metacharacters
- `parent = T-999` where T-999 doesn't exist
- Saved view that references a now-removed status value

### Concurrency / filesystem

- Two CLI invocations creating tasks simultaneously → both get unique keys, `state.yaml` consistent
- One writes frontmatter while another reads → reader sees either old or new, never partial
- Kill mid-write (SIGKILL during `set`) → on next run, no half-written `task.md` (atomic write via rename?)
- `.loctt/` on NFS / case-insensitive FS (macOS default) — key collision `T-1` vs `t-1`

### Git edge cases

- `git enable` when `.git` missing
- Publish before initial sync
- Remote `.loctt` branch rewritten (force-pushed) since last sync
- Sparse worktree corruption / partial checkout
- Reconcile abort leaves no stale lock
- Rekey during reconcile appends to `key_history`, old key still resolves

### Install / environment edge cases

- Node < 20 → clean error message, not a cryptic syntax error
- `.loctt/` owned by different user (permissions error)
- `.loctt/` is a symlink
- Run from subdirectory of project (walks up to find `.loctt/`? or requires cwd?)
- CLI invoked with no `.loctt/` present — every command except `init` should error cleanly
- MCP server started with no `.loctt/` — does it return structured errors per tool, or fail startup?

### Output format edge cases

- CLI `list` with `--limit 0` — empty or error?
- `show` on task with null/missing fields — no crash, clean rendering
- `log --limit N` where N > history length
- Non-TTY stdout (pipes) — color codes stripped?

---

## 4. Automation in a test environment

### Tooling

- **Vitest** (already used) for unit + in-process integration.
- **`execa`** for spawning the real CLI binary from tests.
- **`@modelcontextprotocol/sdk`** client-side transport to drive the real MCP server over stdio.
- **`mkdtemp` + cleanup** fixture (pattern already in repo) for isolated `.loctt/` per test.
- **Git fixture helper**: wraps `git init` + optional second clone for sync scenarios.
- **Scenario DSL**: a tiny helper that takes a list of ops and a frontend adapter, returns final state. Lets one scenario run against CLI-in-process, CLI-spawn, and MCP-stdio without duplication.

### Structure

```
tests/
  integration/
    scenarios/          # shared scenarios: create-link-archive, query-matrix, etc.
    adapters/
      cli-in-process.ts
      cli-spawn.ts
      mcp-stdio.ts
    fixtures/
      tmp-loctt.ts      # mkdtemp + init + guaranteed cleanup
      git-loctt.ts      # + git init + enable + guaranteed cleanup
    parity.test.ts      # runs every scenario through every adapter, asserts equal end-state
    cli/*.test.ts       # CLI-only behaviors (output formatting, flags, exit codes)
    mcp/*.test.ts       # MCP-only behaviors (JSON-RPC, schema validation)
    git/*.test.ts       # git-backed scenarios (single-machine only)
  perf/
    stress.test.ts      # 1k tasks, concurrent writers
```

### Cleanup discipline (critical)

**Every test must clean up its tmpdir even on failure, exception, or timeout.** Half-cleaned tmpdirs leak disk and can leak processes (stray MCP servers holding stdio handles).

Rules for fixtures and tests:

- Use `afterEach` (not `afterAll`) for tmpdir cleanup — scoped per test so one failure doesn't strand state for the next.
- Cleanup runs with `{ recursive: true, force: true }` and never throws (catch and log, don't propagate).
- For spawned processes (CLI via `execa`, MCP server over stdio): register a cleanup that calls `child.kill('SIGTERM')`, waits up to 2s, then `SIGKILL`. Run this in `afterEach` even if the test body already stopped the process.
- Wrap scenario bodies in `try { ... } finally { await cleanup() }` inside the fixture helper — Vitest's `afterEach` is a safety net, but the fixture owns its resources.
- For git-backed tests: remove the tmpdir wholesale; don't try to clean individual `.git/` entries.
- Tests must not write outside their tmpdir. Use absolute paths rooted at the fixture's `root`. Never rely on `process.cwd()` at test level — fixtures set it, fixtures restore it.
- Snapshot `process.cwd()`, `process.env`, `process.argv` in fixture setup; restore in cleanup.
- A global `afterAll` sweeps the OS tmpdir for any `loctt-*` directories older than the test run start time and removes them — belt-and-braces for kill -9 scenarios.

### Local dev ergonomics

- `npm run test:watch` per-workspace (already present).
- Add `npm run test:integration` at repo root driving the integration suite.
- Add `npm run dev` in `apps/cli` and `apps/mcp` running `tsup --watch` so `npm link`-ed binary reflects edits live.
- Add a `scripts/smoke.sh` that runs the install-mode smoke sequence locally — the same script CI uses.

### Flake control

- Every test uses `mkdtemp` — no shared state.
- Spawn-based tests set explicit `PATH` and `cwd`, never rely on ambient env.
- MCP stdio tests set a hard timeout (5s per op) — hanging processes fail fast.
- Git fixtures set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` env so commits are deterministic.

---

## 5. Step-by-step build plan

Each step is a shippable unit — builds on the previous, leaves the repo green, and exits with a real working test. CI/CD deferred to a later pass.

### Step 0 — decide + prep (30 min)

- Confirm test root lives in `tests/` at repo root (not per-workspace) so integration tests can drive CLI + MCP together.
- Add dev deps at the root: `execa`, `@modelcontextprotocol/sdk` (already in cli deps, reuse). No new runtime deps.
- Add root scripts: `test:integration` (vitest on `tests/integration`), `test:e2e` (vitest on `tests/e2e`), `test:perf` (opt-in, vitest on `tests/perf`). None wired into `npm test` by default yet.

**Exit criteria:** `npm run test:integration` runs (zero tests, zero failures).

### Step 1 — tmpdir fixture with guaranteed cleanup

Build the foundation everything else depends on.

- `tests/integration/fixtures/tmp-loctt.ts` — exports `withTmpLoctt(fn)` that:
  - creates `mkdtemp` root
  - snapshots `process.cwd`, `process.env`, `process.argv`
  - calls `fn(root)`
  - in a `finally`, restores snapshots and `rm(root, { recursive: true, force: true })` wrapped in try/catch
- `tests/integration/fixtures/global-sweep.ts` — `afterAll` that removes any `${tmpdir}/loctt-*` older than test-start timestamp. Belt and braces.
- One self-test: fixture creates a dir, throws inside `fn`, dir is still gone.

**Exit criteria:** fixture self-test passes; forced failure still cleans up.

### Step 2 — MCP stdio adapter + one tool

Prove the hardest transport first.

- `tests/integration/adapters/mcp-stdio.ts` — spawns `node apps/mcp/dist/index.js` in a given `root`, wraps `@modelcontextprotocol/sdk` client, exposes `callTool(name, args)`. Registers process-kill cleanup (SIGTERM → 2s → SIGKILL).
- `tests/integration/mcp/create-task.test.ts` — one test: init tmpdir, call `create_task`, assert `T-1` returned and `task.md` exists on disk.

**Exit criteria:** real MCP server spawned, JSON-RPC round-trip works, no stray processes after run.

### Step 3 — CLI spawn adapter + one command

Mirror of step 2 for CLI.

- `tests/integration/adapters/cli-spawn.ts` — wraps `execa('node', ['apps/cli/dist/index.js', ...args], { cwd: root })`. Returns `{ stdout, stderr, exitCode }`.
- `tests/integration/cli/create.test.ts` — one test: init via fixture, spawn `create "hello"`, assert exit 0 and output contains `T-1`.

**Exit criteria:** real CLI binary spawned, argv/exit code paths exercised.

### Step 4 — happy-path coverage for every command and tool

Copy-paste from steps 2 and 3.

- One test per MCP tool (14 remaining) → `tests/integration/mcp/*.test.ts`.
- One test per CLI command → `tests/integration/cli/*.test.ts`. Include every top-level command from [apps/cli/src/index.ts](apps/cli/src/index.ts).
- Every test uses the tmpdir fixture. No test leaks state.

**Exit criteria:** every CLI command and MCP tool has at least one happy-path integration test.

### Step 5 — parity runner

Catches CLI/MCP drift. One scenario, three adapters.

- `tests/integration/adapters/cli-in-process.ts` — thin wrapper around existing in-process `main()` pattern from [apps/cli/src/cli.test.ts](apps/cli/src/cli.test.ts).
- `tests/integration/scenarios/basic-lifecycle.ts` — scenario DSL: ordered list of ops (`create`, `setStatus`, `link`, `archive`, `log`). Returns a snapshot of `.loctt/` (task files + state.yaml).
- `tests/integration/parity.test.ts` — runs the scenario through all three adapters, asserts final `.loctt/` snapshots equal (modulo timestamps/ULIDs — normalize those).

**Exit criteria:** one scenario demonstrably works via CLI-in-process, CLI-spawn, and MCP-stdio, producing byte-equal state.

### Step 6 — edge cases (§3 of this doc)

Pick the highest-value edges first. Each is ~1–3 tests.

- Ref resolution: nonexistent ref, lookup by ID, lookup by old key after rekey.
- Relationships: self-link rejected, cycle rejected, unknown type rejected, inverse auto-created.
- Config: malformed `workflow.yaml`, missing `queries.yaml`, value not in workflow.
- Body: empty, large, contains `---`, unicode.
- Query: unparseable, empty result, invalid operator.
- Delete: missing `--force` / missing `confirm: true`.

One file per domain under `tests/integration/{cli,mcp}/edges/`.

**Exit criteria:** all §3 edge cases from this doc have a test or a written-down "skipped, see [reason]".

### Step 7 — git-backed (single machine)

- `tests/integration/fixtures/git-loctt.ts` — like `tmp-loctt` but also runs `git init`, sets `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env, runs `loctt git enable`. Cleanup unchanged (just rm the tmpdir — .git goes with it).
- `tests/integration/git/*.test.ts` — four scenarios:
  - enable → create → publish → `.loctt` branch exists with task files
  - publish → mutate → sync round-trip (no conflict)
  - enable on non-git dir → clean error
  - abort mid-reconcile → `.loctt/local/reconcile.yaml` gone
- Skip two-machine scenarios (per decision).

**Exit criteria:** git-backed single-machine path covered; no two-machine harness.

### Step 8 — E2E journeys

Under `tests/e2e/`. Same fixtures (tmpdir, cleanup), but these exercise full user flows end-to-end, not isolated operations.

All E2E tests run in **OS tmpdir** (`os.tmpdir()` → `mkdtemp`). No network, no real git remote, no Docker — just a throwaway directory per test. Cleanup identical to integration fixtures.

Journeys (mapped from §2 layer 6):

1. Init → create → set → link → archive → log → list-with-query (CLI only)
2. Init variants: default, `--prefix BUG-`, `--no-docs`, re-init refusal
3. CLI-only full lifecycle: create → show → set status → set priority → body → link → unlink → archive → unarchive → delete
4. MCP-only full lifecycle: same ops via MCP tools
5. CLI ↔ MCP interop: create via CLI, read via MCP; update via MCP, read via CLI
6. Query & saved view: seed 50 tasks, run every operator and one saved view
7. Git-backed single machine: the single-worktree scenarios from step 7, end-to-end
8. Error-path journey: unknown command, bad query, missing `.loctt/`, bad ref, cycle attempt, delete without `--force`
9. MCP schema contract: fetch `tools/list`, snapshot and compare

**Exit criteria:** 9 E2E journeys pass locally. Each uses tmpdir fixture with guaranteed cleanup.

### Step 9 — stress/perf (opt-in)

- `tests/perf/stress.test.ts` — 1k task create, 100-task chain, concurrent writers (10 parallel CLI `create`).
- Not in default `npm test`. Run manually via `npm run test:perf`.

**Exit criteria:** numbers measured and recorded; no correctness regressions found.

### Step 10 — dev loop polish

- Add `npm run dev` in `apps/cli` and `apps/mcp` (`tsup --watch`).
- Add `scripts/smoke.sh` mirroring E2E journey #1 for manual reproduction.
- Document the test layout in [docs/dev/development.md](docs/dev/development.md): how to run, how to add a test, fixture contract.

**Exit criteria:** a new dev can add a test without reading the fixture source.

---

### Ordering summary

```
0 prep
1 fixture ── must exist before anything spawns
2 MCP one tool ─┐
3 CLI one cmd ──┴─ prove adapters
4 happy-path coverage (parallelizable work, but within one step)
5 parity runner ── depends on all 3 adapters
6 edge cases ── can interleave with 5
7 git-backed ── independent of 6
8 E2E journeys ── depends on 4, 7
9 perf ── optional, independent
10 dev loop ── any time
```

Each step is green-exit: tests pass, repo builds, no skipped cleanup.

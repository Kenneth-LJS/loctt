# Release readiness

What stands between the current tree and publishing LocTT. Scoped on
2026-09-11 against `chore/repo-sweep-cleanup`.

**Publish target: both** — a public GitHub source repo *and* installable
npm packages (`npx loctt`, the MCP server). Blockers are tagged by which
target they apply to.

This is the packaging / security / metadata axis. It is **separate from**:
- `TEMP-TODO.md` — deferred features and rulings (none are launch
  blockers by our own bar: a gap closes as case + test, and those are
  deferred features, not defects).
- The UI design review (consistency / tokens / a11y) — tracked
  separately; see `docs/dev/design-review.md` when it lands.

Each item says what's true now, what "done" looks like, and — where it
matters — the evidence it was checked against, so the next agent doesn't
re-derive it.

---

## The security model is the headline, and it's already good

The web server binds `127.0.0.1` only ([server.ts](../../apps/web/src/server/server.ts) —
`server.listen(port, "127.0.0.1", …)`) and sets **no**
`Access-Control-Allow-*` headers. LocTT is single-user, local-only **by
design**: there is no auth to harden because nothing is exposed on the
network and there is no multi-user model. The `dev:host` script only
adds `--host` to the **Vite dev client** (the dev inner loop); the API
server stays on loopback. The README already leans into this ("No
accounts or API keys… no OAuth dance").

The gap is **not code, it's documentation**: a reader cannot tell "no
auth" is a deliberate posture from "auth was forgotten." That silence is
how someone reverse-proxies it to `0.0.0.0`, assumes it's safe, and gets
burned. See B2 below.

The real robustness threat model is **malformed data on disk**, not
attackers — the store is user-editable YAML + markdown. That's the
corruption/degradation axis (H1), where the project already has real
investment (`doctor`, `corruption-handling-guide.md`, the known-gaps
roster).

---

## Blockers — fix before publishing

### B1. License + version metadata is inconsistent — **both targets**
- `LICENSE` is MIT (© 2026 Kenneth_LJS). But: root `package.json` has no
  `license` and no `version`; `packages/core`, `packages/contracts`,
  `apps/web` carry no `license`; only `apps/cli` and `apps/mcp` say MIT.
- **Done =** every published package declares `"license": "MIT"`; the
  root declares a version (or stays `private` with a version for tagging).
  Decide the version story (see B4).

### B2. Security posture is undocumented — **both targets**
- The loopback-only, no-auth model is correct but invisible.
- **Done =** a short README section (and/or `SECURITY.md`): single-user,
  local-only; server listens on loopback; no auth because nothing is
  exposed; explicit warning **not** to bind `0.0.0.0` / put it behind a
  reverse proxy expecting it to be safe; note that `dev:host` exposes
  only the dev client. Highest-value hardening item and it's prose.

### B3. `TEMP-TODO.md` sits in the published root — **both targets**
- A `TEMP-`prefixed file in a public root reads as "unfinished," and
  `CLAUDE.md` points at it as the live backlog.
- **Done =** move/rename it out of the public-facing root — e.g.
  `docs/dev/backlog.md`, or `.gitignore` it — and repoint `CLAUDE.md`.
  Keep the content; only the name/location is the problem.

### B4. Decide and apply the versioning / publish story — **npm target**
- Workspace versions are ad hoc: cli/mcp `0.1.0`, core/contracts/web
  `0.0.1`. `apps/web` is `private: true` with no `bin` — as-is it is
  **not** installable; the web UI ships *inside* the CLI or not at all.
- **Not a blocker that was feared:** the CLI and MCP **bundle**
  `@loctt/core` and `@loctt/contracts` (`noExternal` in their
  `tsup.config.ts`), so `core` being `private`/unpublished does **not**
  break `npx loctt`. Runtime deps are all real npm packages (yaml, ulid,
  sharp, busboy, proper-lockfile). Verified in both tsup configs.
- **Open decisions =** (a) is `@loctt/web` reachable when installed via
  npm — does the CLI serve the built client, and is `apps/web/dist`
  included in what ships? (b) unify versions and pick a scheme; (c) add
  `prepublishOnly`/`prepack` so a publish can't ship stale `dist`;
  (d) `.npmignore` or `files` so only `dist` + docs ship, not source/tests.
- **Done =** `npx loctt` and the MCP server install and run from a clean
  registry checkout, web UI included, on Node ≥ 20 (the declared engine).

---

## Hardening — should do; genuinely lowers risk

### H1. Corruption / degradation coverage audit
- The store is user-edited files; malformed input is the real threat.
  Assets exist: `apps/cli/src/commands/doctor.ts`,
  `docs/dev/corruption-handling-guide.md`, ~124 known-gaps sections.
- **Question to answer:** is coverage complete enough to trust a
  stranger's editor? Field-local degradation vs object-fatal, per the
  guide. Worth a focused audit (≈ an afternoon); not obviously a blocker.

### H2. Git-sync is the sharpest edge — mark experimental or verify
- Temp worktree + external `git` + conflict/lock handling. Optional
  feature. `apps/web/src/server/git-errors.test.ts` exists.
- **Done =** either confirm its failure modes hold and call it stable, or
  ship it labelled experimental in the docs. A defensible launch either way.

### H3. Community / repo hygiene files — **public-repo target**
- Missing: `CONTRIBUTING.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue/PR templates. None are hard blockers; a public
  repo reads as more finished with at least `SECURITY.md` (folds into B2)
  and a `CHANGELOG.md`.

---

## Consciously deferred — name in the roadmap, don't gate on

- The ~55 `TEMP-TODO` features/rulings. Deferred features, not defects.
- The 13 open rulings. Nice to clear; not required to ship.

---

## Quick status of what "done" looks like across the board

| Item | Target | Kind | State |
|---|---|---|---|
| B1 license/version metadata | both | metadata | not started |
| B2 document security model | both | docs | not started |
| B3 relocate TEMP-TODO | both | hygiene | not started |
| B4 versioning + npm publishability | npm | packaging | needs decisions |
| H1 corruption coverage audit | both | robustness | not started |
| H2 git-sync stability/labelling | both | robustness | partial (tests exist) |
| H3 community files | public repo | hygiene | not started |

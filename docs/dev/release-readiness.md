# Release readiness

What stands between the current tree and publishing LocTT. Scoped on
2026-09-11 against `chore/repo-sweep-cleanup`.

**Publish target: both** — a public GitHub source repo *and* installable
npm packages (`npx loctt`, the MCP server). Blockers are tagged by which
target they apply to.

This doc is the **packaging / security / metadata** axis (B1–B4). The
full pre-publish blocker set spans three docs — treat all three as the
release gate together:
- **`TEMP-TODO.md`** — the product/correctness/a11y backlog. Ken ruled
  (decisions.md **K73**) the **whole** list is required before publishing
  — it is not a "build later" queue. It holds silent correctness defects,
  a P1 data-loss, the BLK-44 robustness gap, the `unarchiveView` parity
  failure, and every WCAG AA failure (K74). The ~13 rulings in it are the
  critical path.
- **`docs/dev/design-review.md`** — UI adoption blockers; §A1 (dialog
  focus traps) is a ruled blocker (**K71**).
- this doc — packaging/security below.

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

### B4. Package each of CLI / MCP / UI as independently installable — **npm target**
**Intended model (Ken, 2026-09-11):** the three are installed
**separately** — `@loctt/cli`, `@loctt/mcp`, and the UI as their own
packages. They are not one bundle and the CLI does **not** serve the web
UI. They share the on-disk data model, so CLI/MCP can CRUD things
(labels, custom fields, milestones, relationships…) that only *render* in
the UI — that's expected, not drift. The code already anticipates this:
`apps/web/src/server/main.ts` is written as the `loctt serve` entry, uses
the shared `--root`/`LOCTT_ROOT` vocabulary "across CLI/ui/mcp/web," and
serves the built client from `dist/client/` via `--client-dir` in
production.

- **CLI + MCP: already installable.** Both **bundle** `@loctt/core` and
  `@loctt/contracts` (`noExternal` in their `tsup.config.ts`), so those
  being `private`/unpublished does **not** break `npx loctt` / the MCP
  server. Runtime deps are all real npm packages (yaml, ulid, sharp,
  busboy, proper-lockfile). Verified in both tsup configs.
- **UI: NOT installable yet — the real B4 work.**
  - `apps/web` is `private: true` with **no `bin`** — nothing launches it
    from an install. It needs a `bin` (the `loctt serve` / `loctt-ui`
    entry over `main.ts`) that starts the loopback server and opens the
    browser.
  - **The server is never built.** `apps/web` declares
    `"main": "dist/server/index.js"`, but `build` is just `vite build`,
    which only emits `dist/client` (`vite.config.ts:23`
    `outDir: "dist/client"`). There is **no** step that compiles the
    server to `dist/server`. So a published `@loctt/web` would ship a
    client with no server to serve it. Add a server build (tsc or a
    second bundler pass) that also bundles/handles `@loctt/core` the way
    CLI/MCP do — or publish `core`.
- **Also for all three:** (a) unify versions (cli/mcp `0.1.0`,
  core/contracts/web `0.0.1`) and pick a scheme; (b) `prepublishOnly`/
  `prepack` so no publish ships stale `dist`; (c) `files`/`.npmignore` so
  only `dist` + docs ship, not source/tests.
- **Done =** each of the three installs and runs from a clean registry
  checkout on Node ≥ 20 — `npx @loctt/cli`, the MCP server, and the UI
  (server + client) launching on loopback — independently.

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

## Nothing in TEMP-TODO is consciously deferred any more

Superseded by Ken's ruling **K73 (2026-09-11)**: the whole `TEMP-TODO.md`
backlog is pre-publish. What was framed here as "deferred features" is now
required. The features are still each their own build (see TEMP-TODO §7),
but they are in-scope for launch, not a post-launch roadmap. The rulings
(TEMP-TODO §0) gate the rest and come first.

---

## Quick status of what "done" looks like across the board

| Item | Target | Kind | State |
|---|---|---|---|
| B1 license/version metadata | both | metadata | DONE |
| B2 document security model | both | docs | DONE |
| B3 relocate TEMP-TODO | both | hygiene | DONE (moved to docs/dev/, 2026-09-18) |
| B4 web packaging | npm | packaging | DONE (A-B4/K89) |
| H1 corruption coverage audit | both | robustness | not started |
| H2 git-sync stability/labelling | both | robustness | DONE — STABLE (2026-09-18): full engine built to K92-K95, all data-safety paths guarded + tested (incl. real-remote integration); shipped unlabeled. The one untestable edge (advisory locks on network/sync filesystems) is detected + warned in-app (GIT-22/XS-50) and documented in docs/user/common/git-sync.md. Ken's call. |
| H3 community files | public repo | hygiene | not started |

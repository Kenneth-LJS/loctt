# Release readiness

What stands between the current tree and publishing LocTT. Scoped on
2026-09-11 against `chore/repo-sweep-cleanup`.

**Publish target: both** — a public GitHub source repo *and* one
installable npm package, `loctt` (CLI, `loctt ui`, `loctt mcp`; K139). Blockers are tagged by which
target they apply to.

This doc is the **packaging / security / metadata** axis (B1–B4). The
pre-publish blocker set spans two docs — treat both as the release gate
together:
- **`docs/dev/design/design-review.md`** — UI adoption blockers; §A1 (dialog
  focus traps) is a ruled blocker (**K71**).
- this doc — packaging/security below.

(The product/correctness/a11y backlog is closed. Understood-but-unfixed
defects live in `docs/dev/known-gaps.md`.)

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

Beyond loopback-only binding and no CORS headers, later hardening also
guards against a subtler network trick: the DNS-rebinding **Host guard**
(a foreign `Host` header is refused; `server.host-guard.test.ts`) and a
**Content-Security-Policy** (A206/A207; `server.csp.test.ts`). Neither is
mentioned in README or SECURITY.md yet — the posture is stronger than
either document currently says.

---

## Blockers — fix before publishing

### B1. License + version metadata is inconsistent — **both targets**
- `LICENSE` is MIT (© 2026 Kenneth_LJS). But: root `package.json` has no
  `license` and no `version`; `packages/core`, `packages/contracts`,
  `apps/web` carry no `license`; only `apps/cli` and `apps/mcp` say MIT.
- **Done =** every published package declares `"license": "MIT"`; the
  root declares a version (or stays `private` with a version for tagging).
  Decide the version story (see B4).
- **Version story (K139):** one published package, `loctt`, so one
  version. The root and every app workspace carry the same version
  (`0.1.0` today) and the same `engines.node`, and the manifest check
  (ONB-C9) enforces it. `packages/core` and `packages/contracts` are
  private, bundled into `loctt`, and keep their own internal `0.0.1`.

### B2. Security posture is undocumented — **both targets**
- The loopback-only, no-auth model is correct but invisible.
- **Done =** a short README section (and/or `SECURITY.md`): single-user,
  local-only; server listens on loopback; no auth because nothing is
  exposed; explicit warning **not** to bind `0.0.0.0` / put it behind a
  reverse proxy expecting it to be safe; note that `dev:host` exposes
  only the dev client. Highest-value hardening item and it's prose.

### B4. One package, `loctt` (K139) — **npm target** — **RESOLVED (B34, B38; A352, A355)**

**Now:** one published package, **`loctt`** (`apps/cli`), provides the
`loctt` command with `loctt ui` (the web client ships inside it) and
`loctt mcp` (the MCP server, bundled in). Core, contracts, the web
server and the MCP server are bundled from source (tsup `noExternal`);
the runtime dependencies it loads are declared in its `dependencies`.
`@loctt/mcp` and `@loctt/web` are `private` internal workspaces; there
is no `loctt-mcp` or `loctt-ui` command. One install means one core
version for all three surfaces, which is Ken's reason (K139: *"lets
combine into one surface for loctt"*). `npm run test:packaging` packs
`loctt`, installs it outside the repo with only its declared
dependencies, runs `--version`, `init`/`create`, `loctt ui` and
`loctt mcp`, and checks the schema-too-new refusal (ONB-C8); the
manifest check (ONB-C9) covers `loctt` and fails if any other workspace
is publishable.

The already-published `@loctt/cli` 0.1.0 and `@loctt/mcp` 0.1.0 are
Ken's to unpublish or deprecate (K139).

**History.** K89 (2026-09-11) ruled three separately installable
packages. The 2026-09-27 audit (K136) found none of them worked from an
install (no client in the CLI, `@loctt/web` missing runtime
dependencies, `@loctt/mcp` with no `bin`); B34/A352 fixed all three and
added the packaging suite. K139 then superseded K89: one package.

---

## Hardening — should do; genuinely lowers risk

### H1. Corruption / degradation coverage audit — **CLOSED, light pass (K136)**
- The store is user-edited files; malformed input is the real threat.
  Assets exist: `apps/cli/src/commands/doctor.ts`,
  `docs/dev/reference/corruption-handling-guide.md`.
- **Status correction:** the "~124 known-gaps sections" figure is stale.
  `known-gaps.md` currently says nothing is open (K117 retired the
  "deferred" concept — open items move to the backlog instead).
- **Question to answer:** is coverage complete enough to trust a
  stranger's editor? Field-local degradation vs object-fatal, per the
  guide. Worth a focused audit (≈ an afternoon); not obviously a blocker.
- **Closed 2026-09-27 (K136), light pass per Ken ("review everything
  lightly, we already done one round of it"):** walked the guide's
  per-thing checklists against this month's additions
  (`keyboard_shortcuts`, `sidebar_groups`/`filters`, the body-draft
  `sessionStorage` store, unique saved-view names). All four already
  degrade correctly; the one real gap found — `keyboard_shortcuts`
  salvage had no test at the doctor/integrity layer, only at the unit
  layer — is fixed with two new `integrity.test.ts` cases. See the
  coverage table added to `corruption-handling-guide.md` § 6.

### H2. Git-sync is the sharpest edge — mark experimental or verify — **CLOSED (K136)**
- Temp worktree + external `git` + conflict/lock handling. Optional
  feature. `apps/web/src/server/git-errors.test.ts` exists.
- **Done =** either confirm its failure modes hold and call it stable, or
  ship it labelled experimental in the docs. A defensible launch either way.
- **Closed 2026-09-27 (K136):** Ken's ruling that git-sync ships stable,
  unlabeled, is recorded in `decisions.md` § 9. See the "Quick status"
  row below for the ruling text.

### H3. Community / repo hygiene files — **public-repo target** — **CLOSED (K136)**
- **Status correction:** this said "not started" but `SECURITY.md`
  (2026-09-11) and `CHANGELOG.md` (2026-09-19) already existed.
- **Closed 2026-09-27 (K136):** `CONTRIBUTING.md` (build/test/case+
  `@verifies` rule/commit rules) added. A `CODE_OF_CONDUCT.md` was added
  and then removed by Ken (K138): *"just take out code of conduct then"*.
  `.github/ISSUE_TEMPLATE/` added (bug report, feature request).
  `CHANGELOG.md` brought up to date through K136 (waves 3–4, in
  user-facing terms). No PR template was requested and none was added.

---

## Quick status of what "done" looks like across the board

| Item | Target | Kind | State |
|---|---|---|---|
| B1 license/version metadata | both | metadata | DONE |
| B2 document security model | both | docs | DONE |
| B4 packaging | npm | packaging | **RESOLVED: one package, K139 (B38, A355).** `loctt` provides `loctt`, `loctt ui` and `loctt mcp` with core bundled; `@loctt/mcp` and `@loctt/web` are private workspaces; `npm run test:packaging` packs and installs `loctt` outside the repo (ONB-C8/C9). Unpublishing the old `@loctt/cli`/`@loctt/mcp` is Ken's. |
| H1 corruption coverage audit | both | robustness | DONE — light pass (K136, 2026-09-27). See H1 above. |
| H2 git-sync stability/labelling | both | robustness | DONE — STABLE (2026-09-18): full engine built to K92-K95, all data-safety paths guarded + tested (incl. real-remote integration); shipped unlabeled. The one untestable edge (advisory locks on network/sync filesystems) is detected + warned in-app (GIT-22/XS-50) and documented in docs/user/common/git-sync.md. Ken's call, recorded in decisions.md § 9 (K136). |
| H3 community files | public repo | hygiene | DONE (K136, 2026-09-27). CONTRIBUTING.md and issue templates added (no CODE_OF_CONDUCT.md, K138); CHANGELOG.md refreshed through K136. |

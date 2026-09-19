# LocTT Publish-Hardening Plan

**Status:** living document · **Started:** 2026-09-19 · **Owner:** pre-publish gate

This is the plan for hardening LocTT to publish, and the general framework
it instantiates. It is the durable companion to `known-gaps.md` (findings)
and `decisions.md` (rulings). Publishing itself — `npm publish`, pushing a
release tag, making the repo public — is **reserved to Ken** and is not
part of any agent's mandate.

---

## The general framework (any project)

Publish-hardening is **seven domains**. For each: what AI can do
unattended, and what stays human.

| # | Domain | What it checks | AI | Human |
|---|--------|----------------|----|-------|
| 1 | **Correctness gates** | typecheck, lint, unit + integration + e2e, acceptance-case coverage by tests that fail when behaviour breaks | fully | set the bar |
| 2 | **Agent-surface hardening** | (tools an AI drives) path/resource confinement, confirm gates on destructive/outbound ops, input validation into shell/git/SQL/paths, best-effort atomicity | mostly — needs *adversarial* review | confirm threat model |
| 3 | **Data integrity / robustness** | malformed input, partial writes, concurrency, version skew; degrade-don't-crash, never silently corrupt | fully | — |
| 4 | **Supply-chain / packaging** | ship-list audit, dep vuln + license audit, secret scan of full git history, metadata correctness, lockfile | audit fully | the publish itself |
| 5 | **Docs & legal** | LICENSE, README, SECURITY.md, CHANGELOG, (public) CONTRIBUTING/COC/templates | fully | — |
| 6 | **Privacy / outbound behaviour** | trace every network call; nothing leaves without opt-in; no telemetry/update-check surprises | mostly | — |
| 7 | **UI hardening** | untrusted-content rendering (XSS), input robustness, a11y (WCAG AA), state/concurrency, client-side security hygiene | fully (audit + tests) | set a11y bar |

### The repeatable "step-away" loop
1. **Audit** each domain → severity-ranked findings.
2. **Adversarial re-review** by a *fresh* agent that did not write the code —
   its job is to break claims, not confirm them.
3. **Fix**, and for every fix **red-prove the test**: break the behaviour,
   watch the test go red, restore.
4. **Gate** — full suite green before merge.
5. **Merge** per-PR.
6. **Stop at the publish boundary** — the one irreversible outbound step
   stays human.

Load-bearing disciplines: decisions get **recorded** (survive compaction);
found-defects reported as prominently as fixed ones; "decided" is never
reported as "done".

---

## LocTT status by domain

| Domain | Status | Evidence |
|--------|--------|----------|
| 1 Correctness | ✅ green | typecheck/lint 0; unit ~4000 across workspaces; integration; 1 known flaky timing test (`diagnostics.test.ts`, passes in isolation) |
| 2 Agent-surface | ✅ merged | F1–F4 (attach confinement, backup/restore confirm, git-ref validation) — PR #3 `eba698f`, decisions A205 |
| 3 Data integrity | ✅ audited | H1 corruption audit clean; P-11 degrade-don't-crash framework |
| 4 Supply-chain | ✅ fixed | SC1–SC4 — decisions A206; `npm audit --omit=dev` = 0; LICENSE/README ship; deps bumped |
| 5 Docs & legal | ◑ mostly | LICENSE + README + SECURITY.md + CHANGELOG present; per-package LICENSE/README added. Optional if public: CONTRIBUTING/COC/issue templates (H3) |
| 6 Privacy/outbound | ✅ verified | 127.0.0.1-bind only; all fetches local `/api`; no telemetry/update-check/phone-home; secret-history scan clean |
| 7 UI hardening | ✅ fixed | markdown XSS safe by construction; CSP/framing/nosniff added (UI1, A206); UI2–UI5 accepted/ruled/narrow |

---

## The specific findings + fixes (this hardening pass)

Full detail in `known-gaps.md` (2026-09-19 sections) and `decisions.md`
A205 / A206. Summary:

### Agent-surface (merged, PR #3)
- **F1** attach_file read any absolute path → confined to tracker root (MCP only).
- **F2** backup/restore path escape → import/export boundary kept, confirm gate added.
- **F3** non-dry-run restore had no confirm → gated.
- **F4** git.branch/remote unvalidated → validated.

### Supply-chain (branch fix/publish-hardening, A206)
- **SC1** `sharp ^0.35.3→^0.35.4` (cli+mcp) — libheif HIGH (GHSA-rgj7-g3m4-5g8c).
- **SC2** `@tiptap/* ^3.30.1→^3.31.3` (web) — ReDoS (GHSA-j95f-988m-3j2f) +
  `__proto__`→DOM-attr (GHSA-cp6q-959q-f8rh); both on the agent-authored-markdown path.
- **SC3** web `@loctt/*` deps `"*"` → devDependencies (were bundled but declared
  runtime → `npm install @loctt/web` failed). Exposed + fixed a latent missing
  `@tiptap/extension-link` direct dep.
- **SC4** per-package LICENSE + README for cli/mcp/web.
- **DEV-TREE** remaining audit hits are all dev toolchain (vite/vitest/esbuild),
  never shipped; deliberately not chased. Re-audit `--omit=dev` each release.

### UI hardening (branch fix/publish-hardening, A206)
- **Markdown XSS — NOT exploitable.** React-element render (no HTML sink),
  `isSafeHref` scheme allowlist, mutation-tested. Structural neutralisation.
- **UI1** no CSP → added serve-time CSP (hash-pinned inline theme script) +
  `X-Frame-Options: DENY` + `nosniff` + `Referrer-Policy`. Verified end-to-end.
- **UI2** external-image-on-view IP leak — accepted (Ken A180); proxy is future work.
- **UI3** inline SVG serve — safe (nosniff + `<img>`-only); no action.
- **UI4** enum field edits are last-write-wins across tabs — accepted for
  single-user; body writes ARE token-guarded (409 + conflict dialog).
- **UI5** input robustness sound (per-region error boundaries; parser anti-hang);
  residual: no size cap on render path (jank, not crash).

---

## Verification fan-out (2026-09-19)

Independent agents were fanned out to adversarially TEST — not re-audit —
each hardened aspect, to catch anything the implementer or first reviewer
missed. Test dimensions:

1. **CSP / security headers** — try to bypass the CSP; confirm the hash
   tracks the real theme script; confirm assets aren't over-restricted;
   confirm the app renders + editor mounts under the policy.
2. **Markdown / content XSS** — craft agent-authored payloads
   (`<script>`, `<img onerror>`, `javascript:`/`data:` hrefs, mixed-case,
   encoded, nested) and prove none executes; check titles/labels/attachment
   names as sinks.
3. **Agent-surface path escape (F1–F4)** — attempt to escape confinement
   (symlinks, `..`, absolute, intermediate-symlink), bypass confirm gates,
   inject git refs.
4. **Supply-chain** — verify `npm pack` ships nothing sensitive; every
   published package installs and resolves; prod audit clean; LICENSE/README
   present; no secret in history.
5. **Outbound / privacy** — prove nothing leaves 127.0.0.1 without opt-in;
   no telemetry path reachable.

Findings from the fan-out are recorded in `known-gaps.md`; anything
must-fix is fixed + red-proven on the branch before merge.

### Completeness-critic pass (2026-09-19)

A sixth agent reviewed the five testers' reports for what they did NOT
exercise. The fan-out's five dimensions each stayed inside their own
frame and left the seams between them untested. Highest-value gaps
(full detail in `known-gaps.md`):

1. **SVG attachment inline-serve is a real stored-XSS vector, and the
   UI3/A199 `nosniff` rationale is factually wrong.** `nosniff` does not
   stop a navigated `image/svg+xml` document from executing its scripts;
   the inline serve path carries no CSP; attachments (unlike avatars) do
   not reject SVG. Reachable via the MCP `attach_file` surface. The XSS
   tester scoped attachments out; the CSP tester never navigated to one.
   **must-fix candidate** — needs Ken's call on the fix shape (reject on
   serve / reject on upload / `sandbox` CSP on the endpoint).
2. **No Host/Origin validation → DNS-rebinding read exfiltration.** The
   privacy tester proved loopback *bind*, which does not defeat rebinding.
   GET is exempt from the CSRF header, so a rebound public page can read
   the whole tracker over `/api/*` GETs. **should-fix** — a Host
   allowlist is a few lines.
3. **The HTTP upload path (`multipart.ts`) was not adversarially tested**
   — the F1–F4 tester drove core `attachFile` directly, not the multipart
   route (`basename("..")` → `".."`, backslash names on POSIX). Redundant
   with core's guard today (existing gap "multipart.ts's basename guard is
   inert"), but the route itself is untested against malformed multipart.
4. **CSP has no `form-action`** (only `base-uri 'none'`); worth a probe of
   whether an injected form could POST to a foreign origin under the
   current policy.
5. **Cross-tester contradiction to reconcile:** the CSP tester rates the
   `img-src` blob: omission (broken avatars) **should-fix** and the
   packaging tester rates the broken `@loctt/mcp` tarball + `npm install`
   404 **must-fix** — both are functional breakage a first-run user hits
   before any security question, and neither is yet reflected in the
   status table above (which still shows domains 4 and 7 as ✅). The table
   should not read green while a published package fails to install.

The packaging tester's two **must-fix** breakages (MCP chunk-split
tarball; cli/web `@loctt/*` devDep 404 on install) are the items a
first-time installer hits first and were independently the most severe of
the whole fan-out; they gate publish regardless of the security items.

---

## UI/UX review checklist (distilled from Ken's catches, 2026-09-20)

Automated review + gates passed while these shipped; **Ken caught them by eye.**
Codified here so a UI-review pass (human or agent) runs them every time — these
are the classes of defect our tests and lint do NOT catch. Run against the
LIVE app in BOTH light and dark, desktop and mobile.

**Layout stability**
- [ ] No content SHIFT on state change. Selecting a row, focusing a field,
      hovering — anything that adds a border/bar/badge must RESERVE that space
      when absent (transparent border, not `border: none` → `border: Npx`).
      (Caught: list row shifted a few px sideways when its select-marker
      border appeared.)
- [ ] Entering an edit mode / expanding a toolbar must not shift the text
      under the cursor (reserve toolbar height; align edit and read states).

**Focus & rings**
- [ ] ONE focus indicator per control. A per-input `focus:border-accent` stacked
      under the global `:focus-visible` outline = a double ring. Inputs rely on
      the single global ring (the `TextField` standard); don't add a second.

**Typography**
- [ ] Monospace ONLY for code blocks and CLI commands (K98). Not for task
      keys/IDs/slugs, paths, config keys in prose, query text, confirm words,
      hex — and remember a bare `<code>` renders mono via the UA default, so
      the base reset must neutralise it.
- [ ] Read-state text is flush-left aligned with its section label — a hover-
      box `px-*` inset must be cancelled (`-mx-*`) so at-rest text isn't
      indented.

**Colour (needs a live human eyeball — contrast math alone is not enough)**
- [ ] On-accent text colour is contrast-correct: white on a dark accent, black
      on a bright one — pick per the fill, don't default to white.
- [ ] Dark-mode accents aren't dull; bright accents aren't harsh; a "vibrant"
      colour on a light bg may be unreachable at AA-normal (document AA-Large
      exceptions, K99). Verify semantic colours are HARMONISED to the scheme,
      not independently tuned, and "done"-green stays distinct from a teal
      brand accent.

**Component consistency (the root cause of most of the above)**
- [ ] Two surfaces that do the same job use the SAME component, not two
      divergent copies. (Caught: description vs comment editor had forked
      toolbars. Fix = extract one shared component, config via props.)
- [ ] Value pickers over a growable set use the searchable `Combobox`, never a
      native `<select>` or a checkbox wall (they don't scale).
- [ ] Affordances are SVG `<Icon>` with tooltips, not text-label pills or
      ASCII/emoji. Toolbars work on mobile (overflow menu, not wrap).
- [ ] Prefer the `ui/` primitives over raw `<button>`/`<input>`/dialog markup
      (component-library adoption — see design-review.md).

**Scale & scoping (ask these of every list/board/timeline view)**
- [ ] Does it scope to the selected project consistently with the other views?
- [ ] Can the user filter it (reuse the shared filter system, don't fork)?
- [ ] Can the user group by the fields that matter (not a hard-coded one)?
- [ ] Does an unbounded set (facets as custom fields grow; unscheduled tasks;
      long option lists) degrade gracefully, or does it dominate/overflow?

**Docs (open-source hygiene)**
- [ ] Reference/user docs read present-tense "what it IS" — no history
      narration ("originally / v1 did X / previously"), no stale claims, no
      internal ticket keys meaningless to an outsider. Verify claims against
      code. (decisions.md/known-gaps.md are the exception — they're logs.)

## Remaining before publish (Ken's call)
- Merge `fix/publish-hardening` (agent may, per standing authorisation).
- Optional if going public: H3 CONTRIBUTING.md / CODE_OF_CONDUCT.md / issue
  templates.
- **PUBLISH** — Ken only. Not an agent action under any circumstances.

# Contributing to LocTT

Thanks for taking a look. LocTT is a small, opinionated project; this
doc covers the mechanics of building, testing, and submitting a change.
For *why* things are built the way they are, see `docs/dev/` — start
with `docs/dev/reference/architecture.md` and
`docs/dev/reference/invariants.md` before touching data-model or
key-allocation code.

## Getting set up

```bash
npm install
npm run build        # builds every workspace (tsc + tsup for CLI/MCP)
```

The repo is an npm-workspaces monorepo:

- `packages/contracts` — shared types and API shapes
- `packages/core` — shared LocTT logic (loaders, writers, diagnostics)
- `apps/cli` — the CLI
- `apps/mcp` — the MCP server
- `apps/web` — the web app (HTTP server + API + UI)

## Running the checks

```bash
npm run typecheck         # type-check all workspaces
npm run lint               # eslint across all workspaces
npm run test                # unit tests (vitest) — fast, no e2e
npm run test:integration    # CLI binary + MCP stdio against a real tracker
npm run test:e2e            # full user-journey e2e specs
```

Run `npm run lint:fix` for auto-fixable lint issues. A PR should pass
`typecheck`, `lint` (no new warnings), and `test` at minimum;
`test:integration` and `test:e2e` are expected for anything touching the
CLI, MCP, or web UI end to end.

## The case + `@verifies` rule

LocTT's acceptance criteria live as plain-language cases in
`tests/cases/ui-test-cases/` (web UI) and `tests/cases/surface-test-cases/`
(CLI/MCP), one file per flow, indexed in `tests/cases/case-index.json`.
These are not test scripts — they describe observable behaviour so they
survive the implementation changing underneath them.

**A behaviour is not "done" until:**

1. The code does it.
2. A case describes it (in the relevant `flow-*.md`, with a stable id
   like `TSK-12` or `A11Y-14`).
3. A test carries a `@verifies <CASE-ID>` comment/tag proving it.
4. If you're recording a project decision, it's written to
   `docs/dev/decisions.md` (see that file's format) — contributors from
   outside the core team should flag notable decisions in their PR
   description instead of editing that file directly.

**A new test must be shown to fail.** Before you consider a test done,
break the behaviour it covers on purpose, watch the test go red, then
restore the behaviour. A test that still passes with the behaviour
deleted isn't testing anything.

**If you're extending code someone else already tested, mutate their
tests too.** Adding a case that a component's existing test suite no
longer actually exercises is a common way for coverage to silently rot
— check by temporarily reverting your change and confirming the old
tests fail.

## Commit messages

- Write commits as if a human wrote them: no "Co-Authored-By" lines, no
  AI/bot attribution, no signatures.
- Prefer a short summary line explaining *why* the change was made, not
  just what changed.
- Keep unrelated changes in separate commits.

## Code style

- TypeScript, strict types everywhere; avoid `any` (and comment why, on
  the rare occasion it's unavoidable).
- Named exports over default exports.
- No dead code — delete it rather than comment it out.
- Comments explain *why*, not *what*.

## Before you start something big

For anything beyond a small fix, it's worth opening an issue first to
confirm the direction — especially anything that touches the data model,
key allocation, or sprint state (see
`docs/dev/reference/invariants.md` for what a change must not break).

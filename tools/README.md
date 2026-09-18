# Case index and coverage tooling

Turns the prose acceptance criteria in `docs/dev/ui-test-cases/` and
`docs/dev/surface-test-cases/` into something a script can check, so
"this ticket is done" is a command that exits non-zero rather than a
judgement call.

## Why

The flow docs are the specification. Prose is right for humans reasoning
about behaviour, but an agent re-reading 931 cases each iteration will
paraphrase them differently every time, and an agent that writes both the
implementation and its tests will happily assert what the code does
instead of what the case requires. That has already happened in this
repo: the 2026-08-14 session found fourteen tests that encoded the bug as
intended behaviour.

The index gives every case a stable identity. The coverage gate makes an
agent's claim ("this ticket covers LST-3, LST-4") checkable against what
the tests actually tag.

## Commands

```bash
npm run cases:index       # regenerate docs/dev/case-index.json
npm run cases:check       # fail if the committed index is stale
npm run cases:coverage    # report which cases have tests
```

Gating forms:

```bash
npm run cases:coverage -- --require LST-3,LST-4   # per-ticket gate
npm run cases:coverage -- --milestone M1          # scope the uncovered list
npm run cases:coverage -- --tree surface --severity blocker
```

> A `cases:partition` tool also existed during the v1 build: it read each
> ticket's `Cases:` line out of the ticket roster and checked every UI
> case landed in exactly one ticket. It was retired with the ticket
> roster when the build completed.

## Tagging a test

A test declares the cases it verifies with a comment. One tag may name
several cases; several tests may tag the same case.

```ts
// @verifies LST-2
it("renders all ten column headers", async () => { … });
```

The tag is scanned from any `*.test.ts`, `*.test.tsx` or `*.spec.ts` file
in the repo, so unit tests, integration tests and Playwright specs all
count toward coverage.

## What the gates catch

| Failure | Exit | Why it is fatal |
|---|---|---|
| `@verifies` names a case not in the index | 1 | The agent invented a requirement. Every report built on it is untrustworthy |
| `--require` names an untagged case | 1 | The suite is green but never targeted the ticket's cases |
| `--require` names a case not in the index | 1 | As above — a fabricated ID in the ticket rather than in a test |
| The committed index is stale (`cases:check`) | 1 | Cases were added or retagged; anything reading the JSON is now working from an out-of-date specification |

## What the gates do *not* catch

A tag asserts only that a test **targets** a case. It cannot prove the
assertions are faithful to the prose — a test tagged `@verifies LST-3`
that asserts nothing still counts as covered. That is what the review
step reads for, and why the loop keeps a review after the tests are
written rather than treating coverage as sufficient.

## Adding a case

Cases are appended to the flow docs, never renumbered — IDs are
referenced from tests and commits. After editing a flow doc, run
`npm run cases:index` and commit the regenerated JSON alongside it.

The parser is strict on purpose: a heading it cannot parse is an error,
not a skipped line, because a silently dropped case is a case nothing
will ever test. Heading shapes it accepts:

```
### LST-1 · M1 · blocker · P2 P8              (UI: milestone, no surface)
### TSK-C1 · major · P4 P10 · CLI MCP         (surface: surface, no milestone)
### ONB-C1 · blocker · P4 · CLI MCP — **resolved**
```

The `— **resolved**` suffix marks a gap that has since been closed. The
case stays indexed and still addressable: it remains a requirement, and a
regression must still fail, but it is not outstanding work.

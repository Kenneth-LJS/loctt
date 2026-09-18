# UI acceptance specs

Playwright specs transcribed from `docs/dev/ui-test-cases/`. One `test`
per case, named by case ID, tagged with `@verifies` so the coverage gate
sees it.

```bash
npm run test:ui                                   # build, then run all specs
npx playwright test --config tests/ui/playwright.config.ts -g LST-2
```

`npm run test:ui` rebuilds first. Do not run it alongside
`test:integration`, `test:e2e` or `test:perf` — see the race described in
[../README.md](../README.md#how-to-run).

## The specs run against a real tracker

Each test gets its own temp directory, its own seeded `.loctt/`, and its
own `loctt ui` server on its own port, via the `tracker` fixture. Nothing
is mocked.

That is deliberate. The flow docs assert behaviour spanning the browser,
the HTTP layer and the files on disk — P1 is *the files are the truth* —
and a mocked API cannot falsify those claims. Isolation is per test
because a shared tracker makes specs order-dependent, and an
order-dependent gate is one an agent learns to work around rather than
satisfy.

```ts
import { expect, test } from "./fixtures/tracker.ts";

// @verifies LST-2
test("LST-2: …", async ({ page, tracker }) => {
  await tracker.seed([{ title: "First task", fields: { status: "in_progress" } }]);
  await page.goto(`${tracker.baseURL}/list`);
  …
});
```

The fixture also exposes `tracker.run([...])` for driving the CLI against
the same tracker mid-test — which is how the cross-surface cases in
`flow-cross-surface.md` (the CLI writing underneath a live UI) get
verified.

## Transcribing a case

The prose is the specification. Assert the case's bullets, in order, and
nothing it does not claim — a spec that asserts extra behaviour has
drifted from the case and will fail for reasons the case never described.

Two rules learned from this repo's own history:

- **Assert the far end, not the emission.** A case that checks a filter
  reaches the URL but never checks the result set narrows will pass while
  the filter does nothing. That exact gap hid a live bug (LST-16).
- **Prove the spec fails.** After writing it, break the behaviour it
  covers and confirm it goes red. A spec that cannot fail is worse than
  none: it reports safety that does not exist.

`retries: 0` is set on purpose. A spec that needs a retry is flaky, and a
flaky gate teaches an agent to re-run instead of fix.

## Rebuilding before a spec run

`npm run test:ui` builds everything first. Running Playwright directly
does not, and **which build you need depends on what you changed**:

| Changed | Rebuild with | Why |
|---|---|---|
| `apps/web/src/client/**` | `npm run build -w @loctt/web` | The SPA is served from `apps/web/dist/client` |
| `apps/web/src/server/**` | `npm run build` (root) | The fixture runs `loctt ui` from `apps/cli/dist/index.js`, which **bundles** the server via tsup — `tsc --build` alone does not update it |
| `packages/core/**` | `npm run build` (root) | Same bundle |

Getting this wrong is quiet rather than loud: the spec runs against
the previous build and passes. It cost a round of "why does this
mutation survive" on 2026-08-28, and it means a mutation test that
does not rebuild proves nothing.

## Never build while the suite is running

The fixture spawns `loctt ui` from `apps/cli/dist`, so a `npm run
build` during a run swaps the binary underneath the workers. The
result is a scatter of timeouts that look exactly like flakiness and
do not reproduce.

This has been misdiagnosed three times: twice as "the suite competes
with itself under `--workers`", once by the M1 gate as a harness
defect. A clean run on 2026-08-28 at load average 86 was **194/194**.

If you are iterating on a fix, build *then* run. If a suite run shows
scattered timeouts, check whether anything rebuilt during it before
believing them.

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

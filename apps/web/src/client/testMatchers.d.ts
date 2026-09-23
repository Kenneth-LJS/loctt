/**
 * Ambient types for the `@testing-library/jest-dom` matchers used by the
 * client test suites (UI-23e).
 *
 * The runtime half is per-file: each suite that wants them calls
 * `expect.extend(matchers)` itself, because this workspace has no global
 * vitest setup file. That registers the matchers but tells TypeScript
 * nothing, so `expect(el).toHaveAccessibleDescription(...)` fails to
 * compile without this module augmentation.
 *
 * Re-exported from the package's own `./vitest` types entry rather than
 * hand-written, so the signatures cannot drift from the matchers that
 * actually run. It is a `.d.ts` under `src/client`, which
 * `tsconfig.client.json`'s `include` already covers — no `types` array
 * entry needed, and nothing is emitted.
 *
 * Why these matchers at all: they compute the real accessible name and
 * description, the same way a screen reader does, instead of reading the
 * attribute that happens to produce them today. UI-23e changed which
 * attribute carries a disabled control's reason (`title` →
 * `aria-describedby`), so an attribute-level assertion would have
 * asserted the mechanism and gone red on a change that broke nothing.
 */
import "@testing-library/jest-dom/vitest";

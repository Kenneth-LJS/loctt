import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "./ui.js";

/**
 * @verifies ONB-C8
 *
 * "An install without the web client refuses to start and says the
 * install is damaged." `resolveClientDir` (runtime/schema-guard.ts)
 * returns `undefined` when neither `LOCTT_CLIENT_DIR` nor the bundled
 * `dist/client` next to the compiled CLI exists — exactly the shape of
 * an install whose client files never made it in (RR-B4).
 *
 * This test runs against the *source* `ui.ts` (via tsx/vitest, not the
 * built `dist/index.js`), so there is no `dist/client` beside it and no
 * `LOCTT_CLIENT_DIR` set: `resolveClientDir()` already resolves to
 * `undefined` here, which is what lets this be a cheap unit test rather
 * than a second full `npm pack` install in the packaging suite.
 */
describe("loctt ui: missing client files", () => {
  const originalClientDir = process.env["LOCTT_CLIENT_DIR"];

  beforeEach(() => {
    delete process.env["LOCTT_CLIENT_DIR"];
  });

  afterEach(() => {
    if (originalClientDir !== undefined) {
      process.env["LOCTT_CLIENT_DIR"] = originalClientDir;
    } else {
      delete process.env["LOCTT_CLIENT_DIR"];
    }
  });

  it("refuses to start and reports the install as damaged", async () => {
    // root is irrelevant: resolveClientDir() fails before root is touched.
    await expect(run([], "/nonexistent-root")).rejects.toThrow(
      "The web UI files are missing from this install. Reinstall loctt.",
    );
  });
});

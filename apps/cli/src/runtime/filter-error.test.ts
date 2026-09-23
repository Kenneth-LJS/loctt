import { FilterError } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { KNOWN_DOMAIN_ERRORS } from "./errors.js";

/**
 * UI-9. `FilterError` is a CLI domain error, for parity with the web
 * surface (`isQueryError` in `apps/web/src/server/server.ts`) and MCP
 * (`isKnownDomainError` in `apps/mcp/src/runtime/errors.ts`).
 *
 * **What this does and does not prove, measured.** As with
 * `stale-body-error.test.ts`'s `StaleBodyWriteError` case: the CLI's
 * outer `main()` catch (`index.ts`) also prints `Error: <message>` and
 * exits 1 for ANY `Error`, so an end-to-end `loctt list --view <broken>`
 * run cannot distinguish a registered `FilterError` from an unregistered
 * one — the text on screen is identical either way, because `FilterError`
 * carries no `detail` beyond its message. What the list still controls,
 * and what changes the moment `FilterError` ever gains a `detail` (the
 * way `LocttError` subclasses do): `runCommand`'s branch is where a
 * domain error's `detail` gets printed, indented, below the headline.
 * So membership is asserted here directly, at the only layer where it
 * is currently visible.
 */
describe("FilterError is a CLI domain error (UI-9)", () => {
  it("is in KNOWN_DOMAIN_ERRORS, so a broken view's filter is a rejection, not a crash", () => {
    const err = new FilterError("advanced filter does not parse: expected value but got \"=\" at position 9");
    const matched = KNOWN_DOMAIN_ERRORS.some(K => err instanceof K);
    expect(matched).toBe(true);
  });

  it("does not match an unrelated bug", () => {
    // Control: a list that matched everything would make the above vacuous.
    const bug = new TypeError("undefined is not a function");
    expect(KNOWN_DOMAIN_ERRORS.some(K => bug instanceof K)).toBe(false);
  });
});

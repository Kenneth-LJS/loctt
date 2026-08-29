// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ApiError } from "./client.ts";
import { createQueryClient } from "./queryClient.ts";

/**
 * Which failures are worth asking about again.
 *
 * A first cut tested the *status class* — no retry for any 4xx — and
 * got two things wrong. `conflict` is a 409 the state lock produces,
 * and BLK-42 says plainly that "retrying after the lock clears
 * succeeds"; treating it as settled means a bulk op blocked by a
 * concurrent `loctt` command never recovers on its own. 408 and 429
 * are retryable by definition.
 *
 * The server's `code` is the authority, because it is the thing that
 * actually distinguishes "we considered this and refused" from "not
 * right now".
 */

function apiError(code: string | undefined, status: number): ApiError {
  return new ApiError("boom", {
    status,
    body: undefined,
    endpoint: "/api/tasks",
    ...(code === undefined
      ? {}
      : { envelope: { code: code as never, message: "boom" } }),
  });
}

const defaults = createQueryClient().getDefaultOptions().queries;
const retry = defaults?.retry as (n: number, e: unknown) => boolean;
const interval = defaults?.refetchInterval as (q: unknown) => number | false;
const erroredWith = (e: unknown) => ({ state: { status: "error", error: e } });

describe("retry policy", () => {
  it("gives up on answers the server considered and refused", () => {
    for (const code of [
      "validation_failed",
      "not_found",
      "config_invalid",
      "schema_mismatch",
      "archived_reference",
    ]) {
      expect(retry(0, apiError(code, 400)), code).toBe(false);
      expect(interval(erroredWith(apiError(code, 400))), code).toBe(false);
    }
  });

  it("keeps trying a lock conflict, which BLK-42 says will clear", () => {
    const locked = apiError("conflict", 409);
    expect(retry(0, locked)).toBe(true);
    // And it keeps polling, so the UI recovers once the other process
    // finishes rather than sitting there until the user reloads.
    expect(interval(erroredWith(locked))).not.toBe(false);
  });

  it("keeps trying a server fault or an unreachable server", () => {
    expect(retry(0, apiError("io_failed", 500))).toBe(true);
    expect(retry(0, apiError("git_failed", 500))).toBe(true);
    // No envelope at all: the request never reached the server.
    expect(retry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(interval(erroredWith(new TypeError("Failed to fetch")))).not.toBe(false);

    // An `ApiError` that *did* reach the server but carried no
    // envelope — an HTML error page from something upstream, say.
    // Unclassifiable is not the same as settled: we have no grounds to
    // stop asking.
    expect(retry(0, apiError(undefined, 502))).toBe(true);
    expect(interval(erroredWith(apiError(undefined, 502)))).not.toBe(false);
  });

  it("does not classify by status class", () => {
    // The regression this file exists for: a 409 and a 400 are both
    // 4xx and must be treated differently.
    expect(retry(0, apiError("conflict", 409))).toBe(true);
    expect(retry(0, apiError("validation_failed", 400))).toBe(false);
  });

  it("still stops after one retry for a retryable failure", () => {
    expect(retry(1, apiError("io_failed", 500))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeSyncProgressReporter } from "./git.js";

/**
 * GIT-23 (CLI parity, P10): `loctt git sync` must report progress for a
 * large sync rather than running silent, and must NOT spam a line per
 * file for a 500-file sync nor decorate a tiny two-file pull. The
 * reporter's throttle + threshold are pure and unit-testable; the sync
 * engine that drives it is covered in core.
 */
describe("makeSyncProgressReporter (GIT-23)", () => {
  let writes: string[];

  beforeEach(() => {
    writes = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // @verifies GIT-23
  it("stays silent for a small sync below the threshold", () => {
    const report = makeSyncProgressReporter();
    for (let applied = 0; applied <= 10; applied += 1) report(applied, 10);
    expect(writes).toEqual([]);
  });

  // @verifies GIT-23
  it("reports progress for a large sync and always emits the final 100%", () => {
    const report = makeSyncProgressReporter();
    const total = 500;
    for (let applied = 0; applied <= total; applied += 1) report(applied, total);

    // It reported at all — not silent (bullet 1).
    expect(writes.length).toBeGreaterThan(0);
    // Throttled to whole-percent steps: far fewer than one line per file.
    expect(writes.length).toBeLessThan(total);
    // The final write reaches 100% and ends the line — a bar that stalls
    // one short of done is exactly what this guards against.
    const last = writes.at(-1) ?? "";
    expect(last).toContain("500/500");
    expect(last).toContain("100%");
    expect(last.endsWith("\n")).toBe(true);
  });

  // @verifies GIT-23
  it("does not repeat the same percent", () => {
    const report = makeSyncProgressReporter();
    // 200 files: applied 0 and 1 are both 0% (floor), so the second must
    // be suppressed — the throttle keys on the percent, not the count.
    report(0, 200);
    report(1, 200);
    // Exactly one write so far (both were 0%).
    expect(writes.length).toBe(1);
  });
});

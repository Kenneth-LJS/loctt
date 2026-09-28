import { describe, expect, it } from "vitest";

import { findMigrationPath, type Migration } from "./migrations.js";

function noop(): Promise<void> { return Promise.resolve(); }

/** Format versions 0.N.0, so the graph tests read as small numbers. */
const v = (n: number): string => `0.${String(n)}.0`;

function mig(from: number, to: number, opts?: { deprecated?: boolean }): Migration {
  return {
    from: v(from),
    to: v(to),
    description: `${from}→${to}`,
    apply: noop,
    ...(opts?.deprecated !== undefined ? { deprecated: opts.deprecated } : {}),
  };
}

describe("findMigrationPath", () => {
  it("returns [] when from === to", () => {
    expect(findMigrationPath(v(3), v(3), [])).toEqual([]);
  });

  it("returns null when no edges exist and from < to", () => {
    expect(findMigrationPath(v(1), v(2), [])).toBeNull();
  });

  it("returns null when from > to (no rollback)", () => {
    expect(findMigrationPath(v(5), v(3), [mig(3, 4), mig(4, 5)])).toBeNull();
  });

  it("walks a simple linear chain", () => {
    const migrations = [mig(1, 2), mig(2, 3), mig(3, 4)];
    const path = findMigrationPath(v(1), v(4), migrations);
    expect(path).not.toBeNull();
    expect(path!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual([
      "1→2", "2→3", "3→4",
    ]);
  });

  it("prefers the shorter path when multiple paths exist", () => {
    // Direct 1→3 fast path vs. 1→2→3 chain. Direct should win.
    const migrations = [
      mig(1, 2),
      mig(2, 3),
      mig(1, 3),
    ];
    const path = findMigrationPath(v(1), v(3), migrations);
    expect(path).not.toBeNull();
    expect(path!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual(["1→3"]);
  });

  it("prefers the non-deprecated path when lengths tie", () => {
    // Two paths of length 1 from 1→2: deprecated and not.
    // Non-deprecated should win.
    const dep = mig(1, 2, { deprecated: true });
    const fresh = mig(1, 2);
    // Order in registry should not matter; try both orders.
    expect(findMigrationPath(v(1), v(2), [dep, fresh])![0]).toBe(fresh);
    expect(findMigrationPath(v(1), v(2), [fresh, dep])![0]).toBe(fresh);
  });

  it("uses a deprecated edge if no non-deprecated path exists", () => {
    const migrations = [mig(1, 2, { deprecated: true })];
    const path = findMigrationPath(v(1), v(2), migrations);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]?.deprecated).toBe(true);
  });

  it("supports a 'skip the buggy v7' fast path: prefers v6→v8 over v6→v7→v8", () => {
    // Realistic scenario from the design discussion.
    const migrations = [
      mig(6, 7, { deprecated: true }),
      mig(7, 8),
      mig(6, 8),                        // new fast path
    ];
    // From v6: should pick the direct v6→v8 (1 step), not v6→v7→v8 (2 steps).
    const fromV6 = findMigrationPath(v(6), v(8), migrations);
    expect(fromV6!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual(["6→8"]);

    // From v7 (already past the bad version): must use v7→v8.
    const fromV7 = findMigrationPath(v(7), v(8), migrations);
    expect(fromV7!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual(["7→8"]);
  });

  it("does not overshoot: if 'to' is mid-chain, stops at 'to'", () => {
    const migrations = [mig(1, 2), mig(2, 3), mig(3, 4)];
    const path = findMigrationPath(v(1), v(3), migrations);
    expect(path!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual(["1→2", "2→3"]);
  });

  it("returns null when there is a gap", () => {
    // Nothing connects 2 to 4; the chain breaks.
    const migrations = [mig(1, 2), mig(4, 5)];
    expect(findMigrationPath(v(1), v(5), migrations)).toBeNull();
  });

  it("can route through multi-step jumps", () => {
    // 1→3, 3→5, 5→6 — all multi-step except the last.
    const migrations = [mig(1, 3), mig(3, 5), mig(5, 6)];
    const path = findMigrationPath(v(1), v(6), migrations);
    expect(path!.map(m => `${m.from.split(".")[1] ?? ""}→${m.to.split(".")[1] ?? ""}`)).toEqual([
      "1→3", "3→5", "5→6",
    ]);
  });

  it("among paths of equal length, prefers the one with fewer deprecated edges", () => {
    // Two 2-step paths from 1→3: through 2a (deprecated) or 2b (fresh).
    // Both end at 3 in two hops; fresh-path should win.
    const dep = { ...mig(1, 2), deprecated: true };
    const freshA = mig(1, 2);
    const freshB = mig(2, 3);
    const path = findMigrationPath(v(1), v(3), [dep, freshA, freshB]);
    // The picked first edge must be the non-deprecated 1→2.
    expect(path).toHaveLength(2);
    expect(path![0]?.deprecated).toBeFalsy();
  });
});

// @verifies ONB-C11
describe("format versions are compared as semver (K142)", () => {
  it("walks 0.9.0 → 0.10.0, which a string comparison would read as backwards", () => {
    const step: Migration = { from: "0.9.0", to: "0.10.0", description: "x", apply: noop };
    expect(findMigrationPath("0.9.0", "0.10.0", [step])).toEqual([step]);
  });
});

describe("the registry", () => {
  it("registers 0.1.0 → 0.3.0, not risky, so it runs automatically (K143)", async () => {
    const { listMigrations } = await import("./migrations.js");
    const { CURRENT_SCHEMA_VERSION } = await import("./version.js");
    expect(CURRENT_SCHEMA_VERSION).toBe("0.3.0");
    const path = findMigrationPath("0.1.0", CURRENT_SCHEMA_VERSION, listMigrations());
    expect(path?.map(m => [m.from, m.to, m.risky === true])).toEqual([["0.1.0", "0.3.0", false]]);
  });
});

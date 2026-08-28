import { expect, test } from "./fixtures/tracker.ts";

/**
 * The fixture's own contract. Not a case — a guard on the harness,
 * because `seedBulk`'s key collision was a real trap and the M1 gate
 * (F9) showed the run log had been wrong about the seeding cost twice.
 */
test("seedBulk uses the tracker's prefix and leaves create working", async ({ tracker }) => {
  await tracker.seedBulk(5);

  const listed = await tracker.run(["list"]);
  // The tracker's own prefix, not a synthetic one — so a spec that
  // reads these rows cannot tell them from `seed`'s.
  expect(listed).toMatch(/\bT-1\b/);
  expect(listed).not.toMatch(/BULK/);

  // And `create` still allocates a fresh key rather than colliding.
  const created = await tracker.run(["create", "after the bulk"]);
  const key = /\b(T-\d+)\b/.exec(created)?.[1];
  expect(key).toBeTruthy();
  expect(Number(key?.slice(2))).toBeGreaterThan(5);

  const after = await tracker.run(["list"]);
  expect(after).toContain("after the bulk");
  // Six rows, no key reused.
  const keys = [...after.matchAll(/^(T-\d+)\s/gm)].map(m => m[1]);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.length).toBe(6);
});

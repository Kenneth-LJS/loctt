import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Most complex scenario.
  // T-1 (Bug: 500 on signup), T-2 (Bug: typo in homepage),
  // T-4 (Bug: slow dashboard load) should:
  //   - have priority "high"
  //   - block T-5 (so T-5 is_blocked_by each of them)
  // T-3 (Feature: dark mode) should be untouched (no priority, no
  // relationship to T-5).
  expectTaskCount(5);

  expectTask("T-1").toExist().toHavePriority("high");
  expectTask("T-2").toExist().toHavePriority("high");
  expectTask("T-4").toExist().toHavePriority("high");

  // T-5 is blocked by T-1, T-2, T-4. We assert from T-5's side.
  await expectTask("T-5").toExist().toBeBlockedBy("T-1");
  await expectTask("T-5").toBeBlockedBy("T-2");
  await expectTask("T-5").toBeBlockedBy("T-4");

  // T-3: priority must be undefined and no link to T-5.
  expectTask("T-3").toExist();
  // toHavePriority would fail informatively if a priority got set.
  // Use the lower-level field check via title still being a feature
  // and re-read the task to verify priority is undefined.
  const { allTasks } = await import("../lib/expect.js");
  const t3 = allTasks().find(t => t.key === "T-3");
  if (!t3) throw new Error("T-3 missing");
  if (t3.priority !== undefined) {
    throw new Error(`expected T-3 priority to be unset, got ${JSON.stringify(t3.priority)}`);
  }
}

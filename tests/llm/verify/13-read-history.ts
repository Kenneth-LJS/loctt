import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only. T-1 still exists with the seeded mutations:
  // status=in_progress, priority=high.
  expectTaskCount(1);
  expectTask("T-1")
    .toExist()
    .toHaveStatus("in_progress")
    .toHavePriority("high");
}

import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Agent should have made T-2 and T-3 children of T-1. We check the
  // bilateral edge in both directions via the workflow's parent/child
  // inverse mapping.
  expectTaskCount(3);
  await expectTask("T-1").toExist().toHaveChild("T-2");
  await expectTask("T-1").toHaveChild("T-3");
}

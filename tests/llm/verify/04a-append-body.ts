import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Agent should have appended (not replaced). Body must contain BOTH
  // the original "Initial notes." line and a security-team mention.
  expectTaskCount(1);
  expectTask("T-1")
    .toExist()
    .toHaveBody(/Initial notes\./)
    .toHaveBody(/security/i);
}

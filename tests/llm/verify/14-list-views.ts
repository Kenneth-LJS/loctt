import { expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only. State unchanged. The agent's response (listing the saved
  // views) is the substance of this scenario but isn't filesystem-
  // verifiable. We only confirm no task mutation happened.
  expectTaskCount(0);
}

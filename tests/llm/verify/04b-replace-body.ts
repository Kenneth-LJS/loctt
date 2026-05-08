import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Agent should have replaced the body. The new content must mention
  // /design/auth.md, and the original "Initial notes." line must be gone.
  expectTaskCount(1);
  expectTask("T-1")
    .toExist()
    .toHaveBody(/\/design\/auth\.md/)
    .notToHaveBody(/Initial notes\./);
}

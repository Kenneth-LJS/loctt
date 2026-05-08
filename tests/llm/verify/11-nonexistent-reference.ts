import { expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only. Workspace has no tasks; should still have none.
  expectTaskCount(0);
}

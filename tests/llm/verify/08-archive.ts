import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // T-1 should still exist on disk (archive = soft delete) but with
  // archived=true.
  expectTaskCount(1);
  expectTask("T-1").toExist().toBeArchived();
}

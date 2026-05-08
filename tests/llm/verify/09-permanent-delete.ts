import { expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Agent should have permanently deleted T-1. No tasks remain.
  expectTaskCount(0);
  expectTask("T-1").notToExist();
}

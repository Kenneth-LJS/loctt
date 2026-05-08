import { expectAnyTaskWith, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only scenario. Seed = one task titled "Set up CI pipeline".
  expectTaskCount(1);
  expectAnyTaskWith({ title: "Set up CI pipeline" });
}

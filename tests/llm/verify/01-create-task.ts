import { expectAnyTaskWith, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Scenario expects: agent created exactly one task whose title mentions "login".
  expectTaskCount(1);
  expectAnyTaskWith({ title: /login/i });
}

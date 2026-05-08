import { AssertionError, expectTask, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // T-2 should still be a child of T-1; T-3 should NOT be.
  expectTaskCount(3);
  await expectTask("T-1").toExist().toHaveChild("T-2");

  // toHaveChild throws on missing edge, so flip the assertion: we
  // expect toHaveChild("T-3") to FAIL.
  let stillLinked = false;
  try {
    await expectTask("T-1").toHaveChild("T-3");
    stillLinked = true;
  } catch (err) {
    if (!(err instanceof AssertionError)) throw err;
  }
  if (stillLinked) {
    throw new AssertionError(`expected T-3 to no longer be a child of T-1, but the relationship still exists`);
  }
}

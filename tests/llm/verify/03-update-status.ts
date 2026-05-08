import { expectTask, expectTaskCount, workflow } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Agent should have set T-1 status to whatever the workflow's
  // "active" category status is. Accept any status whose category
  // is "active".
  expectTaskCount(1);
  const wf = await workflow();
  const activeKeys = wf.statuses.filter(s => s.category === "active").map(s => s.key);
  if (activeKeys.length === 0) {
    throw new Error("workflow has no statuses in the 'active' category — cannot verify");
  }
  expectTask("T-1").toExist().toHaveStatus(activeKeys);
}

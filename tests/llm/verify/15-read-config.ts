import { expectTaskCount, workflow } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only. State unchanged. The agent's response text is the
  // substance of this scenario; verification only confirms no mutation
  // and that the workflow config is loadable (so we know the agent
  // *could* have read it).
  expectTaskCount(0);
  const wf = await workflow();
  if (wf.statuses.length === 0) {
    throw new Error("workflow has no statuses configured — agent could not have read a meaningful list");
  }
}

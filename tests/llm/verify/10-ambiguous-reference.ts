import { allTasks, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Verification only confirms no mutation; the human must check the
  // agent's response for clarification behavior. Both seed tasks should
  // still exist with no status (the seed didn't set one).
  expectTaskCount(2);
  const tasks = allTasks();
  const withStatus = tasks.filter(t => t.status !== undefined);
  if (withStatus.length > 0) {
    throw new Error(
      `expected neither task to have a status set (agent should have asked for clarification), ` +
      `but ${withStatus.length} tasks have status: ${JSON.stringify(withStatus)}`,
    );
  }
}

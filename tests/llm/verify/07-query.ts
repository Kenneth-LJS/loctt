import { allTasks, expectAnyTaskWith, expectTaskCount } from "../lib/expect.js";

export default async function verify(_root: string): Promise<void> {
  // Read-only. Seed = 4 tasks. Counts unchanged. The agent's response
  // text is not verifiable from the filesystem; this only confirms no
  // mutation happened.
  expectTaskCount(4);
  expectAnyTaskWith({ title: /Fix login redirect/ });
  expectAnyTaskWith({ title: /Add password reset/ });
  expectAnyTaskWith({ title: /Update footer text/ });
  expectAnyTaskWith({ title: /Refactor logging/ });

  // Sanity: priorities still match the seed.
  const tasks = allTasks();
  const high = tasks.filter(t => t.priority === "high").length;
  if (high !== 2) {
    throw new Error(`expected 2 high-priority tasks (seed), got ${high}`);
  }
}

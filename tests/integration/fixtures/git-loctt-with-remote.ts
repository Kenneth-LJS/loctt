import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { withGitLoctt } from "./git-loctt.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

export interface GitLocttRemoteContext {
  readonly root: string;
  readonly remoteRepo: string;
}

/**
 * Run `fn` against a git-backed loctt workspace with a sibling bare repo
 * registered as `origin`. Both directories live under tests/workspace/.
 *
 * Cleanup ordering:
 *   - inner finally removes the bare repo (errors swallowed)
 *   - outer withGitLoctt removes the working tmpdir
 */
export async function withGitLocttRemote<T>(
  fn: (ctx: GitLocttRemoteContext) => Promise<T>,
): Promise<T> {
  return withGitLoctt(async ({ root }) => {
    const remoteRepo = await mkdtemp(path.join(workspaceRoot, "loctt-bare-"));
    try {
      await execa("git", ["init", "--bare", "-q", "-b", "main"], { cwd: remoteRepo });
      await execa("git", ["remote", "add", "origin", remoteRepo], { cwd: root });
      return await fn({ root, remoteRepo });
    } finally {
      try {
        await rm(remoteRepo, { recursive: true, force: true });
      } catch (err) {
        console.error(`[git-loctt-with-remote] cleanup failed for ${remoteRepo}:`, err);
      }
    }
  });
}

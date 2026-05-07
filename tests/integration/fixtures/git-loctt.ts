import { initLoctt } from "@loctt/core";
import { execa } from "execa";

import { withTmpLoctt } from "./tmp-loctt.js";

export interface GitLocttContext {
  /** Absolute path to the loctt working directory (also the git repo root). */
  readonly root: string;
}

/**
 * Deterministic identity / non-interactive env for spawned git commands.
 * `withTmpLoctt` snapshots and restores process.env, so setting these on
 * `process.env` here is safe — they're cleared on cleanup.
 */
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
} as const;

/**
 * Run `fn` against a workspace where loctt is initialized inside a real
 * `git init` repo. No remote is configured.
 *
 * Cleanup: delegates to withTmpLoctt — the entire tmpdir (including .git/)
 * is removed in a finally block. process.env is restored.
 */
export async function withGitLoctt<T>(
  fn: (ctx: GitLocttContext) => Promise<T>,
): Promise<T> {
  return withTmpLoctt(async ({ root }) => {
    // Set env on process.env so any indirect git invocations (e.g. core's
    // spawnSync calls) see the deterministic identity. withTmpLoctt restores
    // process.env in its finally.
    for (const [k, v] of Object.entries(GIT_ENV)) {
      process.env[k] = v;
    }

    const env = { ...process.env, ...GIT_ENV };
    await execa("git", ["init", "-q", "-b", "main"], { cwd: root, env });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: root, env });
    await execa("git", ["config", "user.name", "Test"], { cwd: root, env });

    await initLoctt(root);

    return fn({ root });
  }, { init: false });
}

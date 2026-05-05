import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CliSpawnOptions {
  /** Working directory for the spawned CLI. Required — never inherits ambient cwd. */
  readonly cwd: string;
  /** Extra env merged on top of the parent's env. */
  readonly env?: Record<string, string>;
  /** Hard timeout in ms. Defaults to 10s. */
  readonly timeout?: number;
}

/**
 * Spawn `node apps/cli/dist/index.js <args>` in the given workspace and
 * return its stdout/stderr/exitCode.
 *
 * Errors are NOT thrown for non-zero exits; the caller asserts on
 * `exitCode`. Execa's own timeout / spawn errors do throw.
 */
export async function runCli(args: string[], opts: CliSpawnOptions): Promise<CliResult> {
  const result = await execa(process.execPath, [cliEntry, ...args], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    timeout: opts.timeout ?? 10_000,
    reject: false,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : -1,
  };
}

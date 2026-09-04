/**
 * Shared server-harness plumbing for the UI fixtures.
 *
 * `tracker.ts` and `git-tracker.ts` both spin up the real built `loctt
 * ui` binary on its own free port, wait for it to answer, and tear it
 * down cleanly. That machinery — free-port selection, readiness poll,
 * SIGTERM-then-SIGKILL shutdown — is identical for both and has no
 * business being copy-pasted: a bug fixed in one copy would linger in
 * the other. It lives here so both fixtures import one implementation.
 *
 * The git fixture is a strict superset of the plain one (a git repo
 * with a bare remote wrapped around the same tracker), so keeping the
 * spawn/teardown contract in one place is what lets it *extend* the
 * plain fixture rather than fork it.
 */

import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");
export const workspaceRoot = path.join(repoRoot, "tests/workspace");

/**
 * Binds port 0 to let the OS assign a free port, then releases it. A racing
 * process could still take it, but this is far tighter than picking at
 * random and retrying on collision.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close(() => reject(new Error("could not determine a free port")));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

export async function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/info`);
      if (res.status === 200) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

/**
 * Structural, rather than execa's `ResultPromise`: that type is generic in
 * the call's options, so naming it here would not accept our concrete
 * invocation under `exactOptionalPropertyTypes`. Only these members are
 * used, so requiring only these keeps the shutdown helper honest.
 */
export interface KillableProcess extends PromiseLike<unknown> {
  readonly exitCode?: number | null | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  catch(onrejected: () => unknown): PromiseLike<unknown>;
}

export async function killAndWait(child: KillableProcess): Promise<void> {
  if (child.exitCode !== null && child.exitCode !== undefined) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    child.catch(() => undefined).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await Promise.race([child.catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
  }
}

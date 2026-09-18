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

/**
 * Live `loctt ui` children, so a runner killed mid-suite takes its
 * servers with it.
 *
 * Per-fixture teardown (`killAndWait` in a `finally`) handles the happy
 * path, but a SIGINT/SIGTERM to the vitest runner — or the worktree being
 * harvested while a suite is up — skips every `finally` and orphans the
 * spawned server: it survives with no parent and no directory, holding a
 * port and a heap for hours (measured: three, the oldest 25h). Registering
 * each child here and killing them all on the runner's own signal/exit is
 * the "kill them when nobody is watching" half the per-fixture teardown
 * cannot cover. See known-gaps "Removing a worktree leaves its loctt ui
 * server running".
 */
const liveServers = new Set<KillableProcess>();
let signalHandlersInstalled = false;

function installProcessTeardown(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  // Synchronous, best-effort SIGKILL of every still-live child. The
  // process is on its way out (signal or exit), so there is no time for
  // an async graceful stop — a hard kill is exactly right here, and each
  // child's own SIGTERM/SIGKILL path already ran if teardown got to it.
  const killAllSync = (): void => {
    for (const child of liveServers) {
      try {
        if (child.exitCode === null || child.exitCode === undefined) {
          child.kill("SIGKILL");
        }
      } catch {
        // The child may already be gone; nothing to do.
      }
    }
    liveServers.clear();
  };
  process.once("SIGINT", () => { killAllSync(); process.exit(130); });
  process.once("SIGTERM", () => { killAllSync(); process.exit(143); });
  // `exit` cannot run async work, but a synchronous SIGKILL is fine and
  // catches an ordinary process teardown that bypassed the signals.
  process.once("exit", killAllSync);
}

/**
 * Registers a spawned `loctt ui` child for both per-fixture teardown (the
 * caller still `killAndWait`s it in its own `finally`) and process-level
 * teardown on the runner's signal/exit. Returns an `unregister` to call
 * once the child is cleanly stopped, so the set does not leak dead refs.
 */
export function registerServerChild(child: KillableProcess): () => void {
  installProcessTeardown();
  liveServers.add(child);
  return () => { liveServers.delete(child); };
}

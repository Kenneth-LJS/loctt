import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/info`);
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
 * the call's options, so naming it here would not accept this file's
 * concrete invocation under exactOptionalPropertyTypes. Only these
 * members are used.
 */
interface KillableProcess extends PromiseLike<unknown> {
  readonly exitCode?: number | null | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  catch(onrejected: () => unknown): PromiseLike<unknown>;
}

async function killAndWait(child: KillableProcess): Promise<void> {
  if (child.exitCode !== null && child.exitCode !== undefined) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    child.catch(() => undefined).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await Promise.race([
      child.catch(() => undefined),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
}

describe("CLI ui startup (spawned binary)", () => {
  it(
    "starts the web server and serves /api/info",
    async () => {
      await withTmpLoctt(async ({ root }) => {
        const port = 30000 + Math.floor(Math.random() * 30000);
        const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
          cwd: root,
          env: process.env,
          reject: false,
        });

        try {
          await waitForReady(port, 5000);

          const res = await fetch(`http://localhost:${port}/api/info`);
          expect(res.status).toBe(200);
          const body = (await res.json()) as { exists?: boolean };
          expect(body.exists).toBe(true);
        } finally {
          await killAndWait(child);
        }
      });
    },
    10_000,
  );
});

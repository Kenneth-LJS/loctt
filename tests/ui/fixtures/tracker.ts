/**
 * Per-test tracker + server fixture for the UI specs.
 *
 * Every spec gets its own `.loctt/` directory and its own `loctt ui`
 * process on its own port. Sharing either would make specs order-dependent
 * — one spec's archive or field edit would change what the next one sees —
 * and an order-dependent gate is one an agent learns to work around.
 *
 * The server is the real built binary, serving the real built SPA. Nothing
 * here mocks the API: the flow docs assert behaviour that reaches the files
 * on disk, so the files have to be real.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test as base } from "@playwright/test";
import { execa } from "execa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

export interface SeedTask {
  readonly title: string;
  /** Field/value pairs applied via `loctt set` after creation. */
  readonly fields?: Readonly<Record<string, string>>;
}

export interface TrackerFixture {
  /** Absolute path to the tracker root (the directory holding `.loctt/`). */
  readonly root: string;
  /** Base URL of the running server, e.g. `http://127.0.0.1:31234`. */
  readonly baseURL: string;
  /** Runs a `loctt` subcommand against this tracker; returns stdout. */
  run(args: readonly string[]): Promise<string>;
  /** Creates tasks in order, returning the assigned keys (`T-1`, `T-2`, …). */
  seed(tasks: readonly SeedTask[]): Promise<string[]>;
  /**
   * Writes `count` minimal tasks straight to disk, bypassing the CLI.
   *
   * `seed` spawns one `loctt create` per task at ~250ms each, so the
   * scale cases (BLK-24, BLK-34) would take twenty minutes. These files
   * are the same shape `create` writes.
   *
   * **It does not advance `state.yaml`'s key counter**, so a `create`
   * after `seedBulk` will collide. Use it for read/scale specs only —
   * anything that writes should use `seed`.
   */
  seedBulk(count: number, prefix?: string): Promise<void>;
}

/**
 * Binds port 0 to let the OS assign a free port, then releases it. A racing
 * process could still take it, but this is far tighter than picking at
 * random and retrying on collision.
 */
async function freePort(): Promise<number> {
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

async function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
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
    await Promise.race([child.catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
  }
}

export const test = base.extend<{ tracker: TrackerFixture }>({
  tracker: async ({}, use) => {
    const root = await mkdtemp(path.join(workspaceRoot, "loctt-ui-"));

    const run = async (args: readonly string[]): Promise<string> => {
      const result = await execa(process.execPath, [cliEntry, ...args], {
        cwd: root,
        env: process.env,
        reject: false,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `loctt ${args.join(" ")} exited ${String(result.exitCode)}\n${result.stderr}`,
        );
      }
      return result.stdout;
    };

    await run(["init"]);

    const seed = async (tasks: readonly SeedTask[]): Promise<string[]> => {
      const keys: string[] = [];
      for (const task of tasks) {
        const out = await run(["create", task.title]);
        // `create` prints the assigned key; capture it rather than assuming
        // the numbering, so a spec that seeds after other writes still works.
        const key = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(out)?.[1];
        if (key === undefined) {
          throw new Error(`could not parse a task key from: ${out}`);
        }
        for (const [field, value] of Object.entries(task.fields ?? {})) {
          await run(["set", key, field, value]);
        }
        keys.push(key);
      }
      return keys;
    };

    const port = await freePort();
    const baseURL = `http://127.0.0.1:${String(port)}`;
    const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
      cwd: root,
      env: process.env,
      reject: false,
    });

    try {
      await waitForReady(baseURL, 15_000);
      const seedBulk = async (count: number, prefix = "BULK"): Promise<void> => {
        const projectId = /^\s{2}([0-9A-Z]{26}):/m.exec(
          await readFile(path.join(root, ".loctt", "state.yaml"), "utf8"),
        )?.[1];
        if (projectId === undefined) throw new Error("no project in state.yaml");
        const stamp = "2026-01-01T00:00:00.000Z";
        await Promise.all(
          Array.from({ length: count }, async (_unused, i) => {
            // Monotonic, unique, and 26 chars — enough to satisfy the
            // readers without pulling ulid() into the fixture.
            const id = `01M${String(i).padStart(23, "0")}`;
            const dir = path.join(root, ".loctt", "tasks", id);
            await mkdir(dir, { recursive: true });
            await writeFile(
              path.join(dir, "task.md"),
              `---\nid: ${id}\nkey: ${prefix}-${String(i + 1)}\n`
              + `title: Bulk task ${String(i + 1)}\ncreated_at: ${stamp}\n`
              + `updated_at: ${stamp}\nproject: ${projectId}\nstatus: backlog\n---\n`,
              "utf8",
            );
          }),
        );
      };

      await use({ root, baseURL, run, seed, seedBulk });
    } finally {
      await killAndWait(child);
      await rm(root, { recursive: true, force: true }).catch((err: unknown) => {
        console.error(`ui fixture: failed to remove ${root}: ${String(err)}`);
      });
    }
  },
});

export { expect } from "@playwright/test";

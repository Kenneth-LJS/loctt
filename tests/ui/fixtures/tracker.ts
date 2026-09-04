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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { test as base } from "@playwright/test";
import { execa } from "execa";

import { cliEntry, freePort, killAndWait, waitForReady, workspaceRoot } from "./server-harness.ts";

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
   * `seed` spawns one `loctt create` per task at ~250ms each, so a
   * sixty-task spec pays fifteen seconds of subprocess time before it
   * asserts anything — and with five Playwright workers that is the
   * suite starving itself. These files are the same shape `create`
   * writes.
   *
   * Keys use the tracker's own prefix by default, so this is a
   * drop-in for `seed` wherever a spec needs rows rather than
   * allocated keys. `state.yaml`'s counter **is** advanced, so a
   * later `create` does not collide — the caveat that used to make
   * this unsafe for anything but read-only specs.
   *
   * `title` names the rows. Several specs assert on a literal title
   * (`"Task 1"`), which the default `Bulk task N` would break — so
   * they could not use this and paid ~15s of subprocess time each
   * instead. Passing `n => \`Task \${n}\`` makes it a drop-in.
   *
   * What it still cannot do is set fields, and it returns no keys.
   * A spec that needs either wants `seed`.
   */
  seedBulk(count: number, prefix?: string, title?: (n: number) => string): Promise<void>;
}

/**
 * Writes field values directly into task frontmatter.
 *
 * Reads every task file once, matches each by its `key`, and rewrites
 * only the files that need changing. Insertion is line-based rather
 * than through a YAML round-trip so a file's existing formatting,
 * key order and body survive untouched — the specs assert against
 * what the app renders from these files, and a reformat would be a
 * change they cannot see but might depend on.
 */
async function applyFields(
  root: string,
  updates: readonly { key: string; fields: Readonly<Record<string, string>> }[],
): Promise<void> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const ids = await readdir(tasksDir);
  const byKey = new Map(updates.map(u => [u.key, u.fields]));

  await Promise.all(
    ids.map(async id => {
      const file = path.join(tasksDir, id, "task.md");
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        return; // not a task directory
      }
      const key = /^key:\s*(\S+)\s*$/m.exec(text)?.[1];
      if (key === undefined) return;
      const fields = byKey.get(key);
      if (fields === undefined) return;

      let next = text;
      for (const [field, value] of Object.entries(fields)) {
        const existing = new RegExp(`^${field}:.*$`, "m");
        next = existing.test(next)
          ? next.replace(existing, `${field}: ${value}`)
          // No `---` of its own: insert after the opening fence, which
          // is the first line, so the closing one is never mistaken
          // for it.
          : next.replace(/^---\n/, `---\n${field}: ${value}\n`);
      }
      if (next !== text) await writeFile(file, next, "utf8");
    }),
  );
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

    /**
     * Creates tasks, then applies their fields in one batch.
     *
     * Fields used to go through `loctt set`, one process per field, so
     * a sixty-task seed spawned well over a hundred subprocesses and
     * took ~20 seconds. Under five Playwright workers that is the
     * suite competing with itself, and it made six specs fail as a
     * group while every one of them passed alone — recorded in
     * known-gaps.md as the harness defect it was.
     *
     * `create` still runs per task, because key allocation is stateful
     * and the assigned key is what the spec needs back. The fields are
     * written straight into the frontmatter afterwards: they are plain
     * scalars, and `set`'s validation is not what these specs are
     * testing. A spec that *does* care about `set` calls `run` itself.
     */
    const seed = async (tasks: readonly SeedTask[]): Promise<string[]> => {
      const keys: string[] = [];
      const pending: { key: string; fields: Readonly<Record<string, string>> }[] = [];
      for (const task of tasks) {
        const out = await run(["create", task.title]);
        // `create` prints the assigned key; capture it rather than assuming
        // the numbering, so a spec that seeds after other writes still works.
        const key = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(out)?.[1];
        if (key === undefined) {
          throw new Error(`could not parse a task key from: ${out}`);
        }
        const fields = task.fields;
        if (fields !== undefined && Object.keys(fields).length > 0) {
          pending.push({ key, fields });
        }
        keys.push(key);
      }
      if (pending.length > 0) await applyFields(root, pending);
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
      const seedBulk = async (
        count: number,
        prefix?: string,
        title?: (n: number) => string,
      ): Promise<void> => {
        const statePath = path.join(root, ".loctt", "state.yaml");
        const stateText = await readFile(statePath, "utf8");
        const projectId = /^\s{2}([0-9A-Z]{26}):/m.exec(stateText)?.[1];
        if (projectId === undefined) throw new Error("no project in state.yaml");
        // The tracker's own prefix unless the caller insists, so these
        // rows are indistinguishable from `seed`'s to a spec that only
        // reads them.
        // `state.yaml` quotes the prefix (`prefix: "T-"`), so strip
        // them — a literal `"T-"-1` key parses as YAML but matches
        // nothing the reader looks for, and the tasks silently vanish
        // from every list.
        const rawPrefix = /^\s{4}prefix:\s*(\S+)\s*$/m.exec(stateText)?.[1];
        const keyPrefix = prefix ?? rawPrefix?.replace(/^["']|["']$/g, "") ?? "BULK-";
        const sep = keyPrefix.endsWith("-") ? "" : "-";
        // Start where the tracker's counter is, not at 1. Numbering
        // from 1 unconditionally meant `seed` then `seedBulk` wrote
        // duplicate keys onto disk — the counter advance below
        // protects later `create`s but cannot protect the rows this
        // call is writing.
        const first = Number(/^\s{4}next_number:\s*(\d+)\s*$/m.exec(stateText)?.[1] ?? "1");
        const stamp = "2026-01-01T00:00:00.000Z";
        await Promise.all(
          Array.from({ length: count }, async (_unused, i) => {
            // Monotonic, unique, and 26 chars — enough to satisfy the
            // readers without pulling ulid() into the fixture.
            const n = first + i;
            // Unique across calls as well as within one: two
            // `seedBulk`s on the same tracker must not collide either.
            const id = `01M${String(n).padStart(23, "0")}`;
            const dir = path.join(root, ".loctt", "tasks", id);
            await mkdir(dir, { recursive: true });
            await writeFile(
              path.join(dir, "task.md"),
              `---\nid: ${id}\nkey: ${keyPrefix}${sep}${String(n)}\n`
              + `title: ${title?.(i + 1) ?? `Bulk task ${String(i + 1)}`}\n`
              + `created_at: ${stamp}\n`
              + `updated_at: ${stamp}\nproject: ${projectId}\nstatus: backlog\n---\n`,
              "utf8",
            );
          }),
        );

        // Advance the key counter past what we just wrote, so a later
        // `create` allocates a fresh key rather than colliding with
        // one of these. Without this, `seedBulk` was safe only for
        // read-only specs — which is most of the reason it was not
        // already used where it would help most.
        await writeFile(
          statePath,
          stateText.replace(
            /^(\s{4}next_number:\s*)(\d+)\s*$/m,
            (_m, head: string, current: string) =>
              `${head}${String(Math.max(Number(current), first + count))}`,
          ),
          "utf8",
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

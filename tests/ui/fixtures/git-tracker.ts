/**
 * Git-backed tracker + server fixture for the git-sync UI specs.
 *
 * The plain `tracker` fixture (tracker.ts) serves a `loctt init` tracker
 * over `loctt ui`, but the directory is not a git repository and has no
 * remote — so the Settings → Sync panel can only ever render its
 * not-a-repo refusal there. The git-sync cases need the browser talking
 * to a tracker that is a **real git repo with a real bare remote**, so
 * Enable, Publish and Sync actually move commits and files.
 *
 * This mirrors the integration suite's `withGitLocttRemote`
 * (tests/integration/fixtures/git-loctt-with-remote.ts): a working tree
 * that is `git init`-ed, a sibling bare repo registered as `origin`, and
 * loctt initialised inside it. The server harness (free port, readiness
 * poll, clean shutdown) is shared with the plain fixture via
 * server-harness.ts, so this genuinely extends that setup rather than
 * forking it.
 *
 * Every git spec asserts the **far end**, not a toast: after Publish the
 * `loctt` ref on the bare remote holds the pushed commit (`bareHasRef` /
 * `bareCommit`, mirrored from the integration test); after Sync the
 * pulled tasks are on disk under `.loctt/tasks/<ulid>/` and
 * `.loctt/local/sync.yaml`'s `last_synced_commit` has advanced.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test as base } from "@playwright/test";
import { execa } from "execa";

import { cliEntry, freePort, killAndWait, registerServerChild, waitForReady, workspaceRoot } from "./server-harness.ts";

/**
 * Deterministic identity and non-interactive git for every spawned git
 * command — the same block `git-loctt.ts` sets in the integration suite,
 * so a checkout does not stall on a credential or identity prompt.
 */
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
} as const;

export interface GitTrackerFixture {
  /** Absolute path to the tracker root (also the git repo root). */
  readonly root: string;
  /** Absolute path to the bare `origin` repo the panel pushes to. */
  readonly remoteRepo: string;
  /** Base URL of the running server, e.g. `http://127.0.0.1:31234`. */
  readonly baseURL: string;
  /** Runs a `loctt` subcommand against this tracker; returns stdout. */
  run(args: readonly string[]): Promise<string>;
  /** Creates tasks in order, returning the assigned keys (`T-1`, `T-2`, …). */
  seed(titles: readonly string[]): Promise<string[]>;
  /** Runs a raw git command in the working tree with deterministic identity. */
  git(args: readonly string[]): Promise<string>;
  /** True when `ref` resolves in the bare remote (mirrors `bareHasRef`). */
  bareHasRef(ref: string): Promise<boolean>;
  /** The full commit `ref` points at in the bare remote, or undefined. */
  bareCommit(ref: string): Promise<string | undefined>;
}

/**
 * Pushes tasks to the bare remote's `loctt` branch from a throwaway
 * second tracker, simulating another machine having published — the
 * remote-drift precondition GIT-3 and GIT-20 need. Returns the commit
 * the bare `loctt` ref now points at.
 *
 * It is a full independent tracker (its own `init` + `git enable`) so
 * the tasks it publishes are real loctt tasks a sync will parse and
 * write, not a hand-rolled marker file.
 */
/**
 * Runs a batch of loctt subcommands in a throwaway clone that first
 * `init`s, enables git, and fast-forwards onto the branch, then publishes
 * afterwards — the shared shape every "another machine did X" helper
 * needs. `build(cli)` issues the clone-specific commands (create, set,
 * link). Returns the bare `loctt` head after publishing.
 */
async function inOtherClone(
  remoteRepo: string,
  build: (cli: (args: readonly string[]) => Promise<unknown>) => Promise<void>,
): Promise<string> {
  const other = await mkdtemp(path.join(workspaceRoot, "loctt-other-"));
  const env = { ...process.env, ...GIT_ENV };
  try {
    await execa("git", ["init", "-q", "-b", "main"], { cwd: other, env });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: other, env });
    await execa("git", ["config", "user.name", "Test"], { cwd: other, env });
    await execa("git", ["remote", "add", "origin", remoteRepo], { cwd: other, env });
    const cli = (args: readonly string[]) =>
      execa(process.execPath, [cliEntry, ...args], { cwd: other, env });
    await cli(["init"]);
    await cli(["git", "enable"]);
    // Adopt the branch's current state so this clone's publish is a
    // fast-forward on top of it, not a divergent history.
    await cli(["git", "sync"]).catch(() => undefined);
    await build(cli);
    await cli(["git", "publish"]);
    const head = await execa("git", ["--git-dir", remoteRepo, "rev-parse", "loctt"], { env });
    return head.stdout.trim();
  } finally {
    await rm(other, { recursive: true, force: true }).catch(() => {});
  }
}

export async function publishFromOtherClone(
  remoteRepo: string,
  titles: readonly string[],
): Promise<string> {
  return inOtherClone(remoteRepo, async (cli) => {
    for (const title of titles) await cli(["create", title]);
  });
}

/**
 * Applies a set of `loctt set <key> <field> <value>` edits in a throwaway
 * clone that first fast-forwards onto the branch, then publishes — the
 * "remote side changed it too" half of a two-sided divergence the
 * reconciliation cases need (GIT-6, GIT-11, GIT-13, GIT-14). Returns the
 * branch head after the remote edits.
 *
 * Independent full tracker (its own clone of the bare remote), so the
 * edits it publishes are real loctt writes a sync will classify, not a
 * hand-rolled diff.
 */
export async function editFromOtherClone(
  remoteRepo: string,
  edits: readonly { key: string; field: string; value: string }[],
): Promise<string> {
  return inOtherClone(remoteRepo, async (cli) => {
    for (const e of edits) await cli(["set", e.key, e.field, e.value]);
  });
}

/**
 * Like {@link editFromOtherClone} but runs `loctt link <task>
 * <relationship> <target>` on the remote side — for the parent-conflict
 * case (GIT-13), where the divergent value is a relationship edge, not a
 * scalar. Returns the branch head after publishing.
 */
export async function linkFromOtherClone(
  remoteRepo: string,
  links: readonly { task: string; type: string; target: string }[],
): Promise<string> {
  return inOtherClone(remoteRepo, async (cli) => {
    for (const l of links) await cli(["link", l.task, l.type, l.target]);
  });
}

/**
 * Deletes a task (by key) from a throwaway clone that first fast-forwards
 * onto the branch, then publishes — the "remote side deleted it" half of a
 * delete-vs-edit divergence (GIT-16). Returns the branch head afterwards.
 */
export async function deleteFromOtherClone(
  remoteRepo: string,
  keys: readonly string[],
): Promise<string> {
  return inOtherClone(remoteRepo, async (cli) => {
    for (const key of keys) await cli(["delete", key, "--yes"]);
  });
}

/**
 * Simulates a force-push / history rewrite on the bare remote (GIT-21):
 * builds a brand-new orphan `loctt` history in a throwaway clone and
 * `push --force`es it onto the bare remote's `loctt` ref, so the commit
 * the local tracker last synced against is no longer an ancestor of the
 * remote head. Returns the new (rewritten) remote head sha.
 *
 * A throwaway working clone rather than a bare-repo poke, so the orphan
 * commit is a real commit git will happily force onto the ref — exactly
 * what `git push --force` of a rewritten branch produces.
 */
export async function forcePushRewriteRemote(remoteRepo: string): Promise<string> {
  const other = await mkdtemp(path.join(workspaceRoot, "loctt-rewrite-"));
  const env = { ...process.env, ...GIT_ENV };
  try {
    await execa("git", ["init", "-q", "-b", "loctt"], { cwd: other, env });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: other, env });
    await execa("git", ["config", "user.name", "Test"], { cwd: other, env });
    // An orphan commit: no shared ancestry with anything on the remote.
    await execa("git", ["commit", "--allow-empty", "-q", "-m", "rewritten history"], { cwd: other, env });
    const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: other, env })).stdout.trim();
    await execa("git", ["push", "--force", remoteRepo, "loctt:loctt"], { cwd: other, env });
    return head;
  } finally {
    await rm(other, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Creates a colliding task from a clone that shares the SAME project id +
 * key counter as the local tracker (GIT-8/GIT-9/K92 — the same-project key
 * collision, distinct from the two-independent-`init`s reprefix case). It
 * clones the bare remote, materialises the published `.loctt/` (the loctt
 * branch tree is that directory's contents) plus the NEVER_MIRROR
 * `.schema-version` copied from `sourceRoot`, creates one task offline
 * pinned to an EARLIER `created_at` (so it keeps the key and the local
 * task is the one renumbered), and publishes. Returns the branch head.
 */
export async function createCollidingFromOtherClone(
  remoteRepo: string,
  sourceRoot: string,
  title: string,
): Promise<string> {
  const other = await mkdtemp(path.join(workspaceRoot, "loctt-collide-"));
  const env = { ...process.env, ...GIT_ENV };
  try {
    await execa("git", ["clone", "-q", remoteRepo, other], { env });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: other, env });
    await execa("git", ["config", "user.name", "Test"], { cwd: other, env });
    await mkdir(path.join(other, ".loctt"), { recursive: true });
    await execa(
      "bash",
      ["-c", `git archive origin/loctt | tar -x -C ${JSON.stringify(path.join(other, ".loctt"))}`],
      { cwd: other, env },
    );
    await execa("cp", [
      path.join(sourceRoot, ".loctt", ".schema-version"),
      path.join(other, ".loctt", ".schema-version"),
    ]);
    // Record last_synced_commit at the branch head the clone was taken from,
    // so the clone's publish fast-forwards the bare `loctt` ref rather than
    // being rejected as a divergent (non-ff) push. auto_push on, so the
    // colliding task reaches the bare where the local tracker's sync sees it.
    const branchHead = (await execa("git", ["--git-dir", remoteRepo, "rev-parse", "loctt"], { env })).stdout.trim();
    await mkdir(path.join(other, ".loctt", "local"), { recursive: true });
    await writeFile(
      path.join(other, ".loctt", "local", "sync.yaml"),
      "git:\n  enabled: true\n  branch: loctt\n  remote: origin\n"
      + `  auto_fetch: true\n  auto_push: true\n  last_synced_commit: ${branchHead}\n`,
    );
    const cli = (args: readonly string[]) =>
      execa(process.execPath, [cliEntry, ...args], { cwd: other, env });
    const created = await cli(["create", title]);
    // Pin this clone's task EARLIER so it keeps the key on collision.
    const key = /Created (\S+):/.exec((created as { stdout: string }).stdout)?.[1] ?? "";
    const tasksDir = path.join(other, ".loctt", "tasks");
    for (const id of await (await import("node:fs/promises")).readdir(tasksDir)) {
      const p = path.join(tasksDir, id, "task.md");
      const raw = await readFile(p, "utf8");
      if (new RegExp(`^key:\\s*${key}\\b`, "m").test(raw)) {
        await writeFile(p, raw.replace(/^created_at: .*$/m, "created_at: 2000-01-01T00:00:00.000Z"));
      }
    }
    await cli(["git", "publish"]);
    const head = await execa("git", ["--git-dir", remoteRepo, "rev-parse", "loctt"], { env });
    return head.stdout.trim();
  } finally {
    await rm(other, { recursive: true, force: true }).catch(() => {});
  }
}

export interface NonRepoTrackerFixture {
  /** Absolute path to the tracker root — a directory that is NOT a git repo. */
  readonly root: string;
  /** Base URL of the running server. */
  readonly baseURL: string;
}

export const test = base.extend<{
  gitTracker: GitTrackerFixture;
  nonRepoTracker: NonRepoTrackerFixture;
}>({
  /**
   * A tracker in a directory that is genuinely NOT a git repository, for
   * GIT-28. It must live under the OS tmpdir rather than
   * `tests/workspace`, because the latter sits inside this repo's own
   * git worktree — a tracker there reports `isGitRepo: true` and the
   * not-a-repo state never renders.
   */
  nonRepoTracker: async ({}, use) => {
    const root = await mkdtemp(path.join(tmpdir(), "loctt-nonrepo-ui-"));
    const env = { ...process.env };
    await execa(process.execPath, [cliEntry, "init"], { cwd: root, env });

    const port = await freePort();
    const baseURL = `http://127.0.0.1:${String(port)}`;
    const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
      cwd: root,
      env,
      reject: false,
    });
    const unregister = registerServerChild(child);
    try {
      await waitForReady(baseURL, 15_000);
      await use({ root, baseURL });
    } finally {
      await killAndWait(child);
      unregister();
      await rm(root, { recursive: true, force: true }).catch((err: unknown) => {
        console.error(`non-repo tracker fixture: failed to remove ${root}: ${String(err)}`);
      });
    }
  },

  gitTracker: async ({}, use) => {
    const root = await mkdtemp(path.join(workspaceRoot, "loctt-git-ui-"));
    const remoteRepo = await mkdtemp(path.join(workspaceRoot, "loctt-git-bare-"));
    const env = { ...process.env, ...GIT_ENV };

    const git = async (args: readonly string[]): Promise<string> => {
      const result = await execa("git", args, { cwd: root, env, reject: false });
      if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} exited ${String(result.exitCode)}\n${result.stderr}`);
      }
      return result.stdout;
    };

    const run = async (args: readonly string[]): Promise<string> => {
      const result = await execa(process.execPath, [cliEntry, ...args], {
        cwd: root,
        env,
        reject: false,
      });
      if (result.exitCode !== 0) {
        throw new Error(`loctt ${args.join(" ")} exited ${String(result.exitCode)}\n${result.stderr}`);
      }
      return result.stdout;
    };

    const seed = async (titles: readonly string[]): Promise<string[]> => {
      const keys: string[] = [];
      for (const title of titles) {
        const out = await run(["create", title]);
        const key = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(out)?.[1];
        if (key === undefined) throw new Error(`could not parse a task key from: ${out}`);
        keys.push(key);
      }
      return keys;
    };

    const bareCommit = async (ref: string): Promise<string | undefined> => {
      const result = await execa(
        "git",
        ["--git-dir", remoteRepo, "rev-parse", "--verify", ref],
        { env, reject: false },
      );
      return result.exitCode === 0 ? result.stdout.trim() : undefined;
    };

    const bareHasRef = async (ref: string): Promise<boolean> =>
      (await bareCommit(ref)) !== undefined;

    // Working tree, bare remote, origin wiring, then loctt inside it —
    // the withGitLocttRemote recipe, in that order.
    await execa("git", ["init", "--bare", "-q", "-b", "main"], { cwd: remoteRepo, env });
    await execa("git", ["init", "-q", "-b", "main"], { cwd: root, env });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: root, env });
    await execa("git", ["config", "user.name", "Test"], { cwd: root, env });
    await execa("git", ["remote", "add", "origin", remoteRepo], { cwd: root, env });
    await run(["init"]);

    const port = await freePort();
    const baseURL = `http://127.0.0.1:${String(port)}`;
    const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
      cwd: root,
      env,
      reject: false,
    });
    const unregister = registerServerChild(child);

    try {
      await waitForReady(baseURL, 15_000);
      await use({ root, remoteRepo, baseURL, run, seed, git, bareHasRef, bareCommit });
    } finally {
      await killAndWait(child);
      unregister();
      await Promise.all([
        rm(root, { recursive: true, force: true }).catch((err: unknown) => {
          console.error(`git-tracker fixture: failed to remove ${root}: ${String(err)}`);
        }),
        rm(remoteRepo, { recursive: true, force: true }).catch((err: unknown) => {
          console.error(`git-tracker fixture: failed to remove ${remoteRepo}: ${String(err)}`);
        }),
      ]);
    }
  },
});

export { expect } from "@playwright/test";

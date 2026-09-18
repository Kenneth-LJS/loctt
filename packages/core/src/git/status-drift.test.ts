import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { enableGit, getGitStatus } from "./git-mode.js";
import { publish } from "./publish-sync.js";

/**
 * @verifies GIT-C6
 *
 * `getGitStatus` returned a config echo plus an `isGitRepo` boolean. A UI
 * built on it could not answer the two questions a user actually has —
 * "is there anything of mine that isn't published?" and "is there
 * anything out there I don't have?" — and would have announced a remote
 * on a repo with none, since `remote` defaults to `origin` whether or
 * not one is configured.
 *
 * Workspaces live under the OS tmpdir: a `git init` inside LocTT's own
 * checkout resolves to LocTT's `.git`, and `isGitRepo` would be true for
 * the wrong reason.
 */

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const r = roots.pop();
    if (r) await rm(r, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

async function tracker(): Promise<{ root: string; locttDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "loctt-drift-"));
  roots.push(root);
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "commit", "--allow-empty", "-m", "init");
  await initLoctt(root);
  const locttDir = join(root, ".loctt");
  await enableGit(locttDir, root);
  await publish(locttDir, root);
  return { root, locttDir };
}

/** Adds a task, which a publish would carry to the branch. */
async function addTask(locttDir: string, title: string): Promise<void> {
  const state = await loadState(locttDir);
  // The project is required and is keyed by id, so it is read from the
  // config rather than guessed — init's default project id is not a
  // literal a test may assume.
  const projects = await loadProjectsConfig(locttDir);
  const project = projects.projects[0]?.id;
  if (project === undefined) throw new Error("fixture: init created no project");
  await createTask({ locttDir, state, options: { project, title } });
  await saveState(locttDir, state);
}

/** Moves the branch from outside, as another machine's publish would. */
function moveBranch(root: string): void {
  const worktree = join(root, "..", `wt-drift-${process.pid}`);
  git(root, "worktree", "add", "-q", worktree, "loctt");
  try {
    execFileSync("sh", ["-c", "echo '# moved' >> docs/README.md"], { cwd: worktree });
    git(worktree, "add", "-A");
    git(worktree, "commit", "-m", "remote move");
  } finally {
    git(root, "worktree", "remove", "--force", worktree);
  }
}

describe("git status drift", () => {
  it("reports no drift when the workspace matches the branch", async () => {
    const { root, locttDir } = await tracker();
    const status = await getGitStatus(locttDir, root);

    // Zero, not undefined: we checked, and there is nothing pending.
    expect(status.localChanges).toBe(0);
    expect(status.remoteChanges).toBe(false);
  });

  it("counts local work that has not been published", async () => {
    const { root, locttDir } = await tracker();
    await addTask(locttDir, "unpublished");

    const status = await getGitStatus(locttDir, root);
    expect(status.localChanges).toBeGreaterThan(0);
    // Local work must not be mistaken for remote work.
    expect(status.remoteChanges).toBe(false);
  });

  it("reports a branch that moved since the last sync", async () => {
    const { root, locttDir } = await tracker();
    moveBranch(root);

    const status = await getGitStatus(locttDir, root);
    expect(status.remoteChanges).toBe(true);
  });

  it("shows both drift directions at once", async () => {
    const { root, locttDir } = await tracker();
    await addTask(locttDir, "mine");
    moveBranch(root);

    const status = await getGitStatus(locttDir, root);
    // The case's scenario: local edits and a branch that moved. A single
    // "out of sync" flag could not express this.
    expect(status.localChanges).toBeGreaterThan(0);
    expect(status.remoteChanges).toBe(true);
  });

  it("returns to zero local drift after publishing", async () => {
    const { root, locttDir } = await tracker();
    await addTask(locttDir, "will be published");
    expect((await getGitStatus(locttDir, root)).localChanges).toBeGreaterThan(0);

    await publish(locttDir, root);

    // The count has to be reachable: files publish never mirrors
    // (.schema-version, local/, gitignored per-checkout state) would
    // otherwise pin it permanently above zero and make it meaningless.
    expect((await getGitStatus(locttDir, root)).localChanges).toBe(0);
  });

  it("distinguishes a configured remote from the default remote name", async () => {
    const { root, locttDir } = await tracker();

    const before = await getGitStatus(locttDir, root);
    // `remote` carries a name either way, which is exactly the trap.
    expect(before.remote).toBe("origin");
    expect(before.remoteConfigured).toBe(false);

    git(root, "remote", "add", "origin", join(root, "elsewhere.git"));

    const after = await getGitStatus(locttDir, root);
    expect(after.remoteConfigured).toBe(true);
  });

  it("leaves drift undefined rather than zero when git mode is off", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-drift-off-"));
    roots.push(root);
    await initLoctt(root);

    const status = await getGitStatus(join(root, ".loctt"), root);
    // "Nothing to publish" would be a claim we never checked.
    expect(status.localChanges).toBeUndefined();
    expect(status.remoteChanges).toBeUndefined();
    expect(status.remoteConfigured).toBe(false);
  });
});

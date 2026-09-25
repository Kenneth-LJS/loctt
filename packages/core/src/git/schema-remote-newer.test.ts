import { execSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION } from "../schema/index.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState } from "../state/sync.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import {
  GitConflictError,
  GitReconcileNeededError,
  GitRemoteSchemaNewerError,
  publish,
  sync,
} from "./publish-sync.js";

/**
 * GIT-35 (K94): a branch written by a NEWER LocTT than this build (its
 * `.schema-version` strictly greater than local `CURRENT_SCHEMA_VERSION`)
 * must be DETECTED and REFUSED before applying — schema travels via
 * `loctt migrate`, never via sync (invariants.md). The remedy is "upgrade
 * LocTT," and nothing is written.
 */
describe("git-sync newer-remote-schema refusal (GIT-35 / K94)", () => {
  let root: string;
  let locttDir: string;
  let taskProjectId: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    root = await mkdtemp(join(tmpdir(), "loctt-schema-newer-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Advances the `loctt` branch with an ordinary commit that (a) adds a new
   * task, so a plain sync would have work to apply, and (b) writes the given
   * text to `.schema-version` at the branch root. `content === null` deletes
   * the file (simulates a legacy remote that has none). Returns nothing; the
   * base stays an ancestor, so only the schema guard — not the rewrite
   * guard — can fire.
   */
  async function advanceBranchWithSchema(content: string | null): Promise<void> {
    const wt = join(root, `.advance-${Math.random().toString(36).slice(2)}`);
    execSync(`git worktree add ${wt} loctt`, { cwd: root, stdio: "pipe" });
    try {
      const id = "01M0SCHEMA000000000000000EF";
      await mkdir(join(wt, "tasks", id), { recursive: true });
      await writeFile(
        join(wt, "tasks", id, "task.md"),
        `---\nid: ${id}\nkey: T-900\ntitle: Remote task\nstatus: todo\n`
        + `project: ${taskProjectId}\ncreated_at: 2026-01-01T00:00:00Z\n`
        + `updated_at: 2026-01-01T00:00:00Z\n---\nbody\n`,
      );
      if (content === null) {
        execSync("git rm -f --ignore-unmatch .schema-version", { cwd: wt, stdio: "pipe" });
      } else {
        await writeFile(join(wt, ".schema-version"), content);
      }
      execSync("git add -A && git commit -m advance", { cwd: wt, stdio: "pipe" });
    } finally {
      execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
    }
  }

  /** Publishes one task so `last_synced_commit` is set; returns the base. */
  async function publishBase(): Promise<string> {
    const s1 = await loadState(locttDir);
    await createTask({
      locttDir, state: s1, options: { project: taskProjectId, title: "Local work" },
    });
    await saveState(locttDir, s1);
    await publish(locttDir, root);
    const before = await loadSyncState(locttDir);
    return before.git.last_synced_commit as string;
  }

  // @verifies GIT-35
  it("refuses to sync a branch whose schema is CURRENT+1, naming both versions and writing nothing", async () => {
    const base = await publishBase();
    // A local edit made after the base — the work the guard protects.
    await writeFile(join(locttDir, "config", "queries.yaml"), "queries: []\n");
    const localTasksBefore = await readdir(join(locttDir, "tasks"));

    // The branch advances, written by a NEWER LocTT (schema = CURRENT + 1).
    await advanceBranchWithSchema(`${CURRENT_SCHEMA_VERSION + 1}\n`);

    let caught: unknown;
    try {
      await sync(locttDir, root);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitRemoteSchemaNewerError);
    // NOT surfaced as an ordinary conflict / reconcile.
    expect(caught).not.toBeInstanceOf(GitReconcileNeededError);
    expect(caught).not.toBeInstanceOf(GitConflictError);

    const err = caught as GitRemoteSchemaNewerError;
    expect(err.remoteVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(err.localVersion).toBe(CURRENT_SCHEMA_VERSION);
    // The message names BOTH versions and says upgrade (not migrate).
    expect(err.message).toContain(`v${CURRENT_SCHEMA_VERSION + 1}`);
    expect(err.message).toContain(`v${CURRENT_SCHEMA_VERSION}`);
    expect(err.message).toMatch(/upgrade LocTT/i);
    expect(err.message).not.toMatch(/run 'loctt migrate'/i);

    // Nothing was written: the remote-only task was not applied, the guarded
    // edit is intact, and the local schema version is unchanged.
    const localTasksAfter = await readdir(join(locttDir, "tasks"));
    expect(localTasksAfter.sort()).toEqual(localTasksBefore.sort());
    const queries = await readFile(join(locttDir, "config", "queries.yaml"), "utf-8");
    expect(queries).toBe("queries: []\n");
    const localSchema = await readFile(join(locttDir, ".schema-version"), "utf-8");
    expect(localSchema.trim()).toBe(String(CURRENT_SCHEMA_VERSION));

    // last_synced_commit is unchanged — no partial apply.
    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-35
  it("refuses a publish when the branch schema is newer", async () => {
    const base = await publishBase();
    // Local change so the divergence check runs on publish.
    await writeFile(join(locttDir, "config", "queries.yaml"), "queries: []\n");

    await advanceBranchWithSchema(`${CURRENT_SCHEMA_VERSION + 1}\n`);

    await expect(publish(locttDir, root)).rejects.toBeInstanceOf(GitRemoteSchemaNewerError);

    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-35
  it("refuses a branch whose .schema-version is malformed (cannot be proven <= local)", async () => {
    const base = await publishBase();
    await advanceBranchWithSchema("not-a-number\n");

    let caught: unknown;
    try {
      await sync(locttDir, root);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitRemoteSchemaNewerError);
    // Unknown version surfaces as NaN so the message treats it as ahead.
    expect(Number.isNaN((caught as GitRemoteSchemaNewerError).remoteVersion)).toBe(true);

    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-35
  it("proceeds when the branch has NO .schema-version (legacy/older remote)", async () => {
    await publishBase();
    // Remove the file the base publish wrote, and add a remote-only task.
    await advanceBranchWithSchema(null);

    // An absent remote schema is the normal migrate-forward direction, not
    // this guard's job — the sync applies normally.
    const result = await sync(locttDir, root);
    expect(result.updated).toBe(true);
  });

  // @verifies GIT-35
  it("proceeds when the branch schema EQUALS local (ordinary fast-forward)", async () => {
    await publishBase();
    await advanceBranchWithSchema(`${CURRENT_SCHEMA_VERSION}\n`);

    const result = await sync(locttDir, root);
    expect(result.updated).toBe(true);
  });
});

describe("GitRemoteSchemaNewerError message (A346, K129)", () => {
  // "This is not a migration: …" was removed: the recovery (upgrade)
  // already says what to do.
  it("is exactly the cause and the recovery", () => {
    const err = new GitRemoteSchemaNewerError({ remoteVersion: 3, localVersion: 2, branch: "loctt" });
    expect(err.message).toBe(
      "Sync aborted: the loctt branch was written by a newer version of LocTT "
      + "(schema v3), but this installation only understands up to schema v2. "
      + "Applying it could corrupt or drop data, so nothing was written. Your local "
      + "files are untouched.\n\n"
      + "Upgrade LocTT to a version that supports schema v3 or newer, then sync again.",
    );
  });
});

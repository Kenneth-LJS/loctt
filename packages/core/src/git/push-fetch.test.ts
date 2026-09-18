import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import {
  classifyAuthError,
  classifyRemoteFailure,
  commitToLocttBranch,
  fetchLocttBranch,
  publish,
  pushLocttBranch,
  sync,
} from "./publish-sync.js";

describe("classifyRemoteFailure (GIT-29/GIT-30)", () => {
  it("classifies a non-fast-forward push rejection", () => {
    const stderr =
      " ! [rejected]        loctt -> loctt (fetch first)\n"
      + "error: failed to push some refs to 'origin'\n"
      + "hint: Updates were rejected because the remote contains work that you do not have locally.";
    const f = classifyRemoteFailure(stderr, "origin");
    expect(f.kind).toBe("non_fast_forward");
    expect(f.remote).toBe("origin");
    // Class-level summary phrases the remedy; detail keeps git's cause.
    expect(f.summary).toMatch(/moved on/i);
    expect(f.detail).toMatch(/failed to push/i);
  });

  it("classifies an auth failure ahead of the generic 'could not read' tail", () => {
    const stderr =
      "git@github.com: Permission denied (publickey).\n"
      + "fatal: Could not read from remote repository.";
    const f = classifyRemoteFailure(stderr, "origin");
    expect(f.kind).toBe("auth");
    // Auth keeps the classified cause as the detail.
    expect(f.detail).toMatch(/SSH/i);
    expect(f.message).toMatch(/SSH/i);
  });

  it("classifies an unreachable host", () => {
    const f = classifyRemoteFailure(
      "fatal: unable to access 'https://x/': Could not resolve host: example.invalid",
      "backup",
    );
    expect(f.kind).toBe("unreachable");
    expect(f.remote).toBe("backup");
    expect(f.summary).toMatch(/could not be reached/i);
    // Detail keeps git's specific cause (GIT-C4).
    expect(f.detail).toMatch(/resolve host|unable to access/i);
  });

  it("classifies a nonexistent local path remote as unreachable", () => {
    // Git's message for a missing path ends "...and the repository exists."
    const f = classifyRemoteFailure(
      "fatal: '/no/such/path' does not appear to be a git repository\n"
      + "fatal: Could not read from remote repository.",
      "origin",
    );
    expect(f.kind).toBe("unreachable");
  });

  it("falls back to 'other' with the extracted cause for an unrecognised failure", () => {
    const f = classifyRemoteFailure(
      "error: some brand new git failure nobody has classified",
      "origin",
    );
    expect(f.kind).toBe("other");
    expect(f.message).toMatch(/brand new git failure/);
  });
});

describe("classifyAuthError", () => {
  it("classifies SSH publickey rejection", () => {
    const msg = classifyAuthError("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.");
    expect(msg).toBeDefined();
    expect(msg).toMatch(/SSH/i);
    expect(msg).toMatch(/publickey/i);
  });

  it("classifies missing HTTPS credentials", () => {
    const msg = classifyAuthError("fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    expect(msg).toBeDefined();
    expect(msg).toMatch(/credentials/i);
  });

  it("classifies generic authentication failure", () => {
    const msg = classifyAuthError("remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.com/repo.git/'");
    expect(msg).toBeDefined();
    expect(msg).toMatch(/authentication failed/i);
  });

  it("returns undefined for unrelated errors (caller falls through)", () => {
    expect(classifyAuthError("fatal: unable to access '...': Could not resolve host: example.invalid")).toBeUndefined();
    expect(classifyAuthError("error: failed to push some refs to 'origin'")).toBeUndefined();
    expect(classifyAuthError("")).toBeUndefined();
  });
});

describe("commitToLocttBranch + pushLocttBranch", () => {
  let root: string;
  let locttDir: string;
  let bareRemote: string;
  let taskProjectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-push-"));
    bareRemote = await mkdtemp(join(tmpdir(), "loctt-bare-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    execSync(`git init --bare ${bareRemote}`, { stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    const { loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;

    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: taskProjectId, title: "T" } });
    await saveState(locttDir, state);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(bareRemote, { recursive: true, force: true }).catch(() => {});
  });

  it("commitToLocttBranch creates a commit on the loctt branch", async () => {
    const result = await commitToLocttBranch(locttDir, root);
    expect(result.committed).toBe(true);
    expect(result.commit).toBeDefined();
    // verify branch exists
    const out = execSync("git rev-parse --verify loctt", { cwd: root, encoding: "utf-8" });
    expect(out.trim()).toEqual(result.commit);
  });

  it("commitToLocttBranch reports no-op when nothing changed", async () => {
    await commitToLocttBranch(locttDir, root);
    const second = await commitToLocttBranch(locttDir, root);
    expect(second.committed).toBe(false);
  });

  it("pushLocttBranch returns no-remote when remote is missing", () => {
    const r = pushLocttBranch(root, { remote: "origin", branch: "loctt" });
    expect(r.pushed).toBe(false);
    expect(r.skipped).toBe("no-remote");
  });

  it("pushLocttBranch pushes successfully to a configured bare remote", async () => {
    await commitToLocttBranch(locttDir, root);
    execSync(`git remote add origin ${bareRemote}`, { cwd: root, stdio: "pipe" });
    const r = pushLocttBranch(root, { remote: "origin", branch: "loctt" });
    expect(r.pushed).toBe(true);
    // verify the bare remote has the branch
    const out = execSync(`git --git-dir=${bareRemote} rev-parse loctt`, { encoding: "utf-8" });
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it("pushLocttBranch returns error string when remote is unreachable", async () => {
    await commitToLocttBranch(locttDir, root);
    execSync(`git remote add origin /nonexistent/path/${Date.now()}`, { cwd: root, stdio: "pipe" });
    const r = pushLocttBranch(root, { remote: "origin", branch: "loctt" });
    expect(r.pushed).toBe(false);
    expect(typeof r.error).toBe("string");
    // GIT-29: the failure is classified and names the remote.
    expect(r.failure).toBeDefined();
    expect(r.failure?.kind).toBe("unreachable");
    expect(r.failure?.remote).toBe("origin");
  });

  it("fetchLocttBranch returns no-remote when remote missing", () => {
    const r = fetchLocttBranch(root, { remote: "origin", branch: "loctt" });
    expect(r.fetched).toBe(false);
    expect(r.skipped).toBe("no-remote");
  });

  it("pushLocttBranch classifies a non-fast-forward rejection (GIT-29)", async () => {
    // Publish once so the bare remote has the branch.
    await commitToLocttBranch(locttDir, root);
    execSync(`git remote add origin ${bareRemote}`, { cwd: root, stdio: "pipe" });
    expect(pushLocttBranch(root, { remote: "origin", branch: "loctt" }).pushed).toBe(true);

    // Advance the remote branch from a second clone, so our local `loctt`
    // is now behind — the next push is a genuine non-fast-forward.
    const other = await mkdtemp(join(tmpdir(), "loctt-other-"));
    execSync(`git clone --branch loctt ${bareRemote} ${other}`, { stdio: "pipe" });
    execSync("git config user.email o@o.com", { cwd: other, stdio: "pipe" });
    execSync("git config user.name O", { cwd: other, stdio: "pipe" });
    execSync("git commit --allow-empty -m advance", { cwd: other, stdio: "pipe" });
    execSync("git push origin loctt", { cwd: other, stdio: "pipe" });

    // Make a new local commit so there is something to push, then push —
    // it must be rejected non-fast-forward (no --force anywhere).
    await createTask({ locttDir, state: await loadState(locttDir), options: { project: taskProjectId, title: "T2" } });
    await commitToLocttBranch(locttDir, root);
    const r = pushLocttBranch(root, { remote: "origin", branch: "loctt" });
    expect(r.pushed).toBe(false);
    expect(r.failure?.kind).toBe("non_fast_forward");
    expect(r.failure?.remote).toBe("origin");

    await rm(other, { recursive: true, force: true }).catch(() => {});
  });
});

describe("publish() with remote", () => {
  let root: string;
  let locttDir: string;
  let bareRemote: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let taskProjectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-pub-"));
    bareRemote = await mkdtemp(join(tmpdir(), "loctt-bare-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    execSync(`git init --bare ${bareRemote}`, { stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    const { loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;

    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: taskProjectId, title: "T" } });
    await saveState(locttDir, state);

    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(bareRemote, { recursive: true, force: true }).catch(() => {});
  });

  it("skips push silently when no remote is configured", async () => {
    const result = await publish(locttDir, root);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("pushes to remote when configured and auto_push=true", async () => {
    execSync(`git remote add origin ${bareRemote}`, { cwd: root, stdio: "pipe" });
    const result = await publish(locttDir, root);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(stderrSpy).not.toHaveBeenCalled();
    // verify bare remote has the branch
    const out = execSync(`git --git-dir=${bareRemote} rev-parse loctt`, { encoding: "utf-8" });
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it("skips push when auto_push=false", async () => {
    execSync(`git remote add origin ${bareRemote}`, { cwd: root, stdio: "pipe" });
    const state = await loadSyncState(locttDir);
    await saveSyncState(locttDir, { git: { ...state.git, auto_push: false } });
    const result = await publish(locttDir, root);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("warns but does not throw when remote is unreachable; local commit persists", async () => {
    execSync(`git remote add origin /no/such/path/abc-${Date.now()}`, { cwd: root, stdio: "pipe" });
    const result = await publish(locttDir, root);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeDefined();
    // GIT-29: the classified failure rides in the (success) result so the
    // panel can name the remote and branch on the cause.
    expect(result.pushFailure?.kind).toBe("unreachable");
    expect(result.pushFailure?.remote).toBe("origin");
    expect(stderrSpy).toHaveBeenCalled();
    const msg = String(stderrSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/warning: push to origin failed/);
    // local commit still exists on the loctt branch
    const out = execSync("git rev-parse --verify loctt", { cwd: root, encoding: "utf-8" });
    expect(out.trim().length).toBeGreaterThan(0);
  });
});

describe("sync() with remote", () => {
  let root: string;
  let locttDir: string;
  let bareRemote: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-syncr-"));
    bareRemote = await mkdtemp(join(tmpdir(), "loctt-bare-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    execSync(`git init --bare ${bareRemote}`, { stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);

    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(bareRemote, { recursive: true, force: true }).catch(() => {});
  });

  it("skips fetch silently when no remote configured", async () => {
    const result = await sync(locttDir, root);
    expect(result.fetched).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("warns but does not throw when remote unreachable; continues with local branch", async () => {
    execSync(`git remote add origin /no/such/path/abc-${Date.now()}`, { cwd: root, stdio: "pipe" });
    const result = await sync(locttDir, root);
    expect(result.fetched).toBe(false);
    expect(result.fetchError).toBeDefined();
    // GIT-30: classified fetch failure rides in the (success) result.
    expect(result.fetchFailure?.kind).toBe("unreachable");
    expect(result.fetchFailure?.remote).toBe("origin");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("skips fetch when auto_fetch=false", async () => {
    execSync(`git remote add origin ${bareRemote}`, { cwd: root, stdio: "pipe" });
    const state = await loadSyncState(locttDir);
    await saveSyncState(locttDir, { git: { ...state.git, auto_fetch: false } });
    const result = await sync(locttDir, root);
    expect(result.fetched).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

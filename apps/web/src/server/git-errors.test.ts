import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enableGit, initLoctt, publish } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies GIT-C5
 *
 * Every git failure reached the client as the same thing: status 500,
 * `code: git_failed`, `data_state: unknown`, `recovery: retry`. A merge
 * conflict is none of those. It knows nothing was written, retrying
 * reproduces it exactly, and it carries the list of conflicting files —
 * which the handler discarded.
 *
 * `GitConflictError` was also exported from core's git/index.ts but not
 * from the package root, so apps/web could not have distinguished it
 * even if it had tried.
 *
 * Both tests carry an explicit timeout: each runs several real git
 * invocations (init, publish, worktree add/remove) plus an HTTP server,
 * which overruns the 5s default once the rest of apps/web runs alongside.
 */

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

interface Harness {
  root: string;
  base: string;
  stop: () => Promise<void>;
}

const started: Harness[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop();
    if (h) {
      await h.stop();
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

/**
 * A git-backed tracker published to the loctt branch.
 *
 * Created under the OS tmpdir rather than inside the repo: `git init`
 * in a directory under LocTT's own checkout would resolve to LocTT's
 * `.git` and the test would exercise the wrong repository.
 */
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-web-git-"));
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "commit", "--allow-empty", "-m", "init");

  await initLoctt(root);
  const locttDir = join(root, ".loctt");
  // No task needed: the conflict this drives is on config/workflow.yaml,
  // which is the file with no field-level merge rule.
  await enableGit(locttDir, root);
  await publish(locttDir, root);

  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;

  const h: Harness = {
    root,
    base: `http://127.0.0.1:${port}`,
    stop: () => app.stop(),
  };
  started.push(h);
  return h;
}

/**
 * Edits `config/workflow.yaml` on both sides. workflow.yaml has no
 * field-level merge rule, so the merge cannot pick a side and leaves the
 * path unresolved — the one path that still raises GitConflictError now
 * that task frontmatter merges per field.
 */
async function conflictBothSides(root: string): Promise<void> {
  const worktree = join(root, "..", `wt-${Date.now()}`);
  git(root, "worktree", "add", "-q", worktree, "loctt");
  const branchFile = join(worktree, "config/workflow.yaml");
  const branchText = await readFile(branchFile, "utf8");
  await writeFile(branchFile, branchText.replace("unit_label: pts", "unit_label: BRANCH"), "utf8");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", "branch side");
  git(root, "worktree", "remove", "--force", worktree);

  const localFile = join(root, ".loctt/config/workflow.yaml");
  const localText = await readFile(localFile, "utf8");
  await writeFile(localFile, localText.replace("unit_label: pts", "unit_label: LOCAL"), "utf8");
}

describe("web git error classification", () => {
  it("reports a merge conflict as 409 with the conflicting paths", { timeout: 30_000 }, async () => {
    const { root, base } = await harness();
    await conflictBothSides(root);

    const res = await fetch(`${base}/api/git/sync`, {
      method: "POST",
      headers: { "X-Loctt-Client": "test" },
    });

    // 500 said "the server broke"; this is a state the user resolves.
    expect(res.status).toBe(409);
    const body = await res.json() as {
      code: string;
      message: string;
      data_state?: string;
      recovery?: { kind: string };
      failures?: Array<{ ref: string }>;
    };

    expect(body.code).toBe("conflict");
    // The sync aborts before writing; claiming "unknown" would
    // contradict the message's own promise that files are untouched.
    expect(body.data_state).toBe("not_saved");
    // Retrying re-runs the same comparison and conflicts again, so
    // offering a retry button points the user the wrong way.
    expect(body.recovery?.kind).toBe("none");

    // The paths were carried on the error all along and thrown away.
    expect(body.failures?.map(f => f.ref)).toContain("config/workflow.yaml");
  });

  it("still reports a non-conflict git failure as a retryable 500", { timeout: 30_000 }, async () => {
    const { root, base } = await harness();
    // Remove the repository out from under the tracker. Publish then
    // fails for a reason that is genuinely unknown-state (whether the
    // branch moved is unknowable from here) and genuinely retryable
    // once the cause is fixed — the opposite of a conflict on both counts.
    await rm(join(root, ".git"), { recursive: true, force: true });

    const res = await fetch(`${base}/api/git/publish`, {
      method: "POST",
      headers: { "X-Loctt-Client": "test" },
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { code: string; data_state?: string; recovery?: { kind: string } };
    expect(body.code).toBe("git_failed");
    expect(body.data_state).toBe("unknown");
    expect(body.recovery?.kind).toBe("retry");
    // The conflict classification must not swallow every git failure.
    expect(body.code).not.toBe("conflict");
  });

  // @verifies GIT-23
  it("streams NDJSON progress then a terminal result for a multi-file sync", { timeout: 30_000 }, async () => {
    const { root, base } = await harness();

    // Seed several tasks onto the branch so the sync's write phase has a
    // batch of files to apply — the source of the progress ticks.
    const worktree = join(root, "..", `wt-seed-${Date.now()}`);
    git(root, "worktree", "add", "-q", worktree, "loctt");
    const N = 5;
    for (let i = 0; i < N; i += 1) {
      const id = `01WEBSEED${String(i).padStart(18, "0")}`;
      const dir = join(worktree, "tasks", id);
      await import("node:fs/promises").then(m => m.mkdir(dir, { recursive: true }));
      await writeFile(
        join(dir, "task.md"),
        `---\nid: ${id}\nkey: T-${String(200 + i)}\ntitle: Web seed ${String(i)}\n`
        + "status: todo\ncreated_at: 2020-01-01T00:00:00.000Z\n"
        + "updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n",
        "utf8",
      );
    }
    git(worktree, "add", "-A");
    git(worktree, "commit", "-m", "seed tasks");
    git(root, "worktree", "remove", "--force", worktree);

    const res = await fetch(`${base}/api/git/sync`, {
      method: "POST",
      headers: { "X-Loctt-Client": "test" },
    });

    expect(res.status).toBe(200);
    // The transport is NDJSON, not a single JSON body (GIT-23 bullet 1).
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim().length > 0)
      .map(l => JSON.parse(l) as Record<string, unknown>);

    const progressLines = lines.filter(l => "progress" in l);
    const resultLines = lines.filter(l => "result" in l);
    const errorLines = lines.filter(l => "error" in l);

    // Progress was reported, not an indefinite spinner.
    expect(progressLines.length).toBeGreaterThan(0);
    // Exactly one terminal result line, no error line.
    expect(resultLines.length).toBe(1);
    expect(errorLines.length).toBe(0);

    // The terminal result carries the honest counts (GIT-23 bullet 2):
    // it names how many files, and never enumerates 500 keys inline.
    const result = (resultLines[0] as { result: { updated: boolean; copied?: number } }).result;
    expect(result.updated).toBe(true);
    expect(result.copied ?? 0).toBeGreaterThanOrEqual(N);

    // The last progress tick reaches the total, so a client bar lands at
    // 100% rather than stalling short.
    const last = progressLines.at(-1) as { progress: { applied: number; total: number } };
    expect(last.progress.applied).toBe(last.progress.total);
  });
});

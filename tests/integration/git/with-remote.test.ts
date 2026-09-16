import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withGitLocttRemote } from "../fixtures/git-loctt-with-remote.js";

const gitEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

async function bareHasRef(bareRepo: string, ref: string): Promise<boolean> {
  const result = await execa("git", ["--git-dir", bareRepo, "rev-parse", "--verify", ref], { reject: false });
  return result.exitCode === 0;
}

describe("git-backed CLI lifecycle (with remote)", () => {
  it("default auto_push pushes loctt branch to bare remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).toContain("Pushed to remote");

      expect(await bareHasRef(remoteRepo, "loctt")).toBe(true);
    });
  });

  it("auto_push=false skips push to remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["config", "set", "git.auto_push", "false"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).not.toContain("Pushed to remote");

      expect(await bareHasRef(remoteRepo, "loctt")).toBe(false);
    });
  });

  it("auto_fetch on sync picks up out-of-band commits from the bare remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      // Push an out-of-band commit to the bare repo's loctt branch via a
      // temporary clone. This simulates another machine publishing.
      const clone = await mkdtemp(path.join(tmpdir(), "loctt-clone-"));
      try {
        await execa("git", ["clone", "-q", remoteRepo, clone], { env: { ...process.env, ...gitEnv } });
        await execa("git", ["config", "user.email", "test@example.com"], { cwd: clone });
        await execa("git", ["config", "user.name", "Test"], { cwd: clone });
        await execa("git", ["checkout", "-q", "--orphan", "loctt"], { cwd: clone });
        await execa("git", ["rm", "-rfq", "--ignore-unmatch", "."], { cwd: clone, reject: false });
        await writeFile(path.join(clone, "marker.txt"), "from-other-machine\n");
        await execa("git", ["add", "marker.txt"], { cwd: clone });
        await execa("git", ["commit", "-q", "-m", "out-of-band"], { cwd: clone, env: { ...process.env, ...gitEnv } });
        await execa("git", ["push", "-q", "origin", "loctt"], { cwd: clone, env: { ...process.env, ...gitEnv } });
      } finally {
        await rm(clone, { recursive: true, force: true }).catch(() => {});
      }

      const syncResult = await runCli(["git", "sync"], { cwd: root });
      expect(syncResult.exitCode).toBe(0);
      expect(syncResult.stdout).toContain("Fetched from remote");

      // Verify local loctt branch now has the marker file.
      const show = await execa("git", ["show", "loctt:marker.txt"], { cwd: root });
      expect(show.stdout).toContain("from-other-machine");
    });
  });

  it("unreachable remote: publish fails loudly, and the local commit is durable", async () => {
    await withGitLocttRemote(async ({ root }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      await execa("git", ["remote", "set-url", "origin", "/nonexistent/path/repo.git"], { cwd: root });

      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });

      // This test was titled "publish exits 0" and asserted exactly
      // that — encoding GIT-C4's bug as intended behaviour. A push that
      // never reached the remote reported success, so a script checking
      // the exit code saw none of it.
      expect(publish.exitCode).not.toBe(0);
      expect(publish.stderr.toLowerCase()).toContain("warning");
      expect(publish.stdout).not.toContain("Pushed to remote");

      // The half that was always right: the local commit stands, so the
      // user has not lost work and only needs to retry the push.
      const ref = await execa("git", ["rev-parse", "loctt"], { cwd: root });
      expect(ref.stdout).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("custom branch name lands on the configured ref locally and on remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["config", "set", "git.branch", "my-tasks"], { cwd: root })).exitCode).toBe(0);

      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);
      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);

      // local: my-tasks exists, default loctt does not
      const myTasksLocal = await execa("git", ["rev-parse", "--verify", "my-tasks"], { cwd: root, reject: false });
      expect(myTasksLocal.exitCode).toBe(0);
      const locttLocal = await execa("git", ["rev-parse", "--verify", "loctt"], { cwd: root, reject: false });
      expect(locttLocal.exitCode).not.toBe(0);

      // bare: my-tasks present
      expect(await bareHasRef(remoteRepo, "my-tasks")).toBe(true);
      expect(await bareHasRef(remoteRepo, "loctt")).toBe(false);
    });
  });
});

/**
 * Two clones that both create a task now merge (decisions.md §6, M1–M4).
 *
 * This test previously asserted the opposite — that sync aborts — and
 * said in its own comment that it was expected to change when
 * field-level merging landed. It has. What it pins now is that the merge
 * keeps *both* tasks and leaves no ambiguity behind: two projects
 * minting `T-` is exactly the state `createProject` believes impossible,
 * so the merge has to resolve it rather than write it out.
 */
describe("two clones that both create a task", () => {
  it("merges both tasks and leaves keys unambiguous", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "alice task"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);

      // A second, independently-initialised tracker on the same remote.
      const other = await mkdtemp(path.join(tmpdir(), "loctt-clone-b-"));
      try {
        await execa("git", ["init", "-q", "-b", "main"], { cwd: other });
        await execa("git", ["remote", "add", "origin", remoteRepo], { cwd: other });
        expect((await runCli(["init"], { cwd: other })).exitCode).toBe(0);
        expect((await runCli(["git", "enable"], { cwd: other })).exitCode).toBe(0);
        expect((await runCli(["create", "bob task"], { cwd: other })).exitCode).toBe(0);

        const sync = await runCli(["git", "sync"], { cwd: other, env: gitEnv });
        expect(sync.exitCode).toBe(0);

        // Both survive — the whole point of the merge.
        const list = await runCli(["list"], { cwd: other });
        expect(list.stdout).toContain("bob task");
        expect(list.stdout).toContain("alice task");

        // And neither key is ambiguous. Both trackers minted `T-`, so
        // one project takes a provisional prefix; without that, two
        // tasks would answer to `T-1`.
        const keys = [...list.stdout.matchAll(/^(\S+)\s/gm)].map(m => m[1]);
        expect(new Set(keys).size).toBe(keys.length);

        // Each key resolves to exactly one task, including the one that
        // was renumbered.
        for (const key of keys) {
          const show = await runCli(["show", key ?? ""], { cwd: other });
          expect(show.exitCode).toBe(0);
        }

        // The tracker is left in a state doctor considers healthy — a
        // merge that needs a manual repair afterwards has not finished.
        const doctor = await runCli(["doctor"], { cwd: other });
        expect(doctor.stdout).not.toMatch(/not in index/);
      } finally {
        await rm(other, { recursive: true, force: true }).catch(() => {});
      }
    });
  }, 60_000);

  // @verifies GIT-9
  it("auto-applies a same-project rekey and reports old→new on the CLI (K92)", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "base task"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);

      // Clone B shares the SAME project id + key counter — a fresh `init`
      // gets a different project ULID (the reprefix case), so materialise the
      // published tracker instead. The loctt branch tree IS the contents of
      // `.loctt/`, so archive it into the clone's `.loctt/`. This is the
      // same-project key collision K92 is about.
      const other = await mkdtemp(path.join(tmpdir(), "loctt-clone-same-"));
      try {
        await execa("git", ["clone", "-q", remoteRepo, other], { env: gitEnv });
        await execa("git", ["config", "user.email", "test@example.com"], { cwd: other });
        await execa("git", ["config", "user.name", "Test"], { cwd: other });
        await mkdir(path.join(other, ".loctt"), { recursive: true });
        await execa(
          "bash",
          ["-c", `git archive origin/loctt | tar -x -C ${JSON.stringify(path.join(other, ".loctt"))}`],
          { cwd: other },
        );
        // `.schema-version` is NEVER_MIRROR (Q22-adjacent invariant), so it
        // is absent from the branch tree — copy it from the source tracker so
        // the clone is a valid tracker rather than a pre-versioning one.
        await execa("cp", [
          path.join(root, ".loctt", ".schema-version"),
          path.join(other, ".loctt", ".schema-version"),
        ]);
        // The clone already has a `loctt` branch from origin (a working
        // tracker cloned from a published one), so it is already git-backed;
        // seed the local sync state pointing at that branch rather than
        // re-running enable (which guards against adopting an existing
        // branch — GIT-C7). auto_push off so the collision is resolved
        // locally on sync without racing the bare remote.
        await mkdir(path.join(other, ".loctt", "local"), { recursive: true });
        await writeFile(
          path.join(other, ".loctt", "local", "sync.yaml"),
          "git:\n  enabled: true\n  branch: loctt\n  remote: origin\n  auto_fetch: true\n  auto_push: false\n",
        );

        // Each side creates a task offline; both draw the next key from the
        // shared counter → the same key in the same project.
        expect((await runCli(["create", "local next"], { cwd: root })).exitCode).toBe(0);
        expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);
        expect((await runCli(["create", "clone next"], { cwd: other })).exitCode).toBe(0);

        const sync = await runCli(["git", "sync"], { cwd: other, env: gitEnv });
        // CLI auto-applies (no interactive pause) and exits 0.
        expect(sync.exitCode).toBe(0);
        // It names the renumber old → new (GIT-9's CLI half).
        expect(sync.stdout).toMatch(/Renumbered \d+ task\(s\) to resolve key collisions:/);
        expect(sync.stdout).toMatch(/\S+-\d+ → \S+-\d+/);

        // Every key resolves to exactly one task, including the renumbered.
        const list = await runCli(["list"], { cwd: other });
        const keys = [...list.stdout.matchAll(/^(\S+)\s/gm)].map(m => m[1]);
        expect(new Set(keys).size).toBe(keys.length);
        const doctor = await runCli(["doctor"], { cwd: other });
        expect(doctor.stdout).not.toMatch(/not in index/);
      } finally {
        await rm(other, { recursive: true, force: true }).catch(() => {});
      }
    });
  }, 60_000);
});

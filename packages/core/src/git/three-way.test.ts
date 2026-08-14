import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listFiles, listTreePaths, planSync } from "./three-way.js";

describe("three-way", () => {
  let root: string;
  let incoming: string;
  let local: string;

  async function write(dir: string, rel: string, content: string): Promise<void> {
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }

  /** Commits the current `incoming` tree and returns the commit sha. */
  function commitIncoming(message: string): string {
    execSync("git add -A", { cwd: incoming, stdio: "pipe" });
    execSync(`git commit -q -m '${message}'`, { cwd: incoming, stdio: "pipe" });
    return execSync("git rev-parse HEAD", { cwd: incoming, encoding: "utf-8" }).trim();
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-3way-"));
    incoming = join(root, "incoming");
    local = join(root, "local");
    await mkdir(incoming, { recursive: true });
    await mkdir(local, { recursive: true });
    execSync("git init -q", { cwd: incoming, stdio: "pipe" });
    execSync("git config user.email t@t.t", { cwd: incoming, stdio: "pipe" });
    execSync("git config user.name T", { cwd: incoming, stdio: "pipe" });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("listFiles", () => {
    it("returns POSIX-relative paths and honours the exclude set", async () => {
      await write(local, "a.txt", "a");
      await write(local, "nested/b.txt", "b");
      await write(local, "local/secret.txt", "s");

      const files = await listFiles(local, new Set(["local"]));

      expect([...files].sort()).toEqual(["a.txt", "nested/b.txt"]);
    });

    it("returns an empty set for a missing directory", async () => {
      expect((await listFiles(join(root, "nope"), new Set())).size).toBe(0);
    });
  });

  describe("listTreePaths", () => {
    it("returns undefined for an unknown commit rather than an empty set", () => {
      // Critical: an empty set would read as "base had no files", which
      // classifies every local file as a new creation.
      expect(listTreePaths(incoming, "0".repeat(40))).toBeUndefined();
    });
  });

  describe("planSync", () => {
    it("deletes a local file the branch removed since base", async () => {
      await write(incoming, "keep.txt", "k");
      await write(incoming, "gone.txt", "g");
      const base = commitIncoming("base");
      await rm(join(incoming, "gone.txt"));
      commitIncoming("remove gone");

      await write(local, "keep.txt", "k");
      await write(local, "gone.txt", "g");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.deletes.map(d => d.path)).toEqual(["gone.txt"]);
      expect(plan.conflicts).toHaveLength(0);
    });

    it("keeps a local file that did not exist at base", async () => {
      await write(incoming, "shared.txt", "s");
      const base = commitIncoming("base");

      await write(local, "shared.txt", "s");
      await write(local, "mine.txt", "created locally");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.deletes).toHaveLength(0);
      expect(plan.keeps.map(k => k.path)).toContain("mine.txt");
    });

    it("copies a file changed only on the branch", async () => {
      await write(incoming, "f.txt", "original");
      const base = commitIncoming("base");
      await write(incoming, "f.txt", "branch edit");
      commitIncoming("branch edit");

      await write(local, "f.txt", "original");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.copies.map(c => c.path)).toContain("f.txt");
      expect(plan.conflicts).toHaveLength(0);
    });

    it("keeps a file changed only locally", async () => {
      await write(incoming, "f.txt", "original");
      const base = commitIncoming("base");

      await write(local, "f.txt", "local edit");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.keeps.map(k => k.path)).toContain("f.txt");
      expect(plan.copies).toHaveLength(0);
    });

    it("reports a conflict when both sides changed the same file differently", async () => {
      await write(incoming, "f.txt", "original");
      const base = commitIncoming("base");
      await write(incoming, "f.txt", "branch edit");
      commitIncoming("branch edit");

      await write(local, "f.txt", "local edit");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.conflicts.map(c => c.path)).toEqual(["f.txt"]);
    });

    it("treats identical content as no change even when both sides edited it", async () => {
      await write(incoming, "f.txt", "original");
      const base = commitIncoming("base");
      await write(incoming, "f.txt", "same new value");
      commitIncoming("branch edit");

      await write(local, "f.txt", "same new value");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.conflicts).toHaveLength(0);
      expect(plan.copies).toHaveLength(0);
    });

    it("never deletes when no base commit is available", async () => {
      // First-ever sync, or rewritten history: intent is unknowable, so
      // the safe read is "keep everything local".
      await write(incoming, "branch-only.txt", "b");
      commitIncoming("base");
      await write(local, "local-only.txt", "l");

      const plan = await planSync({
        root: incoming, incomingDir: incoming, localDir: local, baseCommit: undefined,
      });

      expect(plan.deletes).toHaveLength(0);
      expect(plan.keeps.map(k => k.path)).toContain("local-only.txt");
      expect(plan.copies.map(c => c.path)).toContain("branch-only.txt");
    });

    it("conflicts rather than guessing when content differs and base is unknown", async () => {
      await write(incoming, "f.txt", "branch");
      commitIncoming("base");
      await write(local, "f.txt", "local");

      const plan = await planSync({
        root: incoming, incomingDir: incoming, localDir: local, baseCommit: undefined,
      });

      expect(plan.conflicts.map(c => c.path)).toEqual(["f.txt"]);
    });

    it("always keeps .schema-version regardless of the branch", async () => {
      await write(incoming, ".schema-version", "999\n");
      const base = commitIncoming("base");
      await write(local, ".schema-version", "1\n");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.copies.map(c => c.path)).not.toContain(".schema-version");
      expect(plan.keeps.map(k => k.path)).toContain(".schema-version");
    });

    it("ignores the local/ directory on both sides", async () => {
      await write(incoming, "local/branch-state.yaml", "x");
      const base = commitIncoming("base");
      await write(local, "local/sync.yaml", "y");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      const touched = [...plan.copies, ...plan.deletes, ...plan.conflicts].map(p => p.path);
      expect(touched.filter(p => p.startsWith("local/"))).toHaveLength(0);
    });

    it("copies a branch file that is absent locally", async () => {
      await write(incoming, "new-from-branch.txt", "n");
      const base = commitIncoming("base");

      const plan = await planSync({ root: incoming, incomingDir: incoming, localDir: local, baseCommit: base });

      expect(plan.copies.map(c => c.path)).toContain("new-from-branch.txt");
    });
  });
});

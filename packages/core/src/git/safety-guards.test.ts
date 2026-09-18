import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveKeyState } from "./merge.js";
import { branchHasForeignContent } from "./publish-sync.js";
import { applyResolution } from "./resolve-conflicts.js";

/**
 * Audit group B: four guards that failed open.
 *
 * Each one turned a failure into a confident wrong answer — the shape
 * that costs most, because nothing reports it and the next step acts on
 * the result.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-safety-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

describe("branchHasForeignContent", () => {
  it("reports the foreign files on a branch it can read", async () => {
    git(dir, "init");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    await writeFile(join(dir, "notes.txt"), "someone's work\n", "utf8");
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "notes");
    git(dir, "branch", "theirs");

    // Guard against the refusal below passing for the wrong reason.
    expect(branchHasForeignContent(dir, "theirs")).toContain("notes.txt");
  });

  it("refuses rather than reporting a branch it cannot read as clean", () => {
    git(dir, "init");
    // No commits, so `ls-tree` on a nonexistent branch fails. The old
    // code read git's empty stdout as "no foreign content" — the answer
    // that lets a publish mirror over whatever is actually there.
    expect(() => branchHasForeignContent(dir, "does-not-exist"))
      .toThrow(/could not read branch/);
  });
});

describe("applyResolution", () => {
  it("creates the destination directory before writing", async () => {
    // `applyPlan` mkdirs before every copy and this path did not, so a
    // displaced file in a directory that does not exist locally threw
    // partway through the loop — leaving some resolutions applied and
    // some not, which the abort-before-writing design exists to prevent.
    await applyResolution(
      {
        merged: [{ path: "tasks/01NEW/task.md", content: "---\nid: x\n---\n" }],
        displaced: [{ path: "tasks/01NEW/task.theirs.md", content: "other\n" }],
        unresolved: [],
      },
      dir,
    );

    const written = await readdir(join(dir, "tasks/01NEW"));
    expect(written.sort()).toEqual(["task.md", "task.theirs.md"]);
  });

  it("still writes into a directory that already exists", async () => {
    await mkdir(join(dir, "tasks/01OLD"), { recursive: true });
    await applyResolution(
      { merged: [{ path: "tasks/01OLD/task.md", content: "ok\n" }], displaced: [], unresolved: [] },
      dir,
    );
    expect(await readdir(join(dir, "tasks/01OLD"))).toEqual(["task.md"]);
  });
});

describe("deriveKeyState", () => {
  const state = (keys: Record<string, { prefix: string; next_number: number }>) =>
    ({ keys }) as unknown as import("@loctt/contracts").LocttState;

  it("derives a prefix recorded on either side", () => {
    const out = deriveKeyState(
      state({ p1: { prefix: "T", next_number: 3 } }),
      state({ p1: { prefix: "T", next_number: 5 } }),
      [],
    );
    expect(out.keys["p1"]?.prefix).toBe("T");
  });

  it("refuses to derive an empty prefix", () => {
    // `?? ""` produced one when neither side recorded a prefix, and the
    // derived state is written to state.yaml without a schema pass — so
    // a sync could report success and leave a tracker that cannot boot.
    expect(() => deriveKeyState(
      state({ p1: { prefix: "", next_number: 1 } }),
      state({ p1: { prefix: "", next_number: 1 } }),
      [],
    )).toThrow(/neither side records a key prefix/);
  });
});

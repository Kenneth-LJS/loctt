import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { runCli } from "../adapters/cli-spawn.js";

/**
 * V4: pre-flight runs under `--dry-run` and a real sync, and a real
 * sync refuses on failure.
 *
 * The same function backs both, so a dry run that passes followed by a
 * publish that refuses cannot happen — which would make the dry run
 * worse than useless.
 *
 * The severity split is what these mostly guard. An unreadable file
 * blocks: mirroring it to a branch other machines sync from turns one
 * machine's damage into everyone's. A malformed *entry* does not: it is
 * kept and merged (P-11), the data is intact, and blocking would make
 * one hand-edit typo render the tracker unpublishable.
 *
 * Runs outside the repo tree — `withTmpLoctt` puts workspaces under
 * `tests/workspace/`, where `isGitRepo` walks up and finds LocTT's own
 * `.git`.
 */

let root: string;

async function commentsFile(): Promise<string> {
  const tasksDir = path.join(root, ".loctt/tasks");
  const [taskDir] = await readdir(tasksDir);
  if (taskDir === undefined) throw new Error("no task directory");
  return path.join(tasksDir, taskDir, "_comments.yaml");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "loctt-preflight-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await runCli(["init", "--project-label", "Web", "--prefix", "T"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  await runCli(["git", "enable"], { cwd: root });
  await runCli(["create", "a task"], { cwd: root });
  await runCli(["comment", "T1", "first comment"], { cwd: root });
});

afterEach(async () => {
  await chmod(await commentsFile(), 0o644).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("--dry-run reports without publishing", () => {
  it("reports a clean tracker and says a publish would proceed", async () => {
    const r = await runCli(["git", "publish", "--dry-run"], { cwd: root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/no problems/i);
  });

  it("does not actually publish", async () => {
    await runCli(["git", "publish", "--dry-run"], { cwd: root });
    // A dry run that publishes is not a dry run.
    const branches = execFileSync("git", ["branch", "--list", "loctt"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(branches.trim()).toBe("");
  });

  it("names an unreadable file and says a publish would be refused", async () => {
    await chmod(await commentsFile(), 0o000);
    const r = await runCli(["git", "publish", "--dry-run"], { cwd: root });

    expect(r.stdout).toContain("_comments.yaml");
    expect(r.stdout).toMatch(/would be refused/i);
    expect(r.exitCode).not.toBe(0);
  });
});

describe("a real publish refuses what pre-flight blocks", () => {
  it("publishes normally when the tracker is clean", async () => {
    const r = await runCli(["git", "publish"], { cwd: root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Published local state/);
  });

  it("refuses when a file cannot be read", async () => {
    await chmod(await commentsFile(), 0o000);
    const r = await runCli(["git", "publish"], { cwd: root });

    // The finding this guards: publishing a file nobody could read
    // mirrors it to a branch other machines sync from.
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/pre-flight/i);
  });

  it("leaves the branch untouched when it refuses", async () => {
    await chmod(await commentsFile(), 0o000);
    await runCli(["git", "publish"], { cwd: root });

    const branches = execFileSync("git", ["branch", "--list", "loctt"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(branches.trim()).toBe("");
  });

  it("agrees with --dry-run, so the two cannot drift", async () => {
    await chmod(await commentsFile(), 0o000);
    const dry = await runCli(["git", "publish", "--dry-run"], { cwd: root });
    const real = await runCli(["git", "publish"], { cwd: root });

    // Both refuse, or the dry run is misleading in the one direction
    // that matters.
    expect(dry.exitCode).not.toBe(0);
    expect(real.exitCode).not.toBe(0);
  });
});

describe("a malformed entry is reported but never blocks", () => {
  async function insertMalformedComment(): Promise<void> {
    const file = await commentsFile();
    const raw = parseYaml(await readFile(file, "utf-8")) as { comments: unknown[] };
    raw.comments.push({ note: "hand-edited, not a comment" });
    await writeFile(file, stringifyYaml(raw), "utf-8");
  }

  it("is reported by --dry-run", async () => {
    await insertMalformedComment();
    const r = await runCli(["git", "publish", "--dry-run"], { cwd: root });
    expect(r.stdout).toContain("_comments.yaml");
  });

  it("says a publish would still proceed", async () => {
    await insertMalformedComment();
    const r = await runCli(["git", "publish", "--dry-run"], { cwd: root });
    expect(r.stdout).toMatch(/would proceed/i);
    expect(r.exitCode).toBe(0);
  });

  it("does not stop a real publish", async () => {
    await insertMalformedComment();
    const r = await runCli(["git", "publish"], { cwd: root });

    // One hand-edit typo must not make the tracker unpublishable —
    // that is destruction by another route (P-11).
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Published local state/);
  });
});

describe("doctor reports the same findings", () => {
  it("flags an unreadable file as an error", async () => {
    await chmod(await commentsFile(), 0o000);
    const r = await runCli(["doctor"], { cwd: root });
    expect(`${r.stdout}${r.stderr}`).toContain("_comments.yaml");
  });

  it("reports a clean tracker as having no integrity problems", async () => {
    const r = await runCli(["doctor"], { cwd: root });
    expect(r.stdout).toMatch(/no unreadable files or malformed entries/i);
  });
});

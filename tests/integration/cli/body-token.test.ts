import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * K10: the body-write precondition reaches the CLI.
 *
 * Ken's ruling splits the surfaces — the CLI stays last-write-wins by
 * default so existing scripts are unchanged, with `--expect` as the
 * per-command opt-in and `cli.require_body_token` as the workspace one.
 *
 * Every assertion here reads the body off disk rather than trusting the
 * command's own exit code: a guard that reports a refusal while still
 * writing is the exact failure this is supposed to prevent, and only
 * the file can tell those apart.
 */

/** The body as it actually sits on disk, frontmatter stripped. */
async function bodyOnDisk(root: string): Promise<string> {
  const dir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  const ids = await readdir(dir);
  const id = ids[0];
  if (id === undefined) throw new Error("no task on disk");
  const raw = await readFile(path.join(dir, id, "task.md"), "utf-8");
  const end = raw.indexOf("\n---", 3);
  return raw.slice(raw.indexOf("\n", end + 1) + 1);
}

async function token(root: string): Promise<string> {
  const r = await runCli(["body", "T-1", "--token"], { cwd: root });
  expect(r.exitCode).toBe(0);
  const t = r.stdout.trim();
  // Positive control: a blank stdout would make every "stale token"
  // assertion below pass for the wrong reason.
  expect(t).toMatch(/^[0-9a-f]{16}$/);
  return t;
}

describe("CLI body-write precondition (K10)", () => {
  it("a current token writes; the body on disk is the new text", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });

      const t = await token(root);
      const w = await runCli(
        ["body", "T-1", "--expect", t, "--set", "accepted"],
        { cwd: root },
      );
      expect(w.exitCode).toBe(0);
      expect(await bodyOnDisk(root)).toContain("accepted");
    });
  });

  it("a stale token is refused and the file is left unchanged", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });

      const stale = await token(root);
      // Someone else writes in between — this is the race the guard exists for.
      await runCli(["body", "T-1", "--set", "theirs"], { cwd: root });

      const w = await runCli(
        ["body", "T-1", "--expect", stale, "--set", "mine"],
        { cwd: root },
      );
      expect(w.exitCode).toBe(1);
      expect(w.stderr).toContain("NOT been saved");

      const disk = await bodyOnDisk(root);
      expect(disk).toContain("theirs");
      expect(disk).not.toContain("mine");
    });
  });

  it("--expect guards --append too, not just --set", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });

      const stale = await token(root);
      await runCli(["body", "T-1", "--set", "theirs"], { cwd: root });

      const w = await runCli(
        ["body", "T-1", "--expect", stale, "--append", "appended"],
        { cwd: root },
      );
      expect(w.exitCode).toBe(1);
      expect(await bodyOnDisk(root)).not.toContain("appended");

      // And the current token lets the same append through, so the
      // refusal above is the guard and not a broken append path.
      const fresh = await token(root);
      const ok = await runCli(
        ["body", "T-1", "--expect", fresh, "--append", "appended"],
        { cwd: root },
      );
      expect(ok.exitCode).toBe(0);
      expect(await bodyOnDisk(root)).toContain("appended");
    });
  });

  it("without --expect the write still clobbers — last-write-wins is the CLI default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      await token(root); // read a token, then deliberately do not pass it

      const w = await runCli(["body", "T-1", "--set", "clobbered"], { cwd: root });
      expect(w.exitCode).toBe(0);
      expect(await bodyOnDisk(root)).toContain("clobbered");
    });
  });

  it("cli.require_body_token refuses a write that carries no --expect", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });

      const wf = path.join(root, ".loctt", "config", "workflow.yaml");
      const before = await readFile(wf, "utf-8");
      await writeFile(wf, `${before}\ncli:\n  require_body_token: true\n`);

      const refused = await runCli(["body", "T-1", "--set", "sneaky"], { cwd: root });
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain("require_body_token");
      expect(await bodyOnDisk(root)).not.toContain("sneaky");

      // Configured on, a correct token still writes.
      const ok = await runCli(
        ["body", "T-1", "--expect", await token(root), "--set", "allowed"],
        { cwd: root },
      );
      expect(ok.exitCode).toBe(0);
      expect(await bodyOnDisk(root)).toContain("allowed");
    });
  });

  it("a broken workflow.yaml does not block an ordinary body write", async () => {
    // A regression I introduced and caught: reading workflow.yaml to
    // decide the opt-in made a malformed config fail a `--set` that
    // has never needed that file. The setting defaults to off, so an
    // unreadable config must answer "not configured", not explode.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const wf = path.join(root, ".loctt", "config", "workflow.yaml");
      await writeFile(wf, `${await readFile(wf, "utf-8")}\nbogus: [[[\n`);

      const w = await runCli(["body", "T-1", "--set", "written anyway"], { cwd: root });
      expect(w.exitCode).toBe(0);
      expect(await bodyOnDisk(root)).toContain("written anyway");
    });
  });

  it("--token cannot be combined with a write", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const r = await runCli(["body", "T-1", "--token", "--set", "x"], { cwd: root });
      expect(r.exitCode).toBe(2);
      expect(await bodyOnDisk(root)).not.toContain("x");
    });
  });
});

import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

async function findAttachment(root: string, name: string): Promise<string | null> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const entries = await readdir(tasksDir);
  for (const id of entries) {
    const p = path.join(tasksDir, id, "attachments", name);
    try {
      await stat(p);
      return p;
    } catch {
      // not here
    }
  }
  return null;
}

describe("MCP attach_file (stdio)", () => {
  it("attaches a file by absolute path", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "attachable"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "spec.txt");
      await writeFile(sourcePath, "spec body\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed["name"]).toBe("spec.txt");
        expect(typeof parsed["size"]).toBe("number");
        expect(parsed["overwritten"]).toBe(false);
        expect(parsed["task_key"]).toBe("T-1");

        expect(await findAttachment(root, "spec.txt")).not.toBeNull();
      } finally {
        await client.close();
      }

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("returns isError on collision without force", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "collide"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "doc.txt");
      await writeFile(sourcePath, "x\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const first = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(first.isError).toBeFalsy();

        const second = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(second.isError).toBe(true);
        const text = second.content[0]?.text ?? "";
        expect(text).toContain("already exists");
        expect(text).toContain("force");
      } finally {
        await client.close();
      }

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("overwrites with force: true", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "overwrite"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "doc.txt");
      await writeFile(sourcePath, "first\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const first = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(first.isError).toBeFalsy();

        await writeFile(sourcePath, "second longer content\n", "utf8");
        const second = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
          force: true,
        });
        expect(second.isError).toBeFalsy();
        const parsed = JSON.parse(second.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["overwritten"]).toBe(true);
      } finally {
        await client.close();
      }

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("refuses a source_path outside the tracker root (F1)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "confine"], { cwd: root });

      // A concrete outside path: a file in the OS temp dir, not under root.
      const outsideDir = await mkdtemp(path.join(tmpdir(), "loctt-mcp-outside-"));
      const outside = path.join(outsideDir, "id_rsa");
      await writeFile(outside, "SENSITIVE\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: outside,
        });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toMatch(/outside the tracker/);
        // Actionable: names the tracker root to stage into.
        expect(text).toContain(root);
        // Nothing was copied in.
        expect(await findAttachment(root, "id_rsa")).toBeNull();
      } finally {
        await client.close();
      }
      await rm(outsideDir, { recursive: true, force: true });
    });
  });

  it("auto-commits the attachment when git-backed mode is enabled", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      await runCli(["create", "committed"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "committed.txt");
      await writeFile(sourcePath, "commit me\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["committed"]).toBe(true);
      } finally {
        await client.close();
      }
      // The loctt branch now carries the attachment.
      const lsTree = execaSync("git", ["ls-tree", "-r", "--name-only", "loctt"], { cwd: root });
      expect(lsTree.stdout).toMatch(/attachments\/committed\.txt/);

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  // Regression (review-caught): auto-commit is best-effort. When git is on
  // but publish() refuses — here because a reconcile sentinel is present, so
  // publish throws GitReconcileInterruptedError — the attach has ALREADY
  // landed and must be reported as committed:false + a note, NOT as a tool
  // error. The earlier catch block enumerated only some git-sync subtypes
  // (it listed GitReconcileNeededError but NOT GitReconcileInterruptedError,
  // and not PreflightError) and re-threw the rest, turning a successful
  // attach into a failure.
  it("still succeeds (committed:false + note) when auto-commit is blocked (reconcile in progress)", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      await runCli(["create", "attachable"], { cwd: root });

      // A reconcile sentinel makes publish() throw GitReconcileInterruptedError
      // (publish-sync.ts: readReconcileState !== undefined). This is a real
      // "publish refuses" state that is NOT in the old catch allowlist.
      await writeFile(
        path.join(root, ".loctt", "local", "reconcile.yaml"),
        "mode: sync\nbase_commit: deadbeef\nremote_commit: cafebabe\nstarted_at: 2026-01-01T00:00:00Z\n",
        "utf8",
      );

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "bestreffort.txt");
      await writeFile(sourcePath, "store me even if commit is blocked\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        // The attach is NOT an error, even though the commit was blocked.
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["committed"]).toBe(false);
        expect(typeof parsed["commit_note"]).toBe("string");
        expect(parsed["commit_note"] as string).toMatch(/not committed/i);
      } finally {
        await client.close();
      }
      // And the attachment genuinely landed on disk.
      expect(await findAttachment(root, "bestreffort.txt")).not.toBeNull();

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("does NOT commit (or init git) when git-backed mode is off", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "uncommitted"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "loose.txt");
      await writeFile(sourcePath, "just on disk\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
        // No git → no `committed` field at all, and the file is on disk.
        expect(parsed["committed"]).toBeUndefined();
        expect(await findAttachment(root, "loose.txt")).not.toBeNull();
      } finally {
        await client.close();
      }
      // We never initialised git.
      await expect(stat(path.join(root, ".git"))).rejects.toThrow();

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("rejects a relative source_path with a clear message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "reject relative"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: "relative/path.txt",
        });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text.toLowerCase()).toContain("absolute");
      } finally {
        await client.close();
      }
    });
  });
});

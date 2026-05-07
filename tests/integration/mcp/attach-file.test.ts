import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

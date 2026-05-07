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

describe("MCP detach_file (stdio)", () => {
  it("detaches a previously attached file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "detach happy"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "notes.txt");
      await writeFile(sourcePath, "x\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const attach = await client.callTool("attach_file", {
          ref: "T-1",
          source_path: sourcePath,
        });
        expect(attach.isError).toBeFalsy();
        expect(await findAttachment(root, "notes.txt")).not.toBeNull();

        const detach = await client.callTool("detach_file", {
          ref: "T-1",
          name: "notes.txt",
        });
        expect(detach.isError).toBeFalsy();
        const text = detach.content[0]?.text ?? "";
        expect(text).toContain("Detached notes.txt");
        expect(text).toContain("T-1");

        expect(await findAttachment(root, "notes.txt")).toBeNull();
      } finally {
        await client.close();
      }

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("returns isError when the attachment does not exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "detach missing"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("detach_file", {
          ref: "T-1",
          name: "ghost.txt",
        });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("not found");
      } finally {
        await client.close();
      }
    });
  });
});

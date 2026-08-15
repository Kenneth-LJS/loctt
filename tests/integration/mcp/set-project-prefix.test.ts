import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C10, PRU-C11
 *
 * `set_project_prefix` over real MCP stdio, against a tracker the CLI
 * created — the cross-surface case that matters, since an agent renames
 * keys a human is still reading.
 */
describe("MCP set_project_prefix (stdio)", () => {
  it("renames every task and reports the count", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["create", "two"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("set_project_prefix", {
          project: "Tasks",
          prefix: "WEB-",
          confirm: true,
        });
        expect(res.isError).toBeFalsy();
        const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
          from: string; to: string; renamed: number;
        };
        expect(payload).toMatchObject({ from: "T-", to: "WEB-", renamed: 2 });
      } finally {
        await client.close();
      }

      // The CLI must see what the agent did — same files, same keys.
      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("WEB-1");
      expect(list.stdout).not.toContain("T-1");
    });
  });

  it("refuses without confirm, leaving every key untouched", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("set_project_prefix", {
          project: "Tasks",
          prefix: "WEB-",
        });
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toMatch(/confirm/i);
      } finally {
        await client.close();
      }

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("T-1");
    });
  });

  it("refuses a prefix another project holds", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["project", "create", "API", "--prefix", "API-"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("set_project_prefix", {
          project: "Tasks",
          prefix: "API-",
          confirm: true,
        });
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toContain("API-");
      } finally {
        await client.close();
      }

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("T-1");

      // Refused before any write (PRU-C11): a downstream schema check
      // also rejects the duplicate, but only after the counter has been
      // rewritten and the crash sentinel dropped.
      const state = await readFile(join(root, ".loctt", "state.yaml"), "utf-8");
      expect(state).toContain("prefix: T-");
      await expect(
        readFile(join(root, ".loctt", "local", "prefix-rename.yaml"), "utf-8"),
      ).rejects.toThrow();
    });
  });

  it("resolves a stale key an agent still holds in its context", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        await client.callTool("set_project_prefix", {
          project: "Tasks", prefix: "WEB-", confirm: true,
        });
        // An agent that read T-1 before the rename must not get a
        // not-found on its next call.
        const got = await client.callTool("get_task", { ref: "T-1" });
        expect(got.isError).toBeFalsy();
        expect(got.content[0]?.text ?? "").toContain("WEB-1");
      } finally {
        await client.close();
      }
    });
  });
});

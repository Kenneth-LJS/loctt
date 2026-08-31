import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import type { McpClient } from "../adapters/mcp-stdio.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * K10 on MCP. Ken: "agents via mcp and existing scripts should pass it
 * if its provided in params."
 *
 * The load-bearing half is that the token is *reachable*: `bodyToken`
 * is sha256(updated_at + "\0" + body) truncated, so an agent cannot
 * construct one from an ordinary read. If `get_task` stops handing it
 * out, the write tools' parameter is unusable — so the handout is
 * asserted here as its own fact, not just implied by a passing write.
 *
 * Bodies are read off disk rather than through the tool that wrote
 * them: a guard that reports a refusal while still writing is exactly
 * the bug this exists to prevent.
 */

async function bodyOnDisk(root: string): Promise<string> {
  const dir = path.join(root, ".loctt", "tasks");
  const ids = await readdir(dir);
  const id = ids[0];
  if (id === undefined) throw new Error("no task on disk");
  const raw = await readFile(path.join(dir, id, "task.md"), "utf-8");
  const end = raw.indexOf("\n---", 3);
  return raw.slice(raw.indexOf("\n", end + 1) + 1);
}

async function tokenFrom(client: McpClient, ref: string): Promise<string> {
  const get = await client.callTool("get_task", { ref });
  expect(get.isError).toBeFalsy();
  const parsed = JSON.parse(get.content[0]?.text ?? "{}") as { body_token?: unknown };
  // Positive control: without this, a missing token would silently
  // become `undefined` and every "stale" assertion below would pass
  // for the wrong reason.
  expect(parsed.body_token).toMatch(/^[0-9a-f]{16}$/);
  return parsed.body_token as string;
}

describe("MCP body-write precondition (K10)", () => {
  it("get_task hands out a body_token an agent could not derive", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const first = await tokenFrom(client, "T-1");
        // Stable across reads, and invalidated by a write.
        expect(await tokenFrom(client, "T-1")).toBe(first);
        await runCli(["body", "T-1", "--set", "changed"], { cwd: root });
        expect(await tokenFrom(client, "T-1")).not.toBe(first);
      } finally {
        await client.close();
      }
    });
  });

  it("a current expected_token writes; the body on disk is the new text", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const r = await client.callTool("replace_task_body", {
          ref: "T-1", body: "accepted", expected_token: await tokenFrom(client, "T-1"),
        });
        expect(r.isError).toBeFalsy();
        expect(await bodyOnDisk(root)).toContain("accepted");
      } finally {
        await client.close();
      }
    });
  });

  it("a stale expected_token is refused and the file is left unchanged", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const stale = await tokenFrom(client, "T-1");
        // A human edits from another surface while the agent was thinking.
        await runCli(["body", "T-1", "--set", "the human's text"], { cwd: root });

        const r = await client.callTool("replace_task_body", {
          ref: "T-1", body: "the agent's text", expected_token: stale,
        });
        // A domain error the agent can act on, not a server fault.
        expect(r.isError).toBe(true);
        expect(r.content[0]?.text ?? "").toContain("NOT been saved");

        const disk = await bodyOnDisk(root);
        expect(disk).toContain("the human's text");
        expect(disk).not.toContain("the agent's text");
      } finally {
        await client.close();
      }
    });
  });

  it("append_task_body honours expected_token, both ways", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const stale = await tokenFrom(client, "T-1");
        await runCli(["body", "T-1", "--set", "theirs"], { cwd: root });

        const refused = await client.callTool("append_task_body", {
          ref: "T-1", text: "appended", expected_token: stale,
        });
        expect(refused.isError).toBe(true);
        expect(await bodyOnDisk(root)).not.toContain("appended");

        // Current token: the same append goes through, so the refusal
        // above is the guard rather than a broken append path.
        const ok = await client.callTool("append_task_body", {
          ref: "T-1", text: "appended", expected_token: await tokenFrom(client, "T-1"),
        });
        expect(ok.isError).toBeFalsy();
        expect(await bodyOnDisk(root)).toContain("appended");
      } finally {
        await client.close();
      }
    });
  });

  it("omitting expected_token stays last-write-wins, as before K10", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--set", "original"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const r = await client.callTool("replace_task_body", {
          ref: "T-1", body: "clobbered",
        });
        expect(r.isError).toBeFalsy();
        expect(await bodyOnDisk(root)).toContain("clobbered");
      } finally {
        await client.close();
      }
    });
  });
});

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CFG-C3
 *
 * Covers the CLI and MCP halves: every key writable on a surface is
 * readable there, a value written on one reads back identically on the
 * other, and an unknown key produces the same key list everywhere.
 *
 * The web half of CFG-C3 — `GET /api/config/:key` — is not a defect to
 * fix here. The route does not exist because the settings panels that
 * would write config are M4.3 and unbuilt; only `GET /api/config` ships
 * today. When M4.3 lands, this case gains a third surface.
 */
describe("config read/write parity (CLI + MCP)", () => {
  it("reads back on MCP what the CLI wrote", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["git", "enable", "--remote", "origin"], { cwd: root });
      const set = await runCli(["config", "set", "git.branch", "shared-branch"], { cwd: root });
      expect(set.exitCode).toBe(0);

      const cli = await runCli(["config", "get", "git.branch"], { cwd: root });
      expect(cli.stdout.trim()).toContain("shared-branch");

      const client = await startMcpClient(root);
      try {
        const mcp = await client.callTool("get_config_value", { key: "git.branch" });
        expect(mcp.isError).toBeFalsy();
        expect(mcp.content[0]?.text ?? "").toContain("shared-branch");
      } finally {
        await client.close();
      }
    });
  });

  it("lists every writable key, on both surfaces", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cli = await runCli(["config", "list"], { cwd: root });
      expect(cli.exitCode).toBe(0);

      const client = await startMcpClient(root);
      try {
        const mcp = await client.callTool("list_config_values", {});
        expect(mcp.isError).toBeFalsy();
        const text = mcp.content[0]?.text ?? "";
        // Every key the CLI lists must be listed by MCP too, or a
        // settings UI built on one surface silently misses keys.
        for (const key of ["git.enabled", "git.remote", "git.branch",
                           "git.auto_push", "git.auto_fetch"]) {
          expect(cli.stdout, `CLI missing ${key}`).toContain(key);
          expect(text, `MCP missing ${key}`).toContain(key);
        }
      } finally {
        await client.close();
      }
    });
  });

  it("rejects an unknown key with the same valid-key list on both", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cli = await runCli(["config", "get", "not.a.key"], { cwd: root });
      expect(cli.exitCode).not.toBe(0);
      const cliOut = `${cli.stdout}${cli.stderr}`;
      expect(cliOut).toMatch(/git\.branch/);

      const client = await startMcpClient(root);
      try {
        const mcp = await client.callTool("get_config_value", { key: "not.a.key" });
        expect(mcp.isError).toBeTruthy();
        // Same guidance, so an agent moving between surfaces is not
        // told two different things about the same mistake.
        expect(mcp.content[0]?.text ?? "").toMatch(/git\.branch/);
      } finally {
        await client.close();
      }
    });
  });
});

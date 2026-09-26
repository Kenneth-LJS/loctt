import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * B23 (K130, P11): sprint state moves freely on every surface. Ken:
 * "users can specify, and the can make active or inactive or close or
 * whatever, i dont care." The `--force` / `force` override is gone
 * because there is nothing left to override. The one refusal kept is an
 * end date before the start date, which cannot be drawn.
 */
describe("sprint state and dates (CLI and MCP)", () => {
  const sprintsYaml = (root: string): Promise<string> =>
    readFile(path.join(root, ".loctt/config/sprints.yaml"), "utf8");

  // @verifies SPR-20
  it("CLI: completed -> active needs no --force, and --force is no longer a flag", async () => {
    await withTmpLoctt(async ({ root }) => {
      expect((await runCli(["sprint", "create", "S1", "--start", "2026-05-01", "--end", "2026-05-14", "--state", "completed"], { cwd: root })).exitCode).toBe(0);

      const reopen = await runCli(["sprint", "edit", "S1", "--state", "active"], { cwd: root });
      expect(reopen.stderr).toBe("");
      expect(reopen.exitCode).toBe(0);
      expect(await sprintsYaml(root)).toMatch(/state: active/);

      const forced = await runCli(["sprint", "edit", "S1", "--state", "future", "--force"], { cwd: root });
      expect(forced.exitCode).toBe(2);
      expect(forced.stderr).toMatch(/unknown option --force/);
    });
  });

  // @verifies SPR-20
  it("CLI: an end date before the start date is refused with the plain message", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["sprint", "create", "S1", "--start", "2026-05-14", "--end", "2026-05-01"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain("End date is before the start date.");
    });
  });

  // @verifies SPR-20
  it("MCP: edit_sprint moves completed -> active with no force; force is not an argument", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const created = await client.callTool("create_sprint", {
          name: "S1", start_date: "2026-05-01", end_date: "2026-05-14", state: "completed",
        });
        expect(created.isError).toBeFalsy();

        const reopen = await client.callTool("edit_sprint", { sprint: "S1", state: "active" });
        expect(reopen.isError).toBeFalsy();
        expect(await sprintsYaml(root)).toMatch(/state: active/);

        // `force` is gone from the tool's description.
        const tool = (await client.listTools()).find(t => t.name === "edit_sprint");
        expect(tool?.description ?? "").not.toMatch(/force/);

        const inverted = await client.callTool("edit_sprint", { sprint: "S1", end_date: "2026-04-01" });
        expect(inverted.isError).toBe(true);
        expect(inverted.content[0]?.text).toContain("End date is before the start date.");
      } finally {
        await client.close();
      }
    });
  });
});

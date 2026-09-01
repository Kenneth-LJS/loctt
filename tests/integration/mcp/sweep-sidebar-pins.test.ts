import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP's surface of the pin sweep (SET-13, SET-27).
 *
 * The third surface Ken's layer rule requires: core holds the sweep,
 * the CLI has `user settings --sweep-pins`, and this is the tool.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("MCP sweep_sidebar_pins (stdio)", () => {
  // @verifies SET-27
  it("reports the removed pin ids and rewrites settings.yaml", async () => {
    await withTmpLoctt(async ({ root }) => {
      const file = await settingsPath(root);
      await writeFile(file, "sidebar_pins:\n  - v_gone\n", "utf8");

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("sweep_sidebar_pins", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as {
          removed: string[]; kept: string[]; changed: boolean;
        };
        // The id is reported, not merely absent from `kept`.
        expect(payload.removed).toEqual(["v_gone"]);
        expect(payload.kept).toEqual([]);
        expect(payload.changed).toBe(true);
      } finally {
        await client.close();
      }

      expect(await readFile(file, "utf8")).toContain("sidebar_pins: []");
    });
  });

  // @verifies SET-11
  it("get_user_settings returns the stored personal settings", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(await settingsPath(root), "theme: dark\n", "utf8");
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_user_settings", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as {
          settings: Record<string, unknown>;
        };
        expect(payload.settings["theme"]).toBe("dark");
      } finally {
        await client.close();
      }
    });
  });
});

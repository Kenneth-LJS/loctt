import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * An unreadable `settings.yaml` over MCP (B56, G12). The MCP half of
 * DEG-C9: reads return the defaults, a write is an error naming the
 * file, and the file is left as it is.
 */

const BROKEN = "theme: [dark\nkeyboard_shortcuts:\n  disabled: [new-task]\n";

async function breakSettings(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  const file = path.join(usersDir, String(id), "settings.yaml");
  await writeFile(file, BROKEN, "utf-8");
  return file;
}

describe("MCP with an unreadable settings.yaml (stdio)", () => {
  // @verifies DEG-C9
  it("reads the defaults from every settings tool", async () => {
    await withTmpLoctt(async ({ root }) => {
      await breakSettings(root);
      const client = await startMcpClient(root);
      try {
        const settings = await client.callTool("get_user_settings", {});
        expect(settings.isError).toBeFalsy();
        expect((JSON.parse(String(settings.content[0]?.text)) as { settings: unknown }).settings).toEqual({});

        const groups = await client.callTool("get_sidebar_groups", {});
        expect(groups.isError).toBeFalsy();
        const groupsPayload = JSON.parse(String(groups.content[0]?.text)) as { stored: { order?: unknown; hidden?: unknown } };
        expect(groupsPayload.stored.order).toBeUndefined();
        expect(groupsPayload.stored.hidden).toBeUndefined();

        const shortcuts = await client.callTool("get_keyboard_shortcuts", {});
        expect(shortcuts.isError).toBeFalsy();
        expect((JSON.parse(String(shortcuts.content[0]?.text)) as { single_key: boolean }).single_key).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies DEG-C9
  it("refuses a settings write with an error naming the file, leaving it as it is", async () => {
    await withTmpLoctt(async ({ root }) => {
      const file = await breakSettings(root);
      const client = await startMcpClient(root);
      try {
        for (const [tool, args] of [
          ["set_sidebar_groups", { hidden: ["sprints"] }],
          ["set_sidebar_groups", { reset: true }],
          ["set_keyboard_shortcuts", { off: ["new-task"] }],
        ] as const) {
          const result = await client.callTool(tool, args);
          expect(result.isError, tool).toBe(true);
          expect(String(result.content[0]?.text)).toContain("settings.yaml");
          expect(String(result.content[0]?.text)).toContain("weren't saved");
          expect(await readFile(file, "utf-8")).toBe(BROKEN);
        }
      } finally {
        await client.close();
      }
    });
  });
});

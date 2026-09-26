import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP's surface of the Keyboard switches (K133, A11Y-43): the third
 * surface of Ken's layer rule, beside the web editor and
 * `loctt user shortcuts`.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

interface Payload {
  stored: { single_key?: boolean; disabled?: string[] };
  single_key: boolean;
  shortcuts: { id: string; keys: string[]; on: boolean; active: boolean }[];
}

describe("MCP keyboard shortcuts (stdio)", () => {
  // @verifies PRU-C14
  it("get_keyboard_shortcuts returns every shortcut on by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_keyboard_shortcuts", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as Payload;
        expect(payload.single_key).toBe(true);
        expect(payload.shortcuts.map(s => s.id)).toContain("goto");
        expect(payload.shortcuts.every(s => s.on && s.active)).toBe(true);
        expect(payload.shortcuts.find(s => s.id === "goto")?.keys).toEqual(["g l", "g b", "g t"]);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies PRU-C14
  // @verifies A11Y-43
  it("set_keyboard_shortcuts writes the switches and returns the resolved state", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_keyboard_shortcuts", { off: ["cycle-theme"] });
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as Payload;
        expect(payload.stored).toEqual({ disabled: ["cycle-theme"] });
        expect(payload.shortcuts.find(s => s.id === "cycle-theme")?.active).toBe(false);
        expect(payload.shortcuts.find(s => s.id === "new-task")?.active).toBe(true);

        const off = await client.callTool("set_keyboard_shortcuts", { single_key: false });
        const offPayload = JSON.parse(String(off.content[0]?.text)) as Payload;
        expect(offPayload.single_key).toBe(false);
        expect(offPayload.shortcuts.every(s => !s.active)).toBe(true);
      } finally {
        await client.close();
      }
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("single_key: false");
      expect(file).toContain("cycle-theme");
    });
  });

  // @verifies PRU-C14
  it("rejects an unknown id with an error naming it, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_keyboard_shortcuts", { off: ["goto", "bogus"] });
        expect(result.isError).toBe(true);
        expect(String(result.content[0]?.text)).toContain("bogus");
        const read = await client.callTool("get_keyboard_shortcuts", {});
        const payload = JSON.parse(String(read.content[0]?.text)) as Payload;
        expect(payload.stored).toEqual({});
      } finally {
        await client.close();
      }
    });
  });

  // @verifies PRU-C14
  it("reset turns everything back on, and cannot be combined", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "theme: dark\nkeyboard_shortcuts:\n  single_key: false\n  disabled: [goto]\n",
        "utf8",
      );
      const client = await startMcpClient(root);
      try {
        const bad = await client.callTool("set_keyboard_shortcuts", { reset: true, off: ["goto"] });
        expect(bad.isError).toBe(true);
        const result = await client.callTool("set_keyboard_shortcuts", { reset: true });
        const payload = JSON.parse(String(result.content[0]?.text)) as Payload;
        expect(payload.single_key).toBe(true);
        expect(payload.shortcuts.every(s => s.active)).toBe(true);
      } finally {
        await client.close();
      }
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).not.toContain("keyboard_shortcuts");
      expect(file).toContain("theme: dark");
    });
  });
});

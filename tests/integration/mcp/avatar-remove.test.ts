import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-31
 *
 * Avatar removal is a core capability (`updateUser({ removeAvatar })`)
 * and the layer rule says it must reach CLI and MCP, not just the web
 * DELETE route. These are the far-end surface checks: after a remove,
 * `profile.yaml` carries no `avatar` key and the file is gone from
 * disk — asserted for both `loctt user edit --remove-avatar` and the
 * MCP `edit_user` tool's `remove_avatar`.
 *
 * Setting the avatar first goes through the CLI's `--avatar`, which is
 * the real server pipeline (`copyAvatar`): validate, resize to 500px,
 * re-encode JPEG, record in `profile.yaml`.
 */

/** Writes a real PNG to disk and returns its path. */
async function makePng(root: string, name: string): Promise<string> {
  const p = path.join(root, name);
  const buf = await sharp({
    create: { width: 120, height: 120, channels: 3, background: "#4477aa" },
  }).png().toBuffer();
  await writeFile(p, buf);
  return p;
}

/** The active user's id from `user list` (marked with `*`). */
async function currentUserId(root: string): Promise<string> {
  const out = (await runCli(["user", "list"], { cwd: root })).stdout;
  const m = /^([0-9A-HJKMNP-TV-Z]{26})\s*\*/m.exec(out);
  if (m?.[1] === undefined) throw new Error(`no current user in:\n${out}`);
  return m[1];
}

async function avatarState(
  root: string,
  userId: string,
): Promise<{ recorded: string | undefined; fileExists: boolean }> {
  const dir = path.join(root, ".loctt", "users", userId);
  const profile = await readFile(path.join(dir, "profile.yaml"), "utf8");
  const recorded = /^avatar:\s*(\S+)\s*$/m.exec(profile)?.[1];
  const fileExists = recorded === undefined
    ? false
    : await stat(path.join(dir, recorded)).then(() => true).catch(() => false);
  return { recorded, fileExists };
}

describe("avatar removal across surfaces (spawned binary + MCP stdio)", () => {
  it("CLI: user edit --remove-avatar clears profile.yaml and the file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Ken", "--switch"], { cwd: root });
      const id = await currentUserId(root);
      const png = await makePng(root, "a.png");

      const set = await runCli(["user", "edit", id, "--avatar", png], { cwd: root });
      expect(set.exitCode).toBe(0);
      let state = await avatarState(root, id);
      expect(state.recorded).toBe("avatar.jpg");
      expect(state.fileExists).toBe(true);

      const removed = await runCli(["user", "edit", id, "--remove-avatar"], { cwd: root });
      expect(removed.exitCode).toBe(0);
      state = await avatarState(root, id);
      expect(state.recorded).toBeUndefined();
      expect(state.fileExists).toBe(false);
    });
  });

  it("CLI: --avatar and --remove-avatar together is a usage error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Ken", "--switch"], { cwd: root });
      const id = await currentUserId(root);
      const png = await makePng(root, "a.png");
      const res = await runCli(
        ["user", "edit", id, "--avatar", png, "--remove-avatar"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(2);
      expect(`${res.stdout}${res.stderr}`).toMatch(/mutually exclusive/i);
    });
  });

  it("MCP: edit_user remove_avatar clears profile.yaml and the file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Ken", "--switch"], { cwd: root });
      const id = await currentUserId(root);
      const png = await makePng(root, "a.png");
      // Set via CLI (MCP does not set avatars), then remove via MCP.
      await runCli(["user", "edit", id, "--avatar", png], { cwd: root });
      expect((await avatarState(root, id)).fileExists).toBe(true);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("edit_user", { ref: id, remove_avatar: true });
        const profile = JSON.parse(result.content[0]?.text ?? "{}") as { avatar?: string };
        expect(profile.avatar).toBeUndefined();
      } finally {
        await client.close();
      }

      const state = await avatarState(root, id);
      expect(state.recorded).toBeUndefined();
      expect(state.fileExists).toBe(false);
    });
  });
});

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * F2/F3: backup and restore are the import/export boundary tools whose
 * paths are intentionally NOT confined — the guard is a `confirm: true`
 * gate so an auto-approved agent cannot cross the tracker boundary
 * silently (write the whole tracker out / read+overwrite from an
 * arbitrary file). A `dry_run` restore writes nothing and needs no
 * confirm.
 */
describe("MCP backup/restore confirm gate (stdio)", () => {
  it("refuses backup without confirm, and nothing is written", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "backable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("backup", { output: "backup.jsonl" });
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toMatch(/confirm/i);
        // No file was written.
        await expect(stat(path.join(root, "backup.jsonl"))).rejects.toThrow();
      } finally {
        await client.close();
      }
    });
  });

  it("writes the backup with confirm: true", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "backable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("backup", {
          output: "backup.jsonl",
          confirm: true,
        });
        expect(res.isError).toBeFalsy();
        const st = await stat(path.join(root, "backup.jsonl"));
        expect(st.isFile()).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("refuses a real (non-dry-run) restore without confirm", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "seed"], { cwd: root });
      // Make a real backup to restore from.
      const client = await startMcpClient(root);
      try {
        const bk = await client.callTool("backup", {
          output: "backup.jsonl",
          confirm: true,
        });
        expect(bk.isError).toBeFalsy();

        // A bare restore into this (now non-empty) tracker would fail on
        // its own merits, but the confirm gate fires FIRST — before any
        // read/write — so the message is about confirm, not the tracker.
        const res = await client.callTool("restore", {
          files: ["backup.jsonl"],
          mode: "overwrite",
        });
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toMatch(/confirm/i);
      } finally {
        await client.close();
      }
    });
  });

  it("allows a dry_run restore without confirm (writes nothing)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "seed"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const bk = await client.callTool("backup", {
          output: "backup.jsonl",
          confirm: true,
        });
        expect(bk.isError).toBeFalsy();

        const res = await client.callTool("restore", {
          files: ["backup.jsonl"],
          mode: "overwrite",
          dry_run: true,
        });
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["dryRun"]).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("performs a real restore with confirm: true (overwrite mode)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "seed"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const bk = await client.callTool("backup", {
          output: "backup.jsonl",
          confirm: true,
        });
        expect(bk.isError).toBeFalsy();

        const res = await client.callTool("restore", {
          files: ["backup.jsonl"],
          mode: "overwrite",
          confirm: true,
        });
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["dryRun"]).toBe(false);
        expect(parsed["mode"]).toBe("overwrite");
        // The tracker still holds its task after the round-trip.
        const tasksDir = path.join(root, ".loctt", "tasks");
        const ids = await readdir(tasksDir);
        expect(ids.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    });
  });
});

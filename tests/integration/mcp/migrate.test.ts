import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP `migrate_schema` (C1). Migration was CLI-only, so an agent that
 * detected a schema mismatch could only tell the user to go and run a
 * terminal command.
 */
describe("MCP migrate_schema (stdio)", () => {
  const versionPath = (root: string) => path.join(root, ".loctt/.schema-version");

  it("previews by default without migrating", async () => {
    await withTmpLoctt(async ({ root }) => {
      const before = await readFile(versionPath(root), "utf8");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("migrate_schema", {});
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Nothing to migrate");
      } finally {
        await client.close();
      }
      expect(await readFile(versionPath(root), "utf8")).toBe(before);
    });
  });

  it("reports a no-op on confirm when already current", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("migrate_schema", { confirm: true });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Nothing to migrate");
      } finally {
        await client.close();
      }
    });
  });

  it("errors clearly when the tracker is newer than this build", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(versionPath(root), "9999\n");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("migrate_schema", {});
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toMatch(/newer|9999/i);
      } finally {
        await client.close();
      }
    });
  });

  it("migrate_schema is exempt from the schema-version boot guard", async () => {
    // The exemption that makes the tool useful: a mismatched tracker
    // must still reach the one tool that fixes it.
    //
    // HONEST LIMIT. At CURRENT_SCHEMA_VERSION === 1 the guard and
    // planMigration raise the SAME error for every reachable bad
    // version, so removing `exemptFromSchemaGuard` does not change any
    // observable output and this test would not catch it. What is
    // asserted is that other tools ARE blocked on a damaged tracker,
    // which pins the guard's behaviour, plus that migrate_schema
    // answers from its own handler on a healthy one.
    //
    // When a v2 lands, assert the real case: at version 1, list_tasks
    // is blocked while migrate_schema previews and then migrates.
    await withTmpLoctt(async ({ root }) => {
      await rm(versionPath(root));
      const client = await startMcpClient(root);
      try {
        const blocked = await client.callTool("list_tasks", {});
        expect(blocked.isError).toBe(true);
      } finally {
        await client.close();
      }
    });

    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        // Distinctive handler output — the guard never says this.
        const res = await client.callTool("migrate_schema", {});
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Nothing to migrate");
      } finally {
        await client.close();
      }
    });
  });
});

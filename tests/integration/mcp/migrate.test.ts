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
      await writeFile(versionPath(root), "9.9.9\n");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("migrate_schema", {});
        expect(res.isError).toBe(true);
        expect(res.content[0]?.text ?? "").toContain("This tracker needs loctt 9.9.9 or newer.");
      } finally {
        await client.close();
      }
    });
  });

  it("migrate_schema is exempt from the schema-version boot guard", async () => {
    // The exemption that makes the tool useful, and (since K143) what
    // keeps it a preview: on a 0.1.0 tracker every other tool upgrades
    // on first use, so a guarded migrate_schema would find nothing left
    // to preview. Exempt, it shows the plan and changes nothing; a
    // confirm then upgrades.
    await withTmpLoctt(async ({ root }) => {
      await writeFile(versionPath(root), "0.1.0\n");
      const client = await startMcpClient(root);
      try {
        const plan = await client.callTool("migrate_schema", {});
        expect(plan.isError).toBeFalsy();
        expect(plan.content[0]?.text ?? "").toContain("Plan: 0.1.0 → 0.3.0 (1 step(s)).");
        expect((await readFile(versionPath(root), "utf8")).trim()).toBe("0.1.0");

        const done = await client.callTool("migrate_schema", { confirm: true });
        expect(done.content[0]?.text ?? "").toContain("Migrated 0.1.0 → 0.3.0.");
        expect((await readFile(versionPath(root), "utf8")).trim()).toBe("0.3.0");
      } finally {
        await client.close();
      }
    });

    // A damaged tracker still blocks the other tools.
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
  });
});

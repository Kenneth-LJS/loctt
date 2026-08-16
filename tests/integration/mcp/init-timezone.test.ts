import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies ONB-C2
 *
 * `--timezone` was CLI-only. The zone decides what "today" means for
 * every date query and is workspace-shared, so an agent initialising for
 * a team in another zone silently recorded the server machine's.
 */
describe("MCP init honours timezone", () => {
  it("records the requested zone in calendar.yaml", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        // Deliberately not this machine's zone: the first version of
        // this test used Asia/Singapore, which happens to be the dev
        // machine's, so it passed with the parameter ignored entirely.
        const zone = "America/Argentina/Ushuaia";
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe(zone);

        const res = await client.callTool("init", { timezone: zone });
        expect(res.isError, res.content[0]?.text).toBeFalsy();

        const cal = await readFile(path.join(root, ".loctt/config/calendar.yaml"), "utf-8");
        expect(cal).toContain(zone);
      } finally {
        await client.close();
      }
    }, { init: false });
  });

  it("rejects an invalid zone by name, creating nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("init", { timezone: "Not/AZone" });
        expect(res.isError).toBeTruthy();
        expect(res.content[0]?.text ?? "").toMatch(/Not\/AZone/);
      } finally {
        await client.close();
      }
    }, { init: false });
  });

  it("accepts every flag the CLI documents", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        // Parity cannot silently regress. Asserted by *calling* with
        // every documented flag rather than reading the schema: the
        // stdio adapter does not expose inputSchema, and a tool that
        // accepts a parameter and ignores it would pass a shape check
        // anyway — which is exactly how timezone was broken.
        const res = await client.callTool("init", {
          prefix: "Z-",
          project_label: "Parity",
          no_docs: true,
          timezone: "America/Argentina/Ushuaia",
        });
        expect(res.isError, res.content[0]?.text).toBeFalsy();

        const projects = await readFile(path.join(root, ".loctt/config/projects.yaml"), "utf-8");
        expect(projects).toContain("Parity");
        expect(projects).toContain("Z-");

        const cal = await readFile(path.join(root, ".loctt/config/calendar.yaml"), "utf-8");
        expect(cal).toContain("America/Argentina/Ushuaia");
      } finally {
        await client.close();
      }
    }, { init: false });
  });
});

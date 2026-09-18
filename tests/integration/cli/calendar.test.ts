import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CFG-C5
 *
 * `loctt calendar set timezone UTC` is a reasonable thing to try, and it
 * used to answer with a bare `Usage: loctt calendar show`. That reads as
 * "you got the syntax wrong" and sends the user hunting for the right
 * flags — but the calendar simply is not writable from the CLI, so the
 * next attempt would have failed the same way. The exit code was already
 * correct; only the explanation was missing.
 */
describe("CLI calendar (spawned binary)", () => {
  it("shows the calendar fields", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["calendar", "show"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Timezone:/);
      expect(result.stdout).toMatch(/First day of week:/);
      expect(result.stdout).toMatch(/Working days:/);
      expect(result.stdout).toMatch(/Holidays:/);
    });
  });

  it("explains that writes are unavailable rather than only printing usage", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["calendar", "set", "timezone", "UTC"], { cwd: root });
      expect(result.exitCode).toBe(2);
      const err = result.stderr;
      expect(err).toMatch(/read-only/i);
      // Naming the editable surface is the half that turns "no" into
      // "here instead" — without it the user has nowhere to go.
      expect(err).toMatch(/web UI/i);
    });
  });

  it("agrees with the MCP get_calendar description about where it is editable", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cli = await runCli(["calendar", "set", "timezone", "UTC"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const tools = await client.listTools();
        const getCalendar = tools.find(t => t.name === "get_calendar");
        expect(getCalendar).toBeDefined();
        const description = getCalendar?.description ?? "";

        // Both surfaces must say read-only, and both must point at the
        // UI. Asserting the agreement — rather than each string on its
        // own — is what catches one being reworded without the other.
        for (const text of [cli.stderr, description]) {
          expect(text).toMatch(/read-only/i);
          expect(text).toMatch(/UI/);
        }
      } finally {
        await client.close();
      }
    });
  });
});

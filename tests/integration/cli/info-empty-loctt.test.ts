import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * An **empty** `.loctt/` is not a tracker, and must not be reported as
 * one that "predates schema versioning".
 *
 * Measured before the fix: `loctt info` on a directory containing only
 * an empty `.loctt/` printed `Schema: not recorded — this tracker
 * predates schema versioning`, whose attached remedy is `migrate` —
 * which has nothing to migrate. Core now distinguishes the states
 * (`initState`), and the layer rule says both surfaces get it, not
 * just the web.
 */
describe("info on an empty .loctt directory", () => {
  it("tells the CLI user it is not a tracker yet, and names init as the remedy", async () => {
    await withTmpLoctt(async ({ root }) => {
      await mkdir(path.join(root, ".loctt"));
      const res = await runCli(["info"], { cwd: root });
      expect(res.exitCode).toBe(0);
      const out = `${res.stdout}${res.stderr}`;
      expect(out).toMatch(/empty \.loctt directory/i);
      expect(out).toMatch(/not a tracker yet/i);
      expect(out).toMatch(/loctt init/);
      // The wrong diagnosis must be gone: `migrate` cannot help here,
      // and "predates schema versioning" says a version once existed.
      expect(out).not.toMatch(/predates schema versioning/i);
      expect(out).not.toMatch(/loctt migrate/);
    }, { init: false });
  });

  it("tells an MCP agent the same thing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await mkdir(path.join(root, ".loctt"));
      const client = await startMcpClient(root);
      let out: string;
      try {
        const res = await client.callTool("info", {});
        out = res.content.map(c => c.text ?? "").join("\n");
      } finally {
        await client.close();
      }
      expect(out).toMatch(/empty \.loctt directory/i);
      expect(out).toMatch(/not a tracker yet/i);
      expect(out).toMatch(/loctt init/);
      expect(out).not.toMatch(/predates schema versioning/i);
    }, { init: false });
  });

  it("still reports a healthy tracker normally", async () => {
    // Positive control: the branch above must not swallow the real
    // summary. Without this, deleting the whole `info` body would
    // leave both assertions above passing.
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["info"], { cwd: root });
      expect(res.stdout).toMatch(/Schema: 1/);
      expect(res.stdout).not.toMatch(/not a tracker yet/i);
    });
  });
});

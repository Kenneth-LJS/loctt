import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies ONB-C7
 *
 * `doctor` returned human prose, so an agent deciding whether to proceed
 * had to substring-match "[error]" inside a sentence. That silently stops
 * working the moment the wording changes — and the failure mode is the
 * dangerous direction: a reworded message reads as healthy.
 *
 * The previous test here asserted the prose shape ("returns prose
 * diagnostic output"), which is the contract being replaced. It survived
 * the change only because the check names still appear inside the JSON.
 */
interface DoctorResult {
  healthy: boolean;
  counts: { ok: number; warn: number; error: number };
  checks: Array<{ name: string; status: string; message: string }>;
}

describe("MCP doctor (stdio)", () => {
  it("reports a healthy tracker as structured data", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("doctor", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as DoctorResult;

        expect(parsed.healthy).toBe(true);
        expect(parsed.counts.error).toBe(0);
        expect(parsed.checks.length).toBeGreaterThan(0);
        // The checks a caller might branch on are still named.
        expect(parsed.checks.map(c => c.name)).toContain("workflow.yaml");
      } finally {
        await client.close();
      }
    });
  });

  it("is distinguishable from a healthy run without reading the messages", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Unparseable YAML: a real way a tracker breaks, and one the
      // guard cannot repair on its own.
      await writeFile(
        path.join(root, ".loctt/config/workflow.yaml"),
        "statuses: [broken\n",
        "utf8",
      );

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("doctor", {});
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as DoctorResult;

        // The whole point: no substring matching required.
        expect(parsed.healthy).toBe(false);
        expect(parsed.counts.error).toBeGreaterThan(0);
        expect(parsed.checks.some(c => c.status === "error")).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("does not call a tracker unhealthy over warnings alone", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("doctor", {});
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as DoctorResult;

        // A fresh tracker warns (no tasks yet, so the key index is
        // empty). If warnings counted as unhealthy, `healthy` would be
        // false on a brand-new tracker and an agent would refuse to
        // work on it.
        expect(parsed.counts.warn).toBeGreaterThan(0);
        expect(parsed.healthy).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});

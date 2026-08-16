import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { WorkflowConfigSchema } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CFG-C4
 *
 * CFG-C4: an agent and a human must be told the same thing about the same
 * mistake, and `get_workflow_config` must hand the agent the whole config
 * rather than the subset an older UI happened to need.
 *
 * The pass-through half is the fragile one. `get_workflow_config`
 * currently serialises the parsed config wholesale, so it is correct by
 * construction — but a future "return just what the UI reads" narrowing
 * would be invisible to every other test in this suite, because the
 * shipped default workflow.yaml declares neither `boards` nor
 * `estimation.weights`. This test writes a config that does.
 */

/**
 * Declares every optional block the case names. `scale` is dropped
 * because it is orthogonal to `custom_enum`, and `boards` is an object
 * with a `columns` array — not an array itself.
 */
async function enrichWorkflow(root: string): Promise<void> {
  const file = path.join(root, ".loctt/config/workflow.yaml");
  const original = await readFile(file, "utf8");
  const enriched = original
    .replace(
      /estimation:\n(?:  .*\n)*/,
      [
        "estimation:",
        "  enabled: true",
        "  unit: custom_enum",
        "  unit_label: pts",
        "  preset_values: [S, M, L]",
        "  weights:",
        "    S: 1",
        "    M: 3",
        "    L: 5",
        "",
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To Do",
        "      statuses: [backlog]",
        "",
      ].join("\n"),
    );
  // Guard the regex above: a reshaped default file would otherwise leave
  // the config unchanged and the assertions below would pass vacuously.
  if (!enriched.includes("weights:") || !enriched.includes("boards:")) {
    throw new Error("fixture did not apply — workflow.yaml layout changed");
  }
  await writeFile(file, enriched, "utf8");
}

describe("MCP config parity with the CLI (stdio)", () => {
  it("gives the same git-not-enabled guidance the CLI gives", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cli = await runCli(["config", "set", "git.branch", "foo"], { cwd: root });
      expect(cli.exitCode).not.toBe(0);
      const cliText = `${cli.stdout}${cli.stderr}`;
      expect(cliText).toMatch(/loctt git enable/);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_config_value", {
          key: "git.branch",
          value: "foo",
        });
        // The failure being guarded: an agent told only "failed" has no
        // way to discover that git mode is the missing precondition.
        expect(result.isError).toBe(true);
        const mcpText = result.content[0]?.text ?? "";
        expect(mcpText).toMatch(/git mode is not enabled/);
        expect(mcpText).toMatch(/loctt git enable/);
      } finally {
        await client.close();
      }
    });
  });

  it("lists the accepted boolean literals when a value will not parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_config_value", {
          key: "git.auto_push",
          value: "maybe",
        });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        // Naming the accepted literals is what lets an agent retry
        // without a second round-trip to the docs.
        expect(text).toContain("true/false/1/0/yes/no");
        expect(text).toContain("git.auto_push");
      } finally {
        await client.close();
      }
    });
  });

  it("returns boards, weights, timeline and relationship kind without stripping", async () => {
    await withTmpLoctt(async ({ root }) => {
      await enrichWorkflow(root);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_config", {});
        expect(result.isError).toBeFalsy();
        const config = JSON.parse(result.content[0]?.text ?? "{}") as {
          boards?: { columns?: Array<{ key: string }> };
          estimation?: { weights?: Record<string, number> };
          timeline?: { dependency_relationship?: string };
          relationships?: Array<{ key: string; kind?: string }>;
        };

        expect(config.boards?.columns?.[0]?.key).toBe("todo");
        expect(config.estimation?.weights).toEqual({ S: 1, M: 3, L: 5 });
        expect(config.timeline?.dependency_relationship).toBe("blocks");

        // Without `kind`, an agent has to infer "symmetric" from the
        // absence of `inverse` — which is also how a malformed
        // directional relationship looks.
        const relatesTo = config.relationships?.find(r => r.key === "relates_to");
        expect(relatesTo?.kind).toBe("symmetric");

        // The whole object must survive a round-trip, so an agent can
        // read it, edit one field, and write it back.
        expect(() => WorkflowConfigSchema.parse(config)).not.toThrow();
      } finally {
        await client.close();
      }
    });
  });
});

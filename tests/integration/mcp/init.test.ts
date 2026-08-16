import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP init (stdio)", () => {
  it("initializes a fresh workspace at the bound root", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("init", {});
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("Initialized");

        const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
        expect(workflow.isFile()).toBe(true);
      } finally {
        await client.close();
      }
    }, { init: false });
  });

  // @verifies ONB-C1
  it("honours project_label and prefix, and keys state.yaml to the project id", async () => {
    // project_label reached core as `projectLabel`, which InitOptions
    // does not have, so it was dropped on every surface. This asserts
    // MCP parity with the CLI rather than trusting that one shared
    // call site behaves the same from both.
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("init", {
          project_label: "Bug tracker",
          prefix: "BUG-",
        });
        expect(result.isError).toBeFalsy();

        const projects = await readFile(
          path.join(root, ".loctt/config/projects.yaml"),
          "utf8",
        );
        expect(projects).toContain("Bug tracker");
        expect(projects).not.toContain("Tasks");
        expect(projects).toContain("BUG-");

        // The key counter is keyed by project id, not name — so a
        // renamed project keeps allocating from the same counter.
        const id = /id:\s*(\S+)/.exec(projects)?.[1];
        expect(id).toBeDefined();
        const state = await readFile(path.join(root, ".loctt/state.yaml"), "utf8");
        expect(state).toContain(id!);
      } finally {
        await client.close();
      }
    }, { init: false });
  });
});

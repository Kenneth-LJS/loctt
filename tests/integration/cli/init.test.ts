import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI init (spawned binary)", () => {
  it("initializes a fresh workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["init"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized");

      const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
      expect(workflow.isFile()).toBe(true);
    }, { init: false });
  });

  // B22 (K129): "just ignore, proceed with steps." An empty `.loctt/`
  // is set up like a missing one, with no `--repair` and no refusal.
  // @verifies ONB-16
  it("initializes over an empty .loctt straight through", async () => {
    await withTmpLoctt(async ({ root }) => {
      await mkdir(path.join(root, ".loctt"));
      const result = await runCli(["init", "--prefix", "WEB"], { cwd: root });
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized");
      const info = await runCli(["info"], { cwd: root });
      expect(info.exitCode).toBe(0);
      expect(info.stdout).toContain("WEB-");
    }, { init: false });
  });

  // @verifies ONB-16
  it("MCP init sets up an empty .loctt too", async () => {
    await withTmpLoctt(async ({ root }) => {
      await mkdir(path.join(root, ".loctt"));
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("init", { prefix: "WEB" });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text).toContain("Initialized");
      } finally {
        await client.close();
      }
      const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
      expect(workflow.isFile()).toBe(true);
    }, { init: false });
  });

  it("respects a custom prefix", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["init", "--prefix", "BUG"], { cwd: root });
      expect(result.exitCode).toBe(0);

      const info = await runCli(["info"], { cwd: root });
      expect(info.exitCode).toBe(0);
      expect(info.stdout).toContain("BUG-");
    }, { init: false });
  });

  // @verifies ONB-C1
  it("names the starting project from --project-label", async () => {
    // The flag was read and then dropped: core's option is
    // `projectName`, and every surface passed `projectLabel`, which
    // `InitOptions` does not have. It cost nothing at the type level
    // because a conditional spread is not excess-property-checked, and
    // no test anywhere mentioned the flag.
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["init", "--project-label", "Bug tracker"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);

      const projects = await readFile(
        path.join(root, ".loctt/config/projects.yaml"),
        "utf8",
      );
      expect(projects).toContain("Bug tracker");
      expect(projects).not.toContain("Tasks");
    }, { init: false });
  });

  it("defaults the project name when --project-label is omitted", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["init"], { cwd: root });
      const projects = await readFile(
        path.join(root, ".loctt/config/projects.yaml"),
        "utf8",
      );
      expect(projects).toContain("Tasks");
    }, { init: false });
  });
});

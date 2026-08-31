import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * K3 / A60. The slug is a core schema change, so under the layer rule
 * it owes CLI and MCP too: both must accept a slug wherever they accept
 * a project, and an unresolvable slug must say so rather than silently
 * widening to every project.
 */
describe("project slugs across CLI and MCP", () => {
  it("CLI writes a slug on create and accepts it as a project ref", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Web App", "--prefix", "WEB-"], { cwd: root });

      const yaml = await readFile(
        join(root, ".loctt", "config", "projects.yaml"),
        "utf8",
      );
      expect(yaml).toContain("slug: web-app");

      // Addressed by slug, not ULID: the task lands in that project.
      const created = await runCli(
        ["create", "Slug addressed", "--project", "web-app"],
        { cwd: root },
      );
      expect(created.stdout).toContain("WEB-1");
    });
  });

  it("CLI refuses an unknown slug rather than widening to all projects", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Web App", "--prefix", "WEB-"], { cwd: root });
      const res = await runCli(["list", "--project", "no-such-slug"], { cwd: root });

      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain("no-such-slug");
    });
  });

  it("MCP create_project takes an explicit slug and rejects a duplicate", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const ok = await client.callTool("create_project", {
          name: "Web App",
          prefix: "WEB-",
          slug: "web",
        });
        expect(ok.isError).toBeFalsy();
        expect(ok.content[0]?.text ?? "").toContain('"slug": "web"');

        const dup = await client.callTool("create_project", {
          name: "Other",
          prefix: "OTH-",
          slug: "web",
        });
        expect(dup.isError).toBeTruthy();
        expect(dup.content[0]?.text ?? "").toContain("already used");
      } finally {
        await client.close();
      }
    });
  });

  it("MCP accepts a slug as a project ref and rejects an unknown one", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Web App", "--prefix", "WEB-"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok = await client.callTool("create_task", {
          title: "MCP slug addressed",
          project: "web-app",
        });
        expect(ok.isError).toBeFalsy();
        expect(ok.content[0]?.text ?? "").toContain("WEB-1");

        const bad = await client.callTool("create_task", {
          title: "MCP bad slug",
          project: "no-such-slug",
        });
        expect(bad.isError).toBeTruthy();
        expect(bad.content[0]?.text ?? "").toContain("no-such-slug");
      } finally {
        await client.close();
      }
    });
  });
});

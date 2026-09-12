import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C1
 *
 * A project is `{id, name, prefix}` — P-1 says there is no slug, and
 * ProjectDefSchema is `.strict()`. Its key counter must be seeded at
 * creation, or the first task in that project has nothing to allocate
 * from.
 */
describe("project create writes a ULID entry and seeds its counter", () => {
  const read = async (root: string, rel: string): Promise<Record<string, unknown>> =>
    parseYaml(await readFile(path.join(root, ".loctt", rel), "utf-8")) as Record<string, unknown>;

  it("writes id/name/prefix and no slug fields", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["project", "create", "Backend", "--prefix", "BACKEND"], { cwd: root });
      expect(res.exitCode).toBe(0);

      const projects = await read(root, "config/projects.yaml");
      const entry = (projects["projects"] as { name: string }[])
        .find(p => p.name === "Backend") as Record<string, unknown> | undefined;
      expect(entry).toBeDefined();

      expect(String(entry?.["id"])).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(entry?.["prefix"]).toBe("BACKEND");
      // P-1: adding either of these silently fails .strict() validation.
      expect(entry).not.toHaveProperty("key");
      expect(entry).not.toHaveProperty("label");
    });
  });

  it("seeds keys.<id> so the first task can allocate", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "BACKEND"], { cwd: root });

      const projects = await read(root, "config/projects.yaml");
      const id = (projects["projects"] as { name: string; id: string }[])
        .find(p => p.name === "Backend")?.id ?? "";

      const state = await read(root, "state.yaml");
      const counter = (state["keys"] as Record<string, { prefix: string; next_number: number }>)[id];
      expect(counter, "no key counter seeded for the new project").toBeDefined();
      expect(counter?.prefix).toBe("BACKEND");
      expect(counter?.next_number).toBe(1);

      // And the seed is usable: the first task takes number 1.
      const created = await runCli(["create", "first", "--project", "Backend"], { cwd: root });
      expect(created.stdout).toContain("BACKEND-1");
    });
  });

  it("refuses a duplicate prefix and writes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "BACKEND"], { cwd: root });
      const before = await readFile(path.join(root, ".loctt/config/projects.yaml"), "utf-8");

      const dup = await runCli(["project", "create", "Other", "--prefix", "BACKEND"], { cwd: root });
      expect(dup.exitCode).not.toBe(0);
      expect(`${dup.stdout}${dup.stderr}`).toMatch(/unique/i);

      expect(await readFile(path.join(root, ".loctt/config/projects.yaml"), "utf-8")).toBe(before);
    });
  });

  it("returns default as an id on MCP, never a name", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_projects", {});
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as { default?: string | null };
        // P-4: a ULID is internal identity. `default` is that id, not a
        // display name, so a consumer can resolve it unambiguously.
        if (parsed.default != null) {
          expect(parsed.default).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
        }
      } finally {
        await client.close();
      }
    });
  });
});

/**
 * @verifies PRU-C2
 *
 * Archive sets the flag; unarchive must *remove* it rather than write
 * `false`, or every consumer has to handle two shapes for one state.
 * Archiving the default project must also clear `default:`, since a
 * hidden default is one nothing can resolve.
 */
describe("project archive round-trips", () => {
  const projectsYaml = async (root: string): Promise<string> =>
    (await import("node:fs/promises")).readFile(
      path.join(root, ".loctt/config/projects.yaml"), "utf-8",
    );

  it("sets the flag, then removes it entirely", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });

      await runCli(["project", "archive", "Backend"], { cwd: root });
      expect(await projectsYaml(root)).toMatch(/archived: true/);

      await runCli(["project", "unarchive", "Backend"], { cwd: root });
      // Absent, not `false` — two shapes for one state is how consumers
      // end up disagreeing about what "archived" means.
      expect(await projectsYaml(root)).not.toMatch(/archived:/);
    });
  });

  it("hides an archived project from list, and --all shows it marked", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["project", "archive", "Backend"], { cwd: root });

      const plain = await runCli(["project", "list"], { cwd: root });
      expect(plain.stdout).not.toContain("Backend");

      const all = await runCli(["project", "list", "--all"], { cwd: root });
      expect(all.stdout).toContain("Backend");
      expect(all.stdout).toMatch(/archived/i);
    });
  });

  it("re-archiving is a no-op that leaves the file byte-identical", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["project", "archive", "Backend"], { cwd: root });
      const before = await projectsYaml(root);

      const again = await runCli(["project", "archive", "Backend"], { cwd: root });
      expect(again.exitCode).toBe(0);
      expect(await projectsYaml(root)).toBe(before);
    });
  });
});

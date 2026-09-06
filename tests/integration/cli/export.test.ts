import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C7 (F4 / K30)
 *
 * Task export used to be web-only; K30 built it on the CLI. These
 * exercise the `loctt export` command end to end against a real
 * tracker — the fail-first proof for F4 on the CLI surface.
 */
describe("loctt export", () => {
  it("exports tasks as CSV to stdout by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "First task"], { cwd: root });
      await runCli(["create", "Second task"], { cwd: root });

      const out = await runCli(["export"], { cwd: root });
      expect(out.exitCode).toBe(0);
      // Header row uses the default export columns.
      expect(out.stdout).toMatch(/^key,id,title,/);
      expect(out.stdout).toContain("First task");
      expect(out.stdout).toContain("Second task");
    });
  });

  it("exports tasks as JSON when --format json is given", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "JSON task"], { cwd: root });

      const out = await runCli(["export", "--format", "json"], { cwd: root });
      expect(out.exitCode).toBe(0);
      const parsed = JSON.parse(out.stdout) as { title?: string }[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some(r => r.title === "JSON task")).toBe(true);
    });
  });

  it("writes to a file with --output and reports the count on stderr", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "File task"], { cwd: root });

      const out = await runCli(
        ["export", "--format", "json", "--output", "tasks.json"],
        { cwd: root },
      );
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toMatch(/Exported 1 task/);

      const written = await readFile(path.join(root, "tasks.json"), "utf-8");
      const parsed = JSON.parse(written) as { title?: string }[];
      expect(parsed.some(r => r.title === "File task")).toBe(true);
    });
  });

  it("honours a query filter", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "Keep me"], { cwd: root });
      await runCli(["create", "Drop me"], { cwd: root });
      await runCli(["set", "T-1", "status", "done"], { cwd: root });

      const out = await runCli(
        ["export", "--format", "json", "--query", "status = done"],
        { cwd: root },
      );
      expect(out.exitCode).toBe(0);
      const parsed = JSON.parse(out.stdout) as { title?: string }[];
      expect(parsed.some(r => r.title === "Keep me")).toBe(true);
      expect(parsed.some(r => r.title === "Drop me")).toBe(false);
    });
  });

  it("rejects an invalid --format with a usage error", async () => {
    await withTmpLoctt(async ({ root }) => {
      const out = await runCli(["export", "--format", "xml"], { cwd: root });
      expect(out.exitCode).not.toBe(0);
      expect(out.stderr).toMatch(/--format must be csv or json/);
    });
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

// withTmpLoctt is used by the reachability cases below.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @verifies TSK-C7
 *
 * Six task APIs shipped in core with no callers. The case allows a
 * capability to be absent from a surface — but not silently: "any
 * capability deliberately left off a surface is absent from that
 * surface's user doc too".
 *
 * duplicate, move and bulk are reachable from the CLI. Export was
 * originally web-only and documented as absent here; K30 (F4)
 * overrode that call and built it on the CLI and MCP, so this now
 * asserts export is PRESENT on the CLI and named in both reference
 * docs.
 */
describe("task capabilities are reachable or documented as absent", () => {
  it("duplicates a task with a fresh key and no relationships", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "source"], { cwd: root });
      await runCli(["create", "other"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const dup = await runCli(["duplicate", "T-1"], { cwd: root });
      expect(dup.exitCode).toBe(0);
      expect(dup.stdout).toMatch(/T-3/);

      // duplicateTask's contract: relationships are deliberately not
      // copied, so the copy starts unlinked.
      const show = await runCli(["show", "T-3"], { cwd: root });
      expect(show.stdout).not.toMatch(/blocks/);
    });
  });

  it("moves a task and keeps the old key resolving", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["create", "movable"], { cwd: root });

      const move = await runCli(["move", "T-1", "Backend"], { cwd: root });
      expect(move.exitCode).toBe(0);

      // P-7: the retired key stays resolvable, or every link and commit
      // message referencing it breaks.
      const byOldKey = await runCli(["show", "T-1"], { cwd: root });
      expect(byOldKey.exitCode).toBe(0);
      expect(byOldKey.stdout).toContain("movable");
    });
  });

  it("runs a multi-task set as one bulk operation", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["create", "two"], { cwd: root });

      const bulk = await runCli(["set", "T-1,T-2", "status", "in_progress"], { cwd: root });
      expect(bulk.exitCode).toBe(0);

      for (const ref of ["T-1", "T-2"]) {
        const show = await runCli(["show", ref], { cwd: root });
        expect(show.stdout).toMatch(/in_progress/);
      }
    });
  });

  it("exports tasks from the CLI and documents export on both surfaces", async () => {
    // K30/F4 built task export on the CLI and MCP, overriding the
    // earlier "web-only, documented as absent" call. Export must now
    // run on the CLI and be documented on both surfaces.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "exported"], { cwd: root });
      const cli = await runCli(["export", "--format", "json"], { cwd: root });
      expect(cli.exitCode).toBe(0);
      const parsed = JSON.parse(cli.stdout) as { title?: string }[];
      expect(parsed.some(r => r.title === "exported")).toBe(true);
    });

    for (const doc of ["docs/user/cli/reference.md", "docs/user/mcp/reference.md"]) {
      const text = await readFile(path.join(repoRoot, doc), "utf-8");
      expect(text, `${doc} does not document export`)
        .toMatch(/[Ee]xport/);
    }
  });
});

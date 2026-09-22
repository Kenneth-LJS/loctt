import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadQueriesConfig, serializeQueriesConfig } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies QRY-C1
 *
 * The web once emitted `field in [a, b]` from three sites while the
 * tokenizer had no `[` token, so a view saved from the UI was a view the
 * CLI could not run — and one bad query rejects the whole
 * `queries.yaml`, so it took every other view with it.
 *
 * The emitters were fixed in 36c8872; this pins the round trip, which is
 * what actually matters: the DSL the UI writes must run everywhere.
 */
describe("a saved multi-value view runs identically on CLI and MCP", () => {
  /**
   * Appends a view the way the web API writes one: an entry with a ULID
   * id and an ordered `filters` list (K102). The DSL under test is
   * carried as a single ADVANCED filter — that is exactly what the web
   * sends for a hand-typed query, and it is the case this test exists to
   * pin: the DSL the UI writes must run everywhere.
   */
  const saveView = async (root: string, name: string, query: string): Promise<void> => {
    const locttDir = path.join(root, ".loctt");
    const config = await loadQueriesConfig(locttDir);
    const id = `01M${name.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "X").padEnd(23, "0").slice(0, 23)}`;
    const next = {
      ...config,
      queries: [
        ...config.queries,
        { id, name, filters: [{ kind: "advanced" as const, query }] },
      ],
    };
    await writeFile(
      path.join(locttDir, "config/queries.yaml"),
      serializeQueriesConfig(next),
      "utf-8",
    );
  };

  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "one"], { cwd: root });
    await runCli(["create", "two"], { cwd: root });
    await runCli(["create", "three"], { cwd: root });
    await runCli(["set", "T-2", "status", "in_progress"], { cwd: root });
    await runCli(["set", "T-3", "status", "done"], { cwd: root });
  };

  it("runs the parenthesised multi-value form the UI emits", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);

      // Exactly the shape buildDsl.ts produces for a two-status facet.
      const res = await runCli(
        ["list", "--query", "status in (backlog, in_progress)"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("T-1");
      expect(res.stdout).toContain("T-2");
      expect(res.stdout).not.toContain("T-3");
    });
  });

  it("returns the same set through a saved view on both surfaces", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);

      // Views are created by the web; CLI and MCP read them. Writing
      // queries.yaml directly is what the API does, and is the only way
      // to exercise "a view saved from the UI" from here.
      await saveView(root, "open-work", "status in (backlog, in_progress)");

      const client = await startMcpClient(root);
      try {
        const cli = await runCli(["list", "--view", "open-work"], { cwd: root });
        expect(cli.exitCode).toBe(0);

        const mcp = await client.callTool("list_tasks", { view: "open-work" });
        expect(mcp.isError).toBeFalsy();

        // Equal sets, not merely both non-empty — the case is explicit,
        // because two different-but-nonempty answers is the failure.
        const keysOf = (s: string): string[] =>
          [...s.matchAll(/\bT-\d+\b/g)].map(m => m[0]).sort();
        const cliKeys = [...new Set(keysOf(cli.stdout))];
        const mcpKeys = [...new Set(keysOf(mcp.content[0]?.text ?? ""))];

        expect(cliKeys).toEqual(["T-1", "T-2"]);
        expect(mcpKeys).toEqual(cliKeys);
      } finally {
        await client.close();
      }
    });
  });

  it("keeps queries.yaml loadable after saving a multi-value view", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      await saveView(root, "multi", "status in (backlog, in_progress)");

      // One unparseable query rejects the whole file, so a bad write
      // takes every other saved view down with it.
      const views = await runCli(["views"], { cwd: root });
      expect(views.exitCode).toBe(0);
      expect(views.stdout).toContain("multi");
    });
  });
});

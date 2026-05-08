import { stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: init then full lifecycle (CLI)", () => {
  it("walks from init through create, set, link, archive, log, query", async () => {
    await withTmpLoctt(async ({ root }) => {
      const init = await runCli(["init"], { cwd: root });
      expect(init.exitCode).toBe(0);

      const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
      expect(workflow.isFile()).toBe(true);
      const queries = await stat(path.join(root, ".loctt/config/queries.yaml"));
      expect(queries.isFile()).toBe(true);

      const createA = await runCli(["create", "task A"], { cwd: root });
      expect(createA.exitCode).toBe(0);
      expect(createA.stdout).toContain("T-1");

      const createB = await runCli(["create", "task B"], { cwd: root });
      expect(createB.exitCode).toBe(0);
      expect(createB.stdout).toContain("T-2");

      const setStatus = await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });
      expect(setStatus.exitCode).toBe(0);

      const showA = await runCli(["show", "T-1"], { cwd: root });
      expect(showA.exitCode).toBe(0);
      expect(showA.stdout).toContain("Status: in_progress");

      const link = await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      expect(link.exitCode).toBe(0);

      const showB = await runCli(["show", "T-2"], { cwd: root });
      expect(showB.exitCode).toBe(0);
      expect(showB.stdout).toMatch(/is_blocked_by → T-1/);

      const archive = await runCli(["archive", "T-1"], { cwd: root });
      expect(archive.exitCode).toBe(0);

      const list = await runCli(["list"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).not.toContain("task A");
      expect(list.stdout).toContain("task B");

      const log = await runCli(["log", "T-1"], { cwd: root });
      expect(log.exitCode).toBe(0);
      expect(log.stdout).toContain("created");
      expect(log.stdout).toContain("status");
      expect(log.stdout).toContain("link added");
      expect(log.stdout).toContain("archived");

      // task A was archived, so the in_progress query (no archived flag)
      // returns nothing — make a fresh in_progress task to query against.
      await runCli(["create", "task C"], { cwd: root });
      await runCli(["set", "T-3", "status", "in_progress"], { cwd: root });

      const query = await runCli(["list", "--query", "status = in_progress"], { cwd: root });
      expect(query.exitCode).toBe(0);
      expect(query.stdout).toContain("task C");
      expect(query.stdout).not.toContain("task B");
    }, { init: false });
  });
});

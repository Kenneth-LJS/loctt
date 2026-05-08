import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

interface Seed {
  readonly title: string;
  readonly status?: string;
  readonly priority?: string;
}

const SEED: readonly Seed[] = [
  // 8 in_progress (mix of priorities)
  { title: "fix login crash", status: "in_progress", priority: "high" },
  { title: "improve login UX", status: "in_progress", priority: "high" },
  { title: "logout flow", status: "in_progress", priority: "medium" },
  { title: "in-progress 4", status: "in_progress", priority: "low" },
  { title: "in-progress 5", status: "in_progress", priority: "medium" },
  { title: "in-progress 6", status: "in_progress" },
  { title: "in-progress 7", status: "in_progress" },
  { title: "in-progress 8", status: "in_progress", priority: "high" },
  // 5 blocked
  { title: "blocked 1", status: "blocked", priority: "high" },
  { title: "blocked 2", status: "blocked" },
  { title: "blocked 3", status: "blocked" },
  { title: "blocked 4", status: "blocked", priority: "medium" },
  { title: "blocked 5", status: "blocked" },
  // 4 done
  { title: "done 1", status: "done" },
  { title: "done 2", status: "done", priority: "high" },
  { title: "done 3", status: "done" },
  { title: "done 4", status: "done" },
  // 3 not_started (default)
  { title: "todo login revamp" },
  { title: "todo 2" },
  { title: "todo 3" },
];

describe("E2E journey: query & saved views", () => {
  it("seeds tasks and exercises core query operators and views", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const s of SEED) {
        const create = await runCli(["create", s.title], { cwd: root });
        expect(create.exitCode).toBe(0);
        // Parse key from output: "Created T-N: title"
        const m = /Created\s+(\S+):/.exec(create.stdout);
        expect(m).not.toBeNull();
        const key = m![1]!;
        if (s.status && s.status !== "not_started") {
          expect((await runCli(["set", key, "status", s.status], { cwd: root })).exitCode).toBe(0);
        }
        if (s.priority) {
          expect((await runCli(["set", key, "priority", s.priority], { cwd: root })).exitCode).toBe(0);
        }
      }

      // status = in_progress
      const inProgress = await runCli(["list", "--query", "status = in_progress"], { cwd: root });
      expect(inProgress.exitCode).toBe(0);
      expect(inProgress.stdout).toContain("fix login crash");
      expect(inProgress.stdout).toContain("logout flow");
      expect(inProgress.stdout).not.toContain("blocked 1");
      expect(inProgress.stdout).not.toContain("done 1");

      // priority = high and status = in_progress
      const highInProgress = await runCli(
        ["list", "--query", "priority = high and status = in_progress"],
        { cwd: root },
      );
      expect(highInProgress.exitCode).toBe(0);
      expect(highInProgress.stdout).toContain("fix login crash");
      expect(highInProgress.stdout).toContain("improve login UX");
      expect(highInProgress.stdout).toContain("in-progress 8");
      expect(highInProgress.stdout).not.toContain("blocked 1"); // blocked, not in_progress
      expect(highInProgress.stdout).not.toContain("logout flow"); // medium

      // title ~ "login" — contains match
      const loginMatch = await runCli(["list", "--query", 'title ~ "login"'], { cwd: root });
      expect(loginMatch.exitCode).toBe(0);
      expect(loginMatch.stdout).toContain("fix login crash");
      expect(loginMatch.stdout).toContain("improve login UX");
      expect(loginMatch.stdout).toContain("todo login revamp");
      expect(loginMatch.stdout).not.toContain("logout flow");
      expect(loginMatch.stdout).not.toContain("done 1");

      // recent-open view: archived != true and status != done — open + not_started + blocked + in_progress = 16
      const recentOpen = await runCli(["list", "--view", "recent-open"], { cwd: root });
      expect(recentOpen.exitCode).toBe(0);
      expect(recentOpen.stdout).toContain("fix login crash");
      expect(recentOpen.stdout).toContain("blocked 1");
      expect(recentOpen.stdout).toContain("todo 2");
      expect(recentOpen.stdout).not.toContain("done 1");

      // --limit 5
      const limited = await runCli(["list", "--limit", "5"], { cwd: root });
      expect(limited.exitCode).toBe(0);
      // Each row begins with "T-N  ". Count rows.
      const rows = limited.stdout.split("\n").filter(line => /^T-\d+\s/.test(line));
      expect(rows.length).toBe(5);
    });
  });
});

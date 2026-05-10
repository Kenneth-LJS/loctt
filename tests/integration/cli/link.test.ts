import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI link (spawned binary)", () => {
  it("creates a relationship between two tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const link = await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      expect(link.exitCode).toBe(0);
      expect(link.stdout).toContain("T-2");

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("blocks");
      expect(show.stdout).toContain("Relationships:");
      // Relationship target should render as the user-facing key, not a ULID.
      expect(show.stdout).toMatch(/blocks → T-2/);
      // ULIDs are 26 chars of Crockford base32 — shouldn't appear in output.
      expect(show.stdout).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);

      // Bilateral: the inverse edge must be visible from the target's side too.
      const showTarget = await runCli(["show", "T-2"], { cwd: root });
      expect(showTarget.stdout).toContain("Relationships:");
      expect(showTarget.stdout).toMatch(/blocked_by → T-1/);
      expect(showTarget.stdout).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
    });
  });

  it("renders a deleted relationship target without leaking the full ULID", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      const del = await runCli(["delete", "T-2", "--hard"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("(deleted)");
      // The full 26-char ULID should NOT appear; truncated form is fine.
      expect(show.stdout).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
    });
  });
});

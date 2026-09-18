import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies K90
 *
 * K90: the config-list commands (labels, milestones, sprints, users,
 * projects) gain a `--filter <q>` name search and `--limit`/`--offset`
 * pagination, matching the web server's archived-filter → name-filter →
 * paginate order. Labels/others match on name; projects also match on
 * slug and prefix. These are the CLI half of the ruling; the paths under
 * test are the `list` cases in apps/cli/src/commands/{label,project}.ts.
 */
describe("CLI config-list name search + pagination (K90)", () => {
  it("label list --filter returns only name matches", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["label", "create", "Frontend"], { cwd: root });
      await runCli(["label", "create", "Backend"], { cwd: root });
      await runCli(["label", "create", "Docs"], { cwd: root });

      const res = await runCli(["label", "list", "--filter", "end"], { cwd: root });
      expect(res.exitCode).toBe(0);
      // "end" is a substring of Frontend and Backend, not Docs.
      const names = res.stdout.trim().split("\n").map(l => l.split("\t")[0]?.trim());
      expect(names).toContain("Frontend");
      expect(names).toContain("Backend");
      expect(names).not.toContain("Docs");
    });
  });

  it("label list --filter is case-insensitive", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["label", "create", "Frontend"], { cwd: root });
      const res = await runCli(["label", "list", "--filter", "FRONT"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("Frontend");
    });
  });

  it("label list --limit/--offset page through the list", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Deterministic, sortable names — the list preserves config order.
      for (const n of ["L0", "L1", "L2", "L3", "L4"]) {
        await runCli(["label", "create", n], { cwd: root });
      }
      // Row names only — drop the "Showing …" truncation footer, the way
      // log-paging.test.ts strips its footer, so the assertion is about
      // which rows the page holds.
      const rowNames = (stdout: string): (string | undefined)[] =>
        stdout.trim().split("\n")
          .filter(l => !/^Showing /.test(l) && l.trim().length > 0)
          .map(l => l.split("\t")[0]?.trim());

      const firstTwo = await runCli(["label", "list", "--limit", "2"], { cwd: root });
      expect(firstTwo.exitCode).toBe(0);
      expect(rowNames(firstTwo.stdout)).toEqual(["L0", "L1"]);

      const nextTwo = await runCli(["label", "list", "--limit", "2", "--offset", "2"], { cwd: root });
      expect(nextTwo.exitCode).toBe(0);
      expect(rowNames(nextTwo.stdout)).toEqual(["L2", "L3"]);
    });
  });

  it("label list --limit rejects a value over the 1000 cap", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["label", "list", "--limit", "1001"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/at most 1000/);
    });
  });

  it("label list prints a truncation footer only when matches exceed the page", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const n of ["A0", "A1", "A2", "A3", "A4"]) {
        await runCli(["label", "create", n], { cwd: root });
      }
      // A page that does not cover all matches names the total and how to
      // page — a silent truncation would read as the whole list.
      const truncated = await runCli(["label", "list", "--limit", "2"], { cwd: root });
      expect(truncated.exitCode).toBe(0);
      expect(truncated.stdout).toMatch(/Showing 1–2 of 5\. Use --limit\/--offset to page\./);

      // An offset page past the start also gets the footer, with its own
      // range.
      const offsetPage = await runCli(["label", "list", "--limit", "2", "--offset", "2"], { cwd: root });
      expect(offsetPage.stdout).toMatch(/Showing 3–4 of 5\./);

      // When the page holds every match, no footer — the common case.
      const whole = await runCli(["label", "list"], { cwd: root });
      expect(whole.exitCode).toBe(0);
      expect(whole.stdout).not.toMatch(/Showing/);

      // A filter that leaves fewer matches than the limit is "everything
      // fits" too: footer counts filtered matches, not the raw list.
      const filteredFits = await runCli(["label", "list", "--filter", "A0"], { cwd: root });
      expect(filteredFits.stdout).not.toMatch(/Showing/);
    });
  });

  it("project list --filter matches on prefix and slug, not only name", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Name "Website", prefix "WEB", slug "webapp" — the filter should
      // find it by prefix or slug even though the name has neither token.
      await runCli(
        ["project", "create", "Website", "--prefix", "WEB", "--slug", "webapp"],
        { cwd: root },
      );

      const byPrefix = await runCli(["project", "list", "--filter", "WEB"], { cwd: root });
      expect(byPrefix.exitCode).toBe(0);
      expect(byPrefix.stdout).toContain("Website");

      const bySlug = await runCli(["project", "list", "--filter", "webapp"], { cwd: root });
      expect(bySlug.exitCode).toBe(0);
      expect(bySlug.stdout).toContain("Website");

      // A token in none of name/slug/prefix excludes it. The default
      // "Tasks" project (prefix T-) must also be absent from this result.
      const miss = await runCli(["project", "list", "--filter", "zzzznope"], { cwd: root });
      expect(miss.exitCode).toBe(0);
      expect(miss.stdout).not.toContain("Website");
      expect(miss.stdout).not.toContain("Tasks");
    });
  });
});

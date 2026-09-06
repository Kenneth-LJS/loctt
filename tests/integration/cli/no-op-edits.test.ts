import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Audit group E: `user` / `label` / `milestone` / `sprint` `edit` with
 * no flags reported success.
 *
 * `loctt user edit Ken` printed "Updated user <id>" and exited 0 having
 * changed nothing — which reads as confirmation that a rename landed.
 * The likeliest way to reach it is a typo'd flag name, and until the
 * exit-code work above, that typo was silently dropped too: both halves
 * of the mistake reported success.
 *
 * Also covers `loctt ui --port`, where `Number(x) || undefined` mapped
 * "abc", "0" and "" alike to "pick any free port" — so a typo'd port
 * started the server somewhere the user was not looking.
 */
describe("edits that change nothing (spawned binary)", () => {
  /** Creates the entity each case edits, then returns its ref. */
  async function seed(root: string): Promise<void> {
    await runCli(["user", "create", "Ken"], { cwd: root });
    await runCli(["label", "create", "bug"], { cwd: root });
    await runCli(["milestone", "create", "v1"], { cwd: root });
    await runCli(
      ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14"],
      { cwd: root },
    );
  }

  const CASES: Array<[string, string[], string[]]> = [
    ["user", ["user", "edit", "Ken"], ["--name", "Kenneth"]],
    ["label", ["label", "edit", "bug"], ["--name", "defect"]],
    ["milestone", ["milestone", "edit", "v1"], ["--name", "v1.0"]],
    ["sprint", ["sprint", "edit", "s1"], ["--name", "sprint-one"]],
  ];

  it.each(CASES)("refuses a no-op %s edit", async (_label, argv) => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const result = await runCli(argv, { cwd: root });
      // Usage, not runtime: the command was invoked wrongly.
      expect(result.exitCode).toBe(2);
      const text = `${result.stdout}${result.stderr}`;
      expect(text).toMatch(/nothing to change/i);
      // And it must not claim to have updated anything.
      expect(result.stdout).not.toMatch(/Updated/i);
    });
  });

  it.each(CASES)("still performs a real %s edit", async (_label, argv, flags) => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      // Guards the fix from over-reaching: naming one thing to change
      // must still work.
      const result = await runCli([...argv, ...flags], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Updated/i);
    });
  });
});

describe("user email is validated on the CLI write path (spawned binary)", () => {
  // Parity with the web UI and MCP: validation lives in core, so a
  // malformed `--email` must fail here too rather than corrupting the
  // field (which the read path degrades to blank). See decisions.md A152.
  it("rejects a malformed email on create and writes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const bad = await runCli(["user", "create", "Bob", "--email", "bob"], { cwd: root });
      expect(bad.exitCode).not.toBe(0);
      expect(`${bad.stdout}${bad.stderr}`).toMatch(/invalid email/i);
      // The user must not have been created.
      const listed = await runCli(["user", "list"], { cwd: root });
      expect(listed.stdout).not.toMatch(/Bob/);
    });
  });

  it("rejects a malformed email on edit without touching the stored value", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Bob", "--email", "bob@example.com"], { cwd: root });
      const bad = await runCli(["user", "edit", "Bob", "--email", "bob"], { cwd: root });
      expect(bad.exitCode).not.toBe(0);
      expect(`${bad.stdout}${bad.stderr}`).toMatch(/invalid email/i);
      // The valid email is still there.
      const listed = await runCli(["user", "list"], { cwd: root });
      expect(listed.stdout).toContain("bob@example.com");
    });
  });
});

describe("loctt ui --port validation (spawned binary)", () => {
  it.each(["abc", "0", "70000", "-1"])("refuses --port %s", async (port) => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["ui", "--port", port], { cwd: root });
      // The old behaviour started a server on a *random* port, so the
      // user's `localhost:3000` did not answer and nothing said why.
      expect(result.exitCode).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toMatch(/--port (must be|needs) an integer/);
    });
  });
});

describe("comment bodies are not rewritten (spawned binary)", () => {
  it("keeps a --prefixed word in a quoted body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const body = "see the --force flag docs";
      const added = await runCli(["comment", "T-1", body], { cwd: root });
      expect(added.exitCode).toBe(0);

      const listed = await runCli(["comments", "T-1"], { cwd: root });
      // The old `.filter(a => !a.startsWith("--"))` dropped any word
      // beginning with `--`, so this body silently lost one — a content
      // mutation on a write path, with nothing reported.
      expect(listed.stdout).toContain("--force");
      expect(listed.stdout).toContain(body);
    });
  });

  it("keeps a --prefixed word through comment-edit", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const added = await runCli(["comment", "T-1", "original"], { cwd: root });
      const id = (added.stdout.match(/[0-9A-HJKMNP-TV-Z]{26}/) ?? [])[0];
      expect(id).toBeDefined();

      await runCli(["comment-edit", "T-1", id as string, "now with --force"], { cwd: root });
      const listed = await runCli(["comments", "T-1"], { cwd: root });
      expect(listed.stdout).toContain("--force");
    });
  });

  it("keeps --prefixed words that follow a `--` separator", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      // `rejectUnknownFlags` stops at `--`, so everything after it
      // reached the body filter unguarded — this is the path where the
      // silent drop was actually reachable.
      await runCli(["comment", "T-1", "--", "before", "--after", "end"], { cwd: root });

      const listed = await runCli(["comments", "T-1"], { cwd: root });
      expect(listed.stdout).toContain("--after");
      expect(listed.stdout).toContain("before");
      expect(listed.stdout).toContain("end");
    });
  });

  it("says a command takes no options rather than 'Accepted: .'", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      // Unquoted, so `--force` parses as a flag. The refusal is correct;
      // the message was "Accepted: ." which reads as truncated.
      const result = await runCli(["comment", "T-1", "see", "--force"], { cwd: root });
      expect(result.exitCode).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toMatch(/accepts no options/);
    });
  });
});

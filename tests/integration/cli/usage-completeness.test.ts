import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @verifies CMT-C1
 *
 * Six commands were dispatched and absent from `usage()` — the whole
 * comment surface, plus duplicate and move. They worked; nobody could
 * find them. `--help` is the only discovery route a CLI has, so a
 * command missing from it is effectively unshipped.
 *
 * Comparing the dispatcher against the help text keeps the two from
 * drifting again, which is how they drifted in the first place.
 */
describe("CLI usage lists every command it dispatches", () => {
  it("documents each dispatched command", async () => {
    const index = await readFile(path.join(repoRoot, "apps/cli/src/index.ts"), "utf-8");
    const usage = await readFile(path.join(repoRoot, "apps/cli/src/usage.ts"), "utf-8");

    const dispatched = [...index.matchAll(/case "([a-z][a-z-]*)":/g)]
      .map(m => m[1] as string)
      // Help aliases are the help text; they do not list themselves.
      .filter(c => !["help", "-h", "--help"].includes(c));

    expect(dispatched.length).toBeGreaterThan(20);
    for (const cmd of dispatched) {
      expect(usage, `"${cmd}" is dispatched but missing from usage()`)
        .toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });

  it("reaches the comment lifecycle end to end", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });

      const add = await runCli(["comment", "T-1", "first note"], { cwd: root });
      expect(add.exitCode).toBe(0);

      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("first note");

      // The id is what edit/delete take, so it has to be in the output.
      const id = /([0-9A-HJKMNP-TV-Z]{26})/.exec(list.stdout)?.[1];
      expect(id, "comment id not printed by `comments`").toBeDefined();

      const edit = await runCli(["comment-edit", "T-1", id ?? "", "edited note"], { cwd: root });
      expect(edit.exitCode).toBe(0);

      const after = await runCli(["comments", "T-1"], { cwd: root });
      expect(after.stdout).toContain("edited note");

      // CMT-C1: the CLI deletes "behind a confirmation". comment-delete
      // was the one destructive command with no gate, while `delete` and
      // every entity delete required one.
      const ungated = await runCli(["comment-delete", "T-1", id ?? ""], { cwd: root });
      expect(ungated.exitCode).not.toBe(0);
      const survived = await runCli(["comments", "T-1"], { cwd: root });
      expect(survived.stdout).toContain("edited note");

      const del = await runCli(["comment-delete", "T-1", id ?? "", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);
      const gone = await runCli(["comments", "T-1"], { cwd: root });
      expect(gone.stdout).not.toContain("edited note");
    });
  });
});

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * What a CLI user sees when they break a config file by hand.
 *
 * The web UI puts technical detail behind a "Show details" disclosure
 * (ERR-16). The terminal has no such affordance, so a `LocttError`
 * that carries its whole diagnosis in `detail` reduces to one flat
 * sentence unless the printer says otherwise — which is exactly what
 * happened when `YamlSyntaxError` became a `LocttError`: the message
 * gained the filename and lost the line and column.
 */
describe("CLI config errors (spawned binary)", () => {
  it("names the file and prints the parse position", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        path.join(root, ".loctt", "config", "labels.yaml"),
        "labels:\n  - name: [unclosed\n",
        "utf8",
      );

      const res = await runCli(["label", "list"], { cwd: root });
      expect(res.exitCode).not.toBe(0);

      const out = `${res.stdout}\n${res.stderr}`;
      // The file, so the user knows which one to open.
      expect(out).toContain("labels.yaml");
      // The position, so they know where to look in it. This is the
      // part that was lost.
      expect(out).toMatch(/line \d+/);
      expect(out).toMatch(/column \d+/);
      // A domain error, not a crash: the tracker is fine, the file is
      // not.
      expect(out).not.toMatch(/^Fatal:/m);
      expect(out).not.toMatch(/at Object\.|node_modules/);
    });
  });

  it("still works for every other command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "unaffected"], { cwd: root });
      await writeFile(
        path.join(root, ".loctt", "config", "labels.yaml"),
        "labels:\n  - name: [unclosed\n",
        "utf8",
      );

      // A broken labels.yaml does not take down the task list — the
      // same guarantee SHL-43 makes for the web surface.
      const list = await runCli(["list"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("unaffected");
    });
  });
});

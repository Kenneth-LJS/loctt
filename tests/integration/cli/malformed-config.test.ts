import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Audit group D: `loadOptionalConfigs` swallowed every error from
 * `workflow.yaml` and `queries.yaml`, so a file that would not parse was
 * indistinguishable from one that was not there.
 *
 * Absent is a supported state and every downstream check is guarded on
 * the config being present — so a malformed file did not fail, it
 * silently *disabled validation*. `loctt create --status
 * not_a_real_status` reported success against a broken workflow.yaml,
 * writing a task whose status no config explains.
 */
describe("malformed vs absent config (spawned binary)", () => {
  it("refuses to run against a workflow.yaml that will not parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        path.join(root, ".loctt/config/workflow.yaml"),
        "statuses: [unclosed\n",
        "utf8",
      );

      const result = await runCli(
        ["create", "x", "--status", "not_a_real_status"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      const text = `${result.stdout}${result.stderr}`;
      // Names the file and the reason, not a downstream symptom.
      expect(text).toMatch(/workflow\.yaml/);
      expect(text).toMatch(/malformed|YAML/i);
      // And nothing was created.
      expect(result.stdout).not.toMatch(/Created/);
    });
  });

  it("refuses against a queries.yaml that will not parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        path.join(root, ".loctt/config/queries.yaml"),
        "queries: [unclosed\n",
        "utf8",
      );
      const result = await runCli(["list"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/queries\.yaml/);
    });
  });

  it("still runs when the configs are simply absent", async () => {
    await withTmpLoctt(async ({ root }) => {
      // The state the catches legitimately serve, and the reason they
      // cannot just be removed: both files are optional.
      await rm(path.join(root, ".loctt/config/workflow.yaml"), { force: true });
      await rm(path.join(root, ".loctt/config/queries.yaml"), { force: true });

      const created = await runCli(["create", "no config"], { cwd: root });
      expect(created.exitCode).toBe(0);

      const listed = await runCli(["list"], { cwd: root });
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("no config");
    });
  });

  it("still validates a status against a workflow.yaml that does parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Guards against the fix passing for the wrong reason: with a
      // readable config, a bogus status must still be rejected on its
      // own merits.
      const result = await runCli(
        ["create", "x", "--status", "not_a_real_status"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/not_a_real_status/);
    });
  });
});

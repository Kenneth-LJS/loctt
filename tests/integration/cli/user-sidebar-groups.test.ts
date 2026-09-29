import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt user sidebar-groups` (SHL-45).
 *
 * The web sidebar-groups editor is a core capability; Ken's layer rule
 * puts it on CLI + MCP too. This exercises the CLI surface against the
 * spawned binary and the file on disk.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("CLI user sidebar-groups (spawned binary)", () => {
  // @verifies SHL-45
  it("prints the resolved order, all visible, by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(result.exitCode).toBe(0);
      // Default order includes every built-in group, marked visible.
      expect(result.stdout).toContain("projects\tvisible");
      expect(result.stdout).toContain("labels\tvisible");
    });
  });

  // @verifies SHL-45
  it("sets order + hidden and persists them to settings.yaml", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,projects", "--hidden", "sprints"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      // Labels leads the printed order now, and sprints reads hidden.
      expect(result.stdout.indexOf("labels")).toBeLessThan(result.stdout.indexOf("projects"));
      expect(result.stdout).toContain("sprints\thidden");

      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("sidebar_groups");
      expect(file).toContain("labels");
      expect(file).toContain("sprints");
    });
  });

  // @verifies SHL-45 — a WRITE rejects an unknown id (B2 bug 4)
  it("rejects an unknown id with an error naming it, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,bogus,projects"],
        { cwd: root },
      );
      // A typo must not silently no-op: non-zero exit, the bad id named,
      // and no partial write.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("bogus");
      const file = await readFile(await settingsPath(root), "utf8").catch(() => "");
      expect(file).not.toContain("sidebar_groups");
    });
  });

  // @verifies SHL-45 — a duplicate id is folded, not rejected
  it("de-duplicates a repeated (valid) id without erroring", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,labels,projects"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("labels");
      expect(file).toContain("projects");
    });
  });

  // @verifies SHL-45 — the read round-trips a hidden FILTER, not just
  // groups (B2 bug 3): `--hidden overdue` must read back hidden.
  it("round-trips a hidden built-in filter through read", async () => {
    await withTmpLoctt(async ({ root }) => {
      const set = await runCli(
        ["user", "sidebar-groups", "--hidden", "overdue"],
        { cwd: root },
      );
      expect(set.exitCode).toBe(0);
      // The write's own read-back must show the filter hidden...
      expect(set.stdout).toContain("overdue\thidden");
      // ...and a fresh read (no flags) must too — the filter is not
      // dropped just because it is not a top-level group.
      const read = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(read.stdout).toContain("overdue\thidden");
    });
  });

  // @verifies SHL-45
  it("resets the setting back to the default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "theme: dark\nsidebar_groups:\n  version: 2\n  hidden: [labels]\n",
        "utf8",
      );
      const result = await runCli(["user", "sidebar-groups", "--reset"], { cwd: root });
      expect(result.exitCode).toBe(0);
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).not.toContain("sidebar_groups");
      // The unrelated preference survives the reset.
      expect(file).toContain("theme: dark");
    });
  });

  // @verifies SHL-54 — K160 (was B52's read-time migration test): after the
  // 0.3.0 → 0.4.0 step the reader knows only the K158 shape. A pre-K158
  // value left in the file reads as the default layout, and doctor names
  // the file with the remedy that fits (this tracker is current: reset).
  it("K160: a pre-K158 stored order is not migrated on read: the default layout, and doctor names the file", async () => {
    await withTmpLoctt(async ({ root }) => {
      const file = await settingsPath(root);
      await writeFile(file, "theme: dark\nsidebar_groups:\n  order: [overdue, projects, views, saved-filters]\n  hidden: [views]\n", "utf8");
      const result = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(result.exitCode).toBe(0);
      const ids = result.stdout.trim().split("\n").map(l => l.split("\t")[0]);
      expect(ids.slice(0, 3)).toEqual(["layouts", "projects", "views"]);
      expect(result.stdout).toContain("layouts\tvisible");
      expect(result.stdout).not.toContain("\thidden");
      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout).toContain(file);
      expect(doctor.stdout).toMatch(/"sidebar_groups" is in the layout loctt wrote before 0\.4\.0/);
      expect(doctor.stdout).toContain("loctt user sidebar-groups --reset");
      // The remedy works: a reset removes it and the finding.
      expect((await runCli(["user", "sidebar-groups", "--reset"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["doctor"], { cwd: root })).stdout).not.toMatch(/sidebar_groups/);
    });
  });

  // @verifies ONB-C23
  // @verifies SHL-54 — K160 (was B53's pins-seed test): on a tracker still
  // at 0.3.0 with a pre-K158 layout and pins, every command is refused
  // until `loctt migrate --yes`; after it, sidebar-groups reads the
  // converted layout (pins leading the saved views) and the old keys are gone.
  it("K160: after loctt migrate, sidebar-groups reads the converted layout with the pinned view first", async () => {
    await withTmpLoctt(async ({ root }) => {
      const created = await runCli(["views", "create", "Open bugs"], { cwd: root });
      const viewId = String(/id (\S+)\)/.exec(created.stdout)?.[1]);
      const file = await settingsPath(root);
      await writeFile(path.join(root, ".loctt", ".schema-version"), "0.3.0\n", "utf8");
      await writeFile(file, `theme: dark\nsidebar_pins:\n  - ${viewId}\nsidebar_groups:\n  order: [filters, saved-filters]\n  hidden: [views]\n`, "utf8");

      const refused = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr + refused.stdout).toContain("This tracker needs upgrading from 0.3.0 to 0.4.0.");

      const migrated = await runCli(["migrate", "--yes"], { cwd: root });
      expect(migrated.exitCode).toBe(0);
      expect(migrated.stdout).toContain("1. 0.3.0 → 0.4.0  Move sidebar settings to the Views layout");
      const after = await readFile(file, "utf8");
      expect(after).not.toContain("sidebar_pins");
      expect(after).toContain("version: 2");
      expect(after).toContain("theme: dark");

      const read = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(read.exitCode).toBe(0);
      const lines = read.stdout.trim().split("\n");
      const ids = lines.map(l => l.split("\t")[0]);
      // Filters sat first: Views leads, the built-ins first, then the
      // saved views with the pinned one leading init's seed view.
      expect(ids.slice(0, 2)).toEqual(["views", "assigned-to-me"]);
      expect(lines[7]).toBe(`view:${viewId}\tvisible\tOpen bugs`);
      expect(ids[8]?.startsWith("view:")).toBe(true);
      expect(read.stdout).toContain("layouts\thidden");
      expect(ids).not.toContain("filters");
      expect(ids).not.toContain("saved-filters");
    });
  });

  // @verifies SHL-54 — K158: hiding the Views group hides every child in
  // the sidebar, so the read-back must say so.
  it("K158: reports every Views child hidden when the Views group is hidden", async () => {
    await withTmpLoctt(async ({ root }) => {
      const created = await runCli(["views", "create", "Open bugs"], { cwd: root });
      const viewId = /id (\S+)\)/.exec(created.stdout)?.[1];
      const result = await runCli(
        ["user", "sidebar-groups", "--hidden", "views"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      for (const id of ["views", "assigned-to-me", "reported-by-me", "mentions-me", "due-this-week", "overdue", "high-priority"]) {
        expect(result.stdout).toContain(`${id}\thidden`);
      }
      expect(result.stdout).toContain(`view:${String(viewId)}\thidden\tOpen bugs`);
      expect(result.stdout).toContain("projects\tvisible");
    });
  });

  // @verifies SHL-54 — K158: a saved view is placed and hidden by
  // `view:<id>` among the built-ins; the file is written in the K158 shape.
  it("K158: orders a saved view among the built-ins and hides it by view:<id>", async () => {
    await withTmpLoctt(async ({ root }) => {
      const created = await runCli(["views", "create", "Open bugs"], { cwd: root });
      const viewId = String(/id (\S+)\)/.exec(created.stdout)?.[1]);
      const result = await runCli(
        ["user", "sidebar-groups", "--order", `view:${viewId},overdue`, "--hidden", `view:${viewId}`],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      const ids = result.stdout.trim().split("\n").map(l => l.split("\t")[0]);
      const at = ids.indexOf("views");
      expect(ids.slice(at + 1, at + 3)).toEqual([`view:${viewId}`, "overdue"]);
      expect(result.stdout).toContain(`view:${viewId}\thidden`);
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("version: 2");
      expect(file).toContain(`view:${viewId}`);
    });
  });

  // @verifies SHL-54 — K158: `view:<id>` naming no view is a typo, refused.
  it("K158: refuses view:<id> for a view that does not exist, naming it", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--hidden", "view:nope"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("view:nope");
      const file = await readFile(await settingsPath(root), "utf8").catch(() => "");
      expect(file).not.toContain("sidebar_groups");
    });
  });
});

import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { loadAllTasksDetailed } from "../task/load-all.js";
import { enableGit } from "./git-mode.js";
import { publish, sync } from "./publish-sync.js";

/**
 * GIT-34: the `loctt` branch carries a task whose frontmatter will not
 * parse. Sync must apply the rest, keep the bad file (not write it clean,
 * not abort), and REPORT the bad task by id + path so a surface can name
 * the file to inspect. The list-view broken render is separately proven
 * via `loadAllTasksDetailed`.
 */
describe("GIT-34 · a malformed remote task in a sync", () => {
  let root: string;
  let locttDir: string;
  let taskProjectId: string;

  const BAD_ID = "01BADBADBADBADBADBADBADBAD";
  const GOOD_ID = "01GOODGOODGOODGOODGOODGOOD";

  // Frontmatter with an unterminated quote — a YAML syntax error, the
  // object-fatal case the tolerant loader attributes as unreadable.
  const MALFORMED = `---\nid: ${BAD_ID}\nkey: T-901\ntitle: "unterminated\n`
    + `status: todo\nproject: __PROJECT__\ncreated_at: 2020-01-01T00:00:00.000Z\n`
    + `updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n`;

  const GOOD = `---\nid: ${GOOD_ID}\nkey: T-902\ntitle: Good remote task\n`
    + `status: todo\nproject: __PROJECT__\ncreated_at: 2020-01-01T00:00:00.000Z\n`
    + `updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-git34-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Seeds one malformed and one well-formed task onto the loctt branch. */
  async function seedBranch(): Promise<void> {
    const wt = join(root, ".seed-worktree");
    execSync(`git worktree add "${wt}" loctt`, { cwd: root, stdio: "pipe" });
    try {
      for (const [id, body] of [[BAD_ID, MALFORMED], [GOOD_ID, GOOD]] as const) {
        await mkdir(join(wt, "tasks", id), { recursive: true });
        await writeFile(
          join(wt, "tasks", id, "task.md"),
          body.replace(/__PROJECT__/g, taskProjectId),
          "utf-8",
        );
      }
      execSync("git add -A && git commit -m 'seed tasks incl. malformed'", { cwd: wt, stdio: "pipe" });
    } finally {
      execSync(`git worktree remove "${wt}" --force`, { cwd: root, stdio: "pipe" });
    }
  }

  // @verifies GIT-34
  it("reports the malformed task by id and applies the rest of the sync", async () => {
    // A local task so there is a pre-existing population the sync must keep.
    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: taskProjectId, title: "Local keeper" } });
    await saveState(locttDir, state);
    await publish(locttDir, root);

    await seedBranch();

    const result = await sync(locttDir, root);

    // The sync was NOT aborted — the good remote task and the counts landed.
    expect(result.updated).toBe(true);
    expect((result.copied ?? 0)).toBeGreaterThanOrEqual(2);

    // The malformed task is named by id + path, with a parse reason.
    expect(result.malformed).toBeDefined();
    const ids = (result.malformed ?? []).map(m => m.id);
    expect(ids).toContain(BAD_ID);
    // The good task is NOT reported malformed.
    expect(ids).not.toContain(GOOD_ID);
    const entry = (result.malformed ?? []).find(m => m.id === BAD_ID);
    expect(entry?.path).toBe(getTaskFilePath(locttDir, BAD_ID));
    expect(entry?.reason.length ?? 0).toBeGreaterThan(0);

    // The bad file was applied AS-IS (kept, not silently discarded) — its
    // malformed content is on disk, not rewritten "clean".
    const onDisk = await readFile(getTaskFilePath(locttDir, BAD_ID), "utf-8");
    expect(onDisk).toContain('title: "unterminated');

    // The good remote task did land, proving the bad one did not abort it.
    const goodOnDisk = await readFile(getTaskFilePath(locttDir, GOOD_ID), "utf-8");
    expect(goodOnDisk).toContain("Good remote task");
  });

  // @verifies GIT-34
  it("the list still renders: the malformed task shows as a broken-file row, not a crash", async () => {
    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: taskProjectId, title: "Local keeper" } });
    await saveState(locttDir, state);
    await publish(locttDir, root);
    await seedBranch();
    await sync(locttDir, root);

    // loadAllTasksDetailed is what the list surface reads: it keeps the
    // other tasks AND names the unreadable one, rather than throwing and
    // taking the whole list down.
    const detailed = await loadAllTasksDetailed(locttDir);
    // The good tasks still render.
    expect(detailed.tasks.length).toBeGreaterThanOrEqual(2);
    // The malformed one is surfaced as a broken-file entry by id + path.
    const broken = detailed.unreadable.find(u => u.id === BAD_ID);
    expect(broken).toBeDefined();
    expect(broken?.path).toBe(getTaskFilePath(locttDir, BAD_ID));

    // Sanity: the directory is present (the file was kept, not deleted).
    const dirs = await readdir(join(locttDir, "tasks"));
    expect(dirs).toContain(BAD_ID);
  });
});

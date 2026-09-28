import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { runDoctor } from "../diagnostics/doctor.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { readTask } from "../task/io.js";
import { enableGit } from "./git-mode.js";
import { publish, sync } from "./publish-sync.js";

/**
 * K151 (B46), closing G8: a branch whose tasks carry links without a rank
 * (published by a loctt that did not rank them, or hand-edited) is ranked
 * as the sync applies it, the way the 0.1.0 → 0.3.0 upgrade ranks: after
 * the group's highest rank, in stored order. Ranks the branch already
 * has are kept, so a reorder made on the other machine survives.
 */
describe("git sync ranks incoming unranked links (K151)", () => {
  let root: string;
  let locttDir: string;
  let projectId: string;

  const A = "01M0RANKA0000000000000000A";
  const B = "01M0RANKB0000000000000000B";
  const C = "01M0RANKC0000000000000000C";
  const D = "01M0RANKD0000000000000000D";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-sync-rank-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root, { docs: false, timezone: "UTC" });
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    projectId = (await loadProjectsConfig(locttDir)).projects[0]?.id as string;
    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: projectId, title: "Local work" } });
    await saveState(locttDir, state);
    await publish(locttDir, root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const taskFile = (id: string, key: string, rels: string): string =>
    `---\nid: ${id}\nkey: ${key}\ntitle: ${key}\nstatus: backlog\nproject: ${projectId}\n`
    + `created_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n`
    + (rels === "" ? "" : `relationships:\n${rels}`)
    + `---\nbody\n`;

  /** Commits tasks straight onto the `loctt` branch, as another machine would. */
  async function commitOnBranch(files: Record<string, string>): Promise<void> {
    const wt = join(root, ".advance");
    execSync(`git worktree add ${wt} loctt`, { cwd: root, stdio: "pipe" });
    try {
      for (const [id, content] of Object.entries(files)) {
        await mkdir(join(wt, "tasks", id), { recursive: true });
        await writeFile(join(wt, "tasks", id, "task.md"), content);
      }
      execSync("git add -A && git commit -m remote", { cwd: wt, stdio: "pipe" });
    } finally {
      execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
    }
  }

  it("ranks unranked incoming links, keeps the ranks the branch has, and leaves doctor nothing", async () => {
    await commitOnBranch({
      // All unranked: ranked in stored order.
      [A]: taskFile(A, "T-100", "  - type: blocks\n    target: B_ID\n  - type: blocks\n    target: D_ID\n"
        .replace("B_ID", B).replace("D_ID", D)),
      [B]: taskFile(B, "T-101", `  - type: is_blocked_by\n    target: ${A}\n`),
      // Mixed: `x` above `m` is a reorder from the other machine (array
      // order disagrees with rank order), and the third link is unranked.
      [C]: taskFile(C, "T-102",
        `  - type: relates_to\n    target: ${A}\n    rank: x\n`
        + `  - type: relates_to\n    target: ${B}\n    rank: m\n`
        + `  - type: relates_to\n    target: ${D}\n`),
      [D]: taskFile(D, "T-103",
        `  - type: is_blocked_by\n    target: ${A}\n`
        + `  - type: relates_to\n    target: ${C}\n`),
    });
    const result = await sync(locttDir, root);
    expect(result.updated).toBe(true);

    const a = await readTask(locttDir, A);
    expect(a.frontmatter.relationships?.map(r => [r.target, r.rank])).toEqual([[B, "u"], [D, expect.any(String)]]);
    const [ab, ad] = a.frontmatter.relationships ?? [];
    expect((ad?.rank ?? "") > (ab?.rank ?? "")).toBe(true);

    const c = await readTask(locttDir, C);
    const cr = c.frontmatter.relationships ?? [];
    // The branch's own ranks are untouched (the reorder survives)...
    expect(cr.map(r => [r.target, r.rank]).slice(0, 2)).toEqual([[A, "x"], [B, "m"]]);
    // ...and the unranked link lands after the highest of them.
    expect((cr[2]?.rank ?? "") > "x").toBe(true);

    const findings = (await runDoctor(root)).filter(ch => /has no rank/.test(ch.message));
    expect(findings).toEqual([]);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { getTaskDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "./create.js";
import { readTask } from "./io.js";
import { linkTask, MAX_CYCLE_CHECK_VISITS, RelationshipError } from "./relationships.js";

/**
 * @verifies REL-C3
 * @verifies REL-23
 *
 * REL-23 is the same guard stated from the UI side — "the add is
 * refused with a message saying the graph is too large to verify
 * safely ... it does not silently add the link, and it does not claim
 * a cycle exists when it hasn't proven one." All three of its bullets
 * are the three tests below, and the web route surfaces core's message
 * verbatim (`RelationshipError` is a `LocttError`, so the envelope
 * carries this sentence). Tagged here rather than transcribed into a
 * Playwright spec because the fixture is a 1000-node chain: through
 * the browser it would be minutes of setup for the same assertions.
 *
 * A `parent` chain past the walk cap must refuse the link rather than
 * assume the graph is acyclic — "too big to verify" and "verified fine"
 * are opposite answers, and only one of them is safe.
 *
 * The guard went untested because building the chain through `linkTask`
 * costs a full cycle walk per edge: 1000 links takes minutes, which is
 * how the fixture timed out the first time I built it. This writes the
 * chain's frontmatter directly, so only the final link — the one under
 * test — goes through the guard.
 */
describe("structural cycle-check cap", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cycle-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Creates `count` tasks and chains them with `parent` edges written
   * straight to disk. Returns ids oldest-first, so `ids[i+1]` is the
   * parent of `ids[i]`.
   */
  async function chain(count: number): Promise<string[]> {
    const projects = await loadProjectsConfig(locttDir);
    const project = projects.projects[0]?.id;
    if (project === undefined) throw new Error("fixture: init created no project");

    const state = await loadState(locttDir);
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const task = await createTask({ locttDir, state, options: { project, title: `n${i}` } });
      ids.push(task.frontmatter.id);
    }
    await saveState(locttDir, state);

    // Bilateral edges, written as linkTask would leave them, without
    // paying for the cycle walk on each one.
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as string;
      const parent = ids[i + 1];
      const child = ids[i - 1];
      const rels: Array<{ type: string; target: string }> = [];
      if (parent !== undefined) rels.push({ type: "parent", target: parent });
      if (child !== undefined) rels.push({ type: "child", target: child });

      const task = await readTask(locttDir, id);
      const fm = { ...task.frontmatter, relationships: rels };
      const yaml = Object.entries(fm)
        .filter(([, v]) => v !== undefined && !Array.isArray(v))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n");
      const relYaml = rels
        .map(r => `  - type: ${r.type}\n    target: ${r.target}`)
        .join("\n");
      await writeFile(
        join(getTaskDir(locttDir, id), "task.md"),
        `---\n${yaml}\nrelationships:\n${relYaml}\n---\n\n${task.body}`,
        "utf8",
      );
    }
    return ids;
  }

  it("refuses a link into a chain longer than the cap", async () => {
    // One past the cap, so the walk exhausts its budget.
    const ids = await chain(MAX_CYCLE_CHECK_VISITS + 2);
    const workflowConfig = await loadWorkflowConfig(locttDir);

    const head = ids[0] as string;
    const tail = ids[ids.length - 1] as string;

    const err = await linkTask({
      locttDir,
      taskId: tail,
      type: "parent",
      target: head,
      workflowConfig,
    }).catch((e: unknown) => e) as Error;

    expect(err).toBeInstanceOf(RelationshipError);
    // Names the cap, so the user knows what was exceeded rather than
    // just that something was.
    expect(err.message).toMatch(/too large to verify cycles/);
    expect(err.message).toContain(String(MAX_CYCLE_CHECK_VISITS));
  }, 120_000);

  it("writes no edge to either task when it refuses", async () => {
    const ids = await chain(MAX_CYCLE_CHECK_VISITS + 2);
    const workflowConfig = await loadWorkflowConfig(locttDir);

    const head = ids[0] as string;
    const tail = ids[ids.length - 1] as string;
    const before = {
      head: (await readTask(locttDir, head)).frontmatter.relationships?.length ?? 0,
      tail: (await readTask(locttDir, tail)).frontmatter.relationships?.length ?? 0,
    };

    await linkTask({
      locttDir,
      taskId: tail,
      type: "parent",
      target: head,
      workflowConfig,
    }).catch(() => undefined);

    // A refusal that had already written one side would leave a
    // one-sided edge — worse than either outcome, since nothing reports
    // it and the inverse never appears.
    //
    // This holds for *any* refusal, not only the cap's: disabling the
    // cap makes the same link fail as a detected cycle and this still
    // passes. It is a no-partial-write assertion, and the cap-specific
    // half lives in the test above.
    expect((await readTask(locttDir, head)).frontmatter.relationships?.length ?? 0)
      .toBe(before.head);
    expect((await readTask(locttDir, tail)).frontmatter.relationships?.length ?? 0)
      .toBe(before.tail);
  }, 120_000);

  it("still links inside a chain comfortably under the cap", async () => {
    // Guards the cap from over-reaching: an ordinary graph must not
    // start refusing links.
    const ids = await chain(10);
    const workflowConfig = await loadWorkflowConfig(locttDir);

    const linked = await linkTask({
      locttDir,
      taskId: ids[0] as string,
      type: "blocks",
      target: ids[5] as string,
      workflowConfig,
    });
    expect(linked.frontmatter.relationships?.some(r => r.type === "blocks")).toBe(true);
  }, 60_000);
});

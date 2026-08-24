import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/index.js";
import { createMilestone } from "../milestones/manage.js";
import { resolveLocttDir } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { loadState, saveState } from "../state/state.js";
import { createUser } from "../users/lifecycle.js";
import { bulkSetFields } from "./bulk.js";
import { createTask } from "./create.js";
import { readTask } from "./io.js";
import { setField, setFields } from "./update.js";

/**
 * The single-task and multi-task write paths must store the same thing.
 *
 * `resolveEntityRef` converts a milestone / sprint / assignee **name**
 * to its ULID before writing. It had one call site — inside `setField`
 * — so `setFields` and `bulkSetFields` wrote the raw string:
 *
 *   loctt set T1     milestone v1  ->  01M0SAA043ZZ1FQS…
 *   loctt set T1,T2  milestone v1  ->  v1
 *
 * Identity is a ULID (P-2), so the name form resolves to nothing:
 * `doctor` reports a dangling reference, milestone progress reads 0/0,
 * and both the archived guard and `deleteUser`'s reference scan match
 * on id, so neither sees it. This is MSL-C1 reopening on the path its
 * original fix did not cover.
 */

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-parity-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  projectId = (await loadProjectsConfig(locttDir)).projects[0]!.id;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(title: string): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: { project: projectId, title } });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

describe("a name resolves to an id on every write path", () => {
  it("setFields stores the milestone id, like setField", async () => {
    const ms = await createMilestone(locttDir, { name: "v1" });
    const a = await seed("a");
    const b = await seed("b");

    await setField({ locttDir, taskId: a, field: "milestone", value: "v1" });
    await setFields({ locttDir, taskId: b, changes: [{ field: "milestone", value: "v1" }] });

    // The load-bearing assertion: before the fix, `b` held "v1".
    expect((await readTask(locttDir, a)).frontmatter.milestone).toBe(ms.id);
    expect((await readTask(locttDir, b)).frontmatter.milestone).toBe(ms.id);
  });

  it("bulkSetFields stores the id too, since it delegates to setFields", async () => {
    const ms = await createMilestone(locttDir, { name: "v1" });
    const a = await seed("a");
    const b = await seed("b");

    // The CLI routes to bulk whenever more than one ref is given, so
    // `loctt set T1,T2 milestone v1` is enough to reach this.
    await bulkSetFields({
      locttDir, taskRefs: [a, b], changes: [{ field: "milestone", value: "v1" }],
    });

    expect((await readTask(locttDir, a)).frontmatter.milestone).toBe(ms.id);
    expect((await readTask(locttDir, b)).frontmatter.milestone).toBe(ms.id);
  });

  it("setFields resolves an assignee name to a user id", async () => {
    // A name `initLoctt`'s default user does not already hold — two
    // users with one name is an ambiguity error, not a resolution test.
    const user = await createUser(locttDir, { name: "sam" });
    const a = await seed("a");

    await setFields({ locttDir, taskId: a, changes: [{ field: "assignee", value: "sam" }] });

    expect((await readTask(locttDir, a)).frontmatter.assignee).toBe(user.id);
  });

  it("setFields refuses an assignee that resolves to nobody", async () => {
    const a = await seed("a");
    // `setField` has rejected this since MSL-C1; `setFields` accepted it
    // and wrote a reference to a user who does not exist.
    await expect(
      setFields({ locttDir, taskId: a, changes: [{ field: "assignee", value: "nobody" }] }),
    ).rejects.toThrow(/unknown user/);
  });

  it("leaves an id alone rather than double-resolving it", async () => {
    const ms = await createMilestone(locttDir, { name: "v1" });
    const a = await seed("a");

    // Passing the id must work as well as passing the name — a caller
    // that already resolved must not be punished for it.
    await setFields({ locttDir, taskId: a, changes: [{ field: "milestone", value: ms.id }] });

    expect((await readTask(locttDir, a)).frontmatter.milestone).toBe(ms.id);
  });
});

describe("a write refuses a reference to an entity that does not exist", () => {
  it("rejects a label id that was never created", async () => {
    const a = await seed("a");
    const guard = await loadArchivedGuardConfigs(locttDir);
    const wf = await loadWorkflowConfig(locttDir);

    // Labels are the case only the existence check can catch:
    // `resolveEntityRef` handles milestone / sprint / assignee /
    // reporter and passes labels straight through. So this is the one
    // input that proves `aux` is reaching `validateTaskAgainstWorkflow`
    // — a milestone test would pass on name-resolution alone.
    //
    // Only `doctor` used to pass `aux`, so a task could reference a
    // label that never existed and the user learned about it from a
    // diagnostic rather than from the write that caused it.
    await expect(
      setFields({
        locttDir, taskId: a,
        changes: [{ field: "labels", value: ["01M0NOSUCHLABEL000000000"] }],
        workflowConfig: wf,
        archivedGuard: guard,
      }),
    ).rejects.toThrow(/unknown label/);
  });

  it("rejects an unregistered label on create too", async () => {
    const guard = await loadArchivedGuardConfigs(locttDir);
    const wf = await loadWorkflowConfig(locttDir);

    await expect(withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      return createTask({
        locttDir, state,
        options: { project: projectId, title: "t", labels: ["01M0NOSUCHLABEL000000000"] },
        workflowConfig: wf,
        archivedGuard: guard,
      });
    })).rejects.toThrow(/unknown label/);
  });

  it("says what is wrong when labels is not an array", async () => {
    const a = await seed("a");
    const guard = await loadArchivedGuardConfigs(locttDir);
    const wf = await loadWorkflowConfig(locttDir);

    // Turning on the existence check made this branch reachable for the
    // first time, and it assumed an array: a bare string crashed with
    // "fm.labels.entries is not a function" rather than naming the
    // problem. Shape is checked before membership.
    await expect(
      setFields({
        locttDir, taskId: a,
        changes: [{ field: "labels", value: "notanarray" }],
        workflowConfig: wf,
        archivedGuard: guard,
      }),
    ).rejects.toThrow(/labels must be an array/);
  });

  it("accepts a label that does exist", async () => {
    const { createLabel } = await import("../labels/manage.js");
    const label = await createLabel(locttDir, { name: "bug" });
    const a = await seed("a");
    // Reload the guard so it sees the label just created.
    const guard = await loadArchivedGuardConfigs(locttDir);
    const wf = await loadWorkflowConfig(locttDir);

    await expect(
      setFields({
        locttDir, taskId: a,
        changes: [{ field: "labels", value: [label.id] }],
        workflowConfig: wf,
        archivedGuard: guard,
      }),
    ).resolves.toBeDefined();
  });

  it("still accepts a milestone that does exist", async () => {
    const ms = await createMilestone(locttDir, { name: "v1" });
    const a = await seed("a");
    // Guards against the check rejecting everything, which would make
    // the tracker unwritable rather than safe.
    await expect(
      setFields({ locttDir, taskId: a, changes: [{ field: "milestone", value: ms.id }] }),
    ).resolves.toBeDefined();
  });
});

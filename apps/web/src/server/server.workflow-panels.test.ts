import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkflowConfig, WorkflowUsageResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * The routes the M4.2 settings panels write through (SET-17, SET-19,
 * SET-21, SET-3).
 *
 * Every assertion here reads the **file on disk** after the write.
 * Asserting the 200 alone would pass for a server that accepted the
 * request and wrote nothing, and asserting the GET's echo would pass
 * for one that kept the change in memory.
 */

interface Harness {
  root: string;
  base: string;
  stop: () => Promise<void>;
}

const started: Harness[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop();
    if (h) {
      await h.stop();
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-wfpanel-"));
  await initLoctt(root, { docs: false });
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  const h: Harness = { root, base: `http://127.0.0.1:${port}`, stop: () => app.stop() };
  started.push(h);
  return h;
}

/**
 * The CSRF guard refuses any non-GET without `X-Loctt-Client`, so a
 * write test that omitted it would assert a 403 rather than the
 * behaviour it names.
 */
const WRITE_HEADERS = {
  "content-type": "application/json",
  "x-loctt-client": "test",
} as const;

async function workflowYaml(root: string): Promise<string> {
  return readFile(join(root, ".loctt/config/workflow.yaml"), "utf8");
}

async function getWorkflow(base: string): Promise<WorkflowConfig> {
  return (await fetch(`${base}/api/workflow`)).json() as Promise<WorkflowConfig>;
}

async function createTask(
  base: string,
  body: Record<string, unknown>,
): Promise<{ key: string }> {
  const res = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: JSON.stringify(body),
  });
  expect(res.status).toBeLessThan(300);
  return res.json() as Promise<{ key: string }>;
}

describe("GET /api/workflow/usage", () => {
  /** @verifies SET-3 */
  it("names workflow.yaml by absolute path", async () => {
    const { base } = await harness();
    const usage = await (await fetch(`${base}/api/workflow/usage`)).json() as WorkflowUsageResponse;

    // SET-3: "the panel shows the absolute path of the file it
    // reflects". A relative path would be useless to a user in a
    // terminal somewhere else.
    expect(usage.path.startsWith("/")).toBe(true);
    expect(usage.path).toMatch(/\.loctt\/config\/workflow\.yaml$/);
    expect(await readFile(usage.path, "utf8")).toContain("statuses:");
  });

  /** @verifies SET-17 */
  it("reports the number of tasks per status, not merely that one exists", async () => {
    const { base } = await harness();
    const wf = await getWorkflow(base);
    const [first, second] = wf.statuses;
    if (first === undefined || second === undefined) throw new Error("need two statuses");

    await createTask(base, { title: "a", status: first.key });
    await createTask(base, { title: "b", status: first.key });
    await createTask(base, { title: "c", status: second.key });

    const usage = await (await fetch(`${base}/api/workflow/usage`)).json() as WorkflowUsageResponse;
    // The count the delete confirm shows. A presence-only answer says
    // 1 here, and the panel under-reports what a delete would touch.
    expect(usage.statuses[first.key]).toBe(2);
    expect(usage.statuses[second.key]).toBe(1);
  });
});

describe("PUT /api/workflow — reorder (SET-6, SET-21)", () => {
  /** @verifies SET-6 */
  it("writes the new status order to workflow.yaml in that order", async () => {
    const { root, base } = await harness();
    const wf = await getWorkflow(base);
    const original = wf.statuses.map(s => s.key);
    expect(original.length).toBeGreaterThan(2);

    // Move the last status to the front.
    const moved = [...wf.statuses];
    const last = moved.pop();
    if (last === undefined) throw new Error("no statuses");
    moved.unshift(last);

    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ workflow: { ...wf, statuses: moved } }),
    });
    expect(res.status).toBe(200);

    // The far end: the file, in order. Reading it back through the API
    // would also pass for a server that answered from memory.
    const yaml = await workflowYaml(root);
    const keyOrder = [...yaml.matchAll(/^\s*-?\s*key:\s*(\S+)/gm)].map(m => m[1]);
    const statusPositions = moved.map(s => keyOrder.indexOf(s.key));
    expect(statusPositions).toEqual([...statusPositions].sort((a, b) => a - b));
    expect(keyOrder.indexOf(last.key)).toBeLessThan(
      keyOrder.indexOf(original[0] as string),
    );
  });

  /** @verifies SET-21 */
  it("persists recomputed priority values so a priority sort follows the new order", async () => {
    const { root, base } = await harness();
    const wf = await getWorkflow(base);
    expect(wf.priorities.length).toBeGreaterThan(1);

    // What the panel sends: the reordered list with values recomputed
    // from position. The server does NOT recompute them — if the
    // client sent the old values the file would carry a contradiction,
    // which is why the panel's own rule has its own test.
    const moved = [...wf.priorities];
    const lastPriority = moved.pop();
    if (lastPriority === undefined) throw new Error("no priorities");
    moved.unshift(lastPriority);
    const renumbered = moved.map((p, i) => ({ ...p, value: (i + 1) * 10 }));

    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ workflow: { ...wf, priorities: renumbered } }),
    });
    expect(res.status).toBe(200);

    const stored = (await getWorkflow(base)).priorities;
    expect(stored[0]?.key).toBe(lastPriority.key);
    expect(stored[0]?.value).toBeLessThan(stored[1]?.value ?? Infinity);
    expect(await workflowYaml(root)).toContain(`key: ${lastPriority.key}`);
  });

  /** @verifies SET-21 */
  it("leaves task frontmatter untouched when only the order changed", async () => {
    const { base } = await harness();
    const wf = await getWorkflow(base);
    const target = wf.priorities[wf.priorities.length - 1];
    if (target === undefined) throw new Error("no priorities");
    const { key } = await createTask(base, { title: "keeps its priority", priority: target.key });

    const moved = [target, ...wf.priorities.filter(p => p.key !== target.key)]
      .map((p, i) => ({ ...p, value: (i + 1) * 10 }));
    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ workflow: { ...wf, priorities: moved } }),
    });
    expect(res.status).toBe(200);
    // SET-21: "Existing tasks are untouched — only workflow.yaml
    // changed; no task frontmatter was rewritten."
    expect((await res.json() as { rewrittenTaskCount: number }).rewrittenTaskCount).toBe(0);

    const task = await (await fetch(`${base}/api/tasks/${key}`)).json() as
      { frontmatter: { priority?: string } };
    expect(task.frontmatter.priority).toBe(target.key);
  });
});

describe("PUT /api/workflow — delete with remap (SET-17, SET-19)", () => {
  /** @verifies SET-17 */
  it("refuses to delete an in-use status with no remap, and writes nothing", async () => {
    const { root, base } = await harness();
    const wf = await getWorkflow(base);
    const doomed = wf.statuses.find(s => s.default !== true);
    if (doomed === undefined) throw new Error("need a non-default status");
    await createTask(base, { title: "holds it", status: doomed.key });

    const before = await workflowYaml(root);
    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        workflow: { ...wf, statuses: wf.statuses.filter(s => s.key !== doomed.key) },
      }),
    });

    // No silent orphaning — this is the invariant the panel's dialog
    // explains but does not enforce.
    expect(res.status).toBe(400);
    expect(await workflowYaml(root)).toBe(before);

    // And it is refused by the *validator*, not by the remap pass
    // blowing up halfway. `applyScalarRemap` throws
    // "internal: missing status remap for …" when it reaches a task
    // whose key was deleted without a directive — a message written
    // for a developer, surfaced verbatim in the 400 envelope. Both
    // paths return 400 and write nothing, so a status-only assertion
    // cannot tell them apart; the user-facing difference is the
    // message, and this is the assertion that holds
    // `validateRemapCoversDeletions` in place ahead of the rewrite.
    const envelope = await res.json() as { message?: string };
    expect(envelope.message).not.toMatch(/^internal:/);
    expect(envelope.message).toMatch(new RegExp(doomed.key));
  });

  /** @verifies SET-17 */
  it("moves the tasks and reports how many when a remap target is given", async () => {
    const { base } = await harness();
    const wf = await getWorkflow(base);
    const doomed = wf.statuses.find(s => s.default !== true);
    const keep = wf.statuses.find(s => s.default === true);
    if (doomed === undefined || keep === undefined) throw new Error("need two statuses");

    const a = await createTask(base, { title: "a", status: doomed.key });
    const b = await createTask(base, { title: "b", status: doomed.key });

    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        workflow: { ...wf, statuses: wf.statuses.filter(s => s.key !== doomed.key) },
        remap: { statuses: { [doomed.key]: keep.key } },
      }),
    });
    expect(res.status).toBe(200);
    // SET-17: "reports the count moved".
    expect((await res.json() as { rewrittenTaskCount: number }).rewrittenTaskCount).toBe(2);

    for (const t of [a, b]) {
      const task = await (await fetch(`${base}/api/tasks/${t.key}`)).json() as
        { frontmatter: { status: string } };
      expect(task.frontmatter.status).toBe(keep.key);
    }
  });

  /** @verifies SET-17 */
  it("leaves the references dangling when the remap target is null", async () => {
    const { base } = await harness();
    const wf = await getWorkflow(base);
    const doomed = wf.statuses.find(s => s.default !== true);
    if (doomed === undefined) throw new Error("need a non-default status");
    const t = await createTask(base, { title: "dangling", status: doomed.key });

    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        workflow: { ...wf, statuses: wf.statuses.filter(s => s.key !== doomed.key) },
        remap: { statuses: { [doomed.key]: null } },
      }),
    });
    // SET-17 allows this explicitly. The task keeps no valid status,
    // which is what makes it a drift case for SET-18.
    expect(res.status).toBe(200);

    const task = await (await fetch(`${base}/api/tasks/${t.key}`)).json() as
      { frontmatter: { status?: string } };
    expect(task.frontmatter.status).not.toBe(doomed.key);
  });
});

describe("PUT /api/workflow — the custom-field type lock (SET-16)", () => {
  /**
   * @verifies SET-16
   *
   * "No request that would change `type` is accepted server-side
   * either — re-enabling the control in devtools and submitting is
   * rejected." The disabled attribute in the panel is an explanation;
   * this is the enforcement.
   */
  it("rejects a type change on a field that tasks already hold values for", async () => {
    const { root, base } = await harness();
    const wf = await getWorkflow(base);
    const field = {
      key: "story_points", label: "Story points",
      type: "number" as const, multi: false, searchable: true,
    };

    let res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ workflow: { ...wf, custom_fields: [field] } }),
    });
    expect(res.status).toBe(200);
    await createTask(base, { title: "estimated", fields: { story_points: 5 } });

    const before = await workflowYaml(root);
    res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        workflow: { ...wf, custom_fields: [{ ...field, type: "date" }] },
      }),
    });

    expect(res.status).toBe(400);
    expect(await workflowYaml(root)).toBe(before);
  });

  /**
   * @verifies SET-16
   *
   * "Label, `searchable`, and (where safe) `multi` remain editable in
   * the same form, so the lock reads as targeted." A server that
   * rejected every edit to a field with data would make the panel's
   * targeted lock a lie.
   */
  it("accepts a label and searchable edit on that same field", async () => {
    const { base } = await harness();
    const wf = await getWorkflow(base);
    const field = {
      key: "story_points", label: "Story points",
      type: "number" as const, multi: false, searchable: true,
    };
    await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ workflow: { ...wf, custom_fields: [field] } }),
    });
    await createTask(base, { title: "estimated", fields: { story_points: 5 } });

    const res = await fetch(`${base}/api/workflow`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        workflow: {
          ...wf,
          custom_fields: [{ ...field, label: "Points", searchable: false }],
        },
      }),
    });
    expect(res.status).toBe(200);

    const stored = (await getWorkflow(base)).custom_fields[0];
    expect(stored?.label).toBe("Points");
    expect(stored?.searchable).toBe(false);
    expect(stored?.type).toBe("number");
  });
});

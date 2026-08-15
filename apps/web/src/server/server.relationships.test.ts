import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/tasks/:ref` — relationships on the response.
 *
 * handleGetTask built the full show model, including resolved
 * relationships, and then dropped them: TaskResponse had no field for
 * them. The documented Relationships panel therefore had no data, and
 * B14 (each row showing its target's live status) was unbuildable.
 */
describe("GET /api/tasks/:ref relationships", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-rel-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;

    for (const title of ["Parent task", "Blocked task"]) {
      await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf, body: JSON.stringify({ title }),
      });
    }
    await fetch(`${base}/api/tasks/T-1/link`, {
      method: "POST", headers: csrf,
      body: JSON.stringify({ type: "blocks", target: "T-2" }),
    });
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const get = async (ref: string): Promise<TaskResponse> => {
    const res = await fetch(`${base}/api/tasks/${ref}`);
    expect(res.status).toBe(200);
    return (await res.json()) as TaskResponse;
  };

  it("returns the edge with its target resolved to a key", async () => {
    const task = await get("T-1");
    expect(task.relationships).toHaveLength(1);
    const edge = task.relationships[0]!;
    expect(edge.type).toBe("blocks");
    expect(edge.resolvedKey).toBe("T-2");
    expect(edge.missing).toBe(false);
  });

  it("carries the target's live title and status (B14)", async () => {
    const edge = (await get("T-1")).relationships[0]!;
    expect(edge.resolvedTitle).toBe("Blocked task");
    expect(edge.resolvedStatus).toBe("backlog");
  });

  it("reflects a target's status change without touching the edge", async () => {
    // The point of resolving per request rather than denormalizing onto
    // the edge: a stored copy would go stale here.
    await fetch(`${base}/api/tasks/T-2/set`, {
      method: "POST", headers: csrf,
      body: JSON.stringify({ field: "status", value: "in_progress" }),
    });
    const edge = (await get("T-1")).relationships[0]!;
    expect(edge.resolvedStatus).toBe("in_progress");
  });

  it("returns the inverse edge on the target", async () => {
    // linkTask writes both directions, so the panel on T-2 has a row too.
    const target = await get("T-2");
    expect(target.relationships).toHaveLength(1);
    expect(target.relationships[0]?.type).toBe("is_blocked_by");
    expect(target.relationships[0]?.resolvedKey).toBe("T-1");
  });

  it("flags body constructs the visual editor cannot represent (B5)", async () => {
    // Detected server-side so every client applies one rule. TipTap
    // drops unregistered nodes, so opening this body visually and
    // saving would delete the footnote with no warning.
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf,
      body: JSON.stringify({ title: "Has a footnote", body: "A claim[^1].\n\n[^1]: note" }),
    });
    const { key } = await res.json() as { key: string };
    const task = await get(key);
    expect(task.lossyConstructs).toHaveLength(2);
    expect(task.lossyConstructs[0]?.kind).toBe("footnote");
  });

  it("reports nothing lossy for a body using LocTT's own syntax", () => {
    // KaTeX, super/subscript, mentions and attachment embeds all have
    // TipTap nodes, so they round-trip and must NOT force source mode.
    // Over-reporting trains users to ignore the banner.
    return (async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({
          title: "Rich but safe",
          body: "$e^{i\\pi}$ and x^2^ and H~2~O\n\n![d](attachments/a.png)",
        }),
      });
      const { key } = await res.json() as { key: string };
      expect((await get(key)).lossyConstructs).toEqual([]);
    })();
  });

  it("returns an empty array for a task with no edges", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Lonely" }),
    });
    const { key } = await res.json() as { key: string };
    expect((await get(key)).relationships).toEqual([]);
  });
});

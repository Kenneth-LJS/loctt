import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task, TaskResponse } from "@loctt/contracts";
import { initLoctt, readTask, rebuildKeyIndex, writeTask } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies GIT-19
 *
 * The load-bearing data-integrity guard: an edit submitted from a tab
 * still holding a task's OLD key, after a collision rekey renumbered that
 * task and handed its old key to a DIFFERENT task, must never land on the
 * other task. It lands on the intended task by id, or is refused — never a
 * silent wrong-task write (bullet 3).
 *
 * The scenario is crafted directly on disk rather than by driving a real
 * sync, because the reconcile/rekey engine is out of scope here and the
 * only thing under test is how the write path resolves a stale ref:
 *
 *   - `01LOSER`  key WEB-31, key_history [WEB-14]   (the tab's task, renumbered)
 *   - `01WINNER` key WEB-14                          (now holds the old key)
 *
 * After `rebuildKeyIndex`, `WEB-14` resolves to the WINNER (live keys
 * shadow historical — see the core lookup test). So a write by `WEB-14`
 * alone would hit `01WINNER`. The web client sends `expectedId: 01LOSER`
 * (the id it fetched), and the server refuses the mismatch.
 *
 * Everything asserts against the file on disk (P1): a 200 that wrote the
 * wrong file is exactly the failure this exists to prevent.
 */
describe("POST /api/tasks/:ref/set — the GIT-19 expectedId precondition", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  const loser: Task = {
    frontmatter: {
      id: "01LOSER",
      key: "WEB-31",
      title: "the task the tab has open",
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      key_history: ["WEB-14"],
    },
    body: "loser body",
  };
  const winner: Task = {
    frontmatter: {
      id: "01WINNER",
      key: "WEB-14",
      title: "the OTHER task that now holds WEB-14",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "winner body",
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-git19-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
    await writeTask(locttDir, loser.frontmatter.id, loser);
    await writeTask(locttDir, winner.frontmatter.id, winner);
    await rebuildKeyIndex(locttDir);

    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const setField = async (
    ref: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; payload: Record<string, unknown> }> => {
    const res = await fetch(`${base}/api/tasks/${encodeURIComponent(ref)}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify(body),
    });
    return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
  };

  const titleOnDisk = async (id: string): Promise<string | undefined> =>
    (await readTask(locttDir, id)).frontmatter.title;

  it("confirms the hazard: the stale key WEB-14 resolves to the winner via the API", async () => {
    // GET is a read; the point is only that WEB-14 now names the winner,
    // which is what makes a naive by-key write dangerous.
    const res = await fetch(`${base}/api/tasks/WEB-14`);
    const task = (await res.json()) as TaskResponse;
    expect(task.frontmatter.id).toBe("01WINNER");
  });

  it("refuses an edit against the stale WEB-14 when expectedId is the loser — nothing touches the winner", async () => {
    const { status, payload } = await setField("WEB-14", {
      field: "title",
      value: "EDIT FROM THE STALE TAB",
      expectedId: "01LOSER",
    });

    // Refused, not applied.
    expect(status).toBe(409);
    expect(payload["code"]).toBe("conflict");
    expect(payload["data_state"]).toBe("not_saved");
    expect(payload["recovery"]).toEqual({ kind: "reload" });

    // The load-bearing assertion: the WINNER's title is untouched. Without
    // the guard this write lands on 01WINNER (WEB-14 resolves to it).
    expect(await titleOnDisk("01WINNER")).toBe("the OTHER task that now holds WEB-14");
    // And the loser was not touched either — the ref did not resolve to it.
    expect(await titleOnDisk("01LOSER")).toBe("the task the tab has open");
  });

  it("an edit targeting the loser by its CURRENT key lands on the loser", async () => {
    const { status } = await setField("WEB-31", {
      field: "title",
      value: "renamed via current key",
      expectedId: "01LOSER",
    });
    expect(status).toBe(200);
    expect(await titleOnDisk("01LOSER")).toBe("renamed via current key");
    expect(await titleOnDisk("01WINNER")).toBe("the OTHER task that now holds WEB-14");
  });

  it("an edit targeting the winner by WEB-14 with the winner's id succeeds", async () => {
    const { status } = await setField("WEB-14", {
      field: "title",
      value: "winner renamed on purpose",
      expectedId: "01WINNER",
    });
    expect(status).toBe(200);
    expect(await titleOnDisk("01WINNER")).toBe("winner renamed on purpose");
    expect(await titleOnDisk("01LOSER")).toBe("the task the tab has open");
  });

  it("without expectedId the write is last-write-wins by ref (CLI/MCP behaviour preserved)", async () => {
    // No precondition on the wire → resolve by ref, write. WEB-14 → winner.
    const { status } = await setField("WEB-14", {
      field: "title",
      value: "no precondition here",
    });
    expect(status).toBe(200);
    expect(await titleOnDisk("01WINNER")).toBe("no precondition here");
  });

  it("a malformed expectedId is refused, not treated as absent", async () => {
    const { status, payload } = await setField("WEB-14", {
      field: "title",
      value: "x",
      expectedId: 42,
    });
    expect(status).toBe(400);
    expect(payload["data_state"]).toBe("not_saved");
    // Nothing written.
    expect(await titleOnDisk("01WINNER")).toBe("the OTHER task that now holds WEB-14");
  });
});

/**
 * @verifies GIT-19
 *
 * Bullet 4: reloading the tab on the OLD URL still resolves — via
 * `key_history` — and the API returns the task's current key with the old
 * one retired, which is what lets the detail view show the current key as
 * authoritative and explain the change. Here there is no competing winner,
 * i.e. the plain "rekeyed, tab reloaded" case.
 */
describe("GET /api/tasks/:ref — GIT-19 bullet 4 (reload resolves via key_history)", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-git19-reload-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
    await writeTask(locttDir, "01SOLO", {
      frontmatter: {
        id: "01SOLO",
        key: "WEB-31",
        title: "renumbered",
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        key_history: ["WEB-14"],
      },
      body: "",
    });
    await rebuildKeyIndex(locttDir);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("the retired key WEB-14 still lands on the same task, reporting the current key", async () => {
    const res = await fetch(`${base}/api/tasks/WEB-14`);
    expect(res.status).toBe(200);
    const task = (await res.json()) as TaskResponse;
    expect(task.frontmatter.id).toBe("01SOLO");
    expect(task.frontmatter.key).toBe("WEB-31");
    expect(task.frontmatter.key_history).toContain("WEB-14");
  });
});

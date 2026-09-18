import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `POST /api/tasks/:ref/duplicate` — TSK-20's data bullets, asserted
 * against the files on disk rather than the response body.
 *
 * The response is the route's own account of what it did, so believing
 * it about `key_history` or about the source surviving would be
 * circular: a handler that copied nothing and answered with the
 * source's frontmatter would pass every response-shaped assertion
 * here. Every claim below is read back out of `.loctt/tasks/`.
 */
describe("POST /api/tasks/:ref/duplicate", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-duplicate-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  /** The raw `task.md` of the task with this key, straight off disk. */
  async function fileOf(key: string): Promise<string> {
    const tasksDir = join(root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      let text: string;
      try {
        text = await readFile(join(tasksDir, id, "task.md"), "utf8");
      } catch {
        continue;
      }
      if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return text;
    }
    throw new Error(`no task on disk with key ${key}`);
  }

  async function create(body: unknown): Promise<TaskFrontmatterPublic> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as TaskFrontmatterPublic;
  }

  async function duplicate(ref: string): Promise<Response> {
    return fetch(`${base}/api/tasks/${ref}/duplicate`, { method: "POST", headers: csrf });
  }

  // @verifies TSK-20
  it("copies title, body and metadata to a fresh key, leaving the source untouched", async () => {
    const source = await create({
      title: "Duplicable task",
      body: "The body that must be carried over.\n",
      priority: "high",
    });

    const before = await fileOf(source.key);

    const res = await duplicate(source.key);
    expect(res.status).toBe(200);
    const copy = (await res.json()) as TaskFrontmatterPublic;

    // A distinct, newly allocated key — not the source's, and not a
    // reused one. Paired with the source still resolving, so this
    // cannot pass by the route having rekeyed the original in place.
    expect(copy.key).not.toBe(source.key);
    expect(copy.id).not.toBe(source.id);

    const copyFile = await fileOf(copy.key);

    // Title carries the source's, plus core's `(copy)` suffix (A24).
    expect(copyFile).toMatch(/^title:\s*Duplicable task \(copy\)\s*$/m);
    // Body — the part a frontmatter-only copy would silently drop.
    expect(copyFile).toContain("The body that must be carried over.");
    // Metadata.
    expect(copyFile).toMatch(/^priority:\s*high\s*$/m);

    // `key_history` empty on the copy: the key is fresh, so there is
    // no retired key to record. Paired with the positive assertion
    // that the copy does have a `key`, so an empty file would fail.
    expect(copyFile).not.toMatch(/^key_history:/m);
    expect(copyFile).toMatch(/^key:\s*\S+\s*$/m);

    // Fresh timestamps: the copy's `created_at` is its own, not the
    // source's carried across.
    const srcCreated = /^created_at:\s*(\S+)\s*$/m.exec(before)?.[1];
    const copyCreated = /^created_at:\s*(\S+)\s*$/m.exec(copyFile)?.[1];
    expect(srcCreated).toBeDefined();
    expect(copyCreated).toBeDefined();
    expect(copyCreated).not.toBe(srcCreated);

    // The far end of TSK-20's fourth bullet: the source file is
    // byte-identical to what it was before the duplicate. Nothing on
    // screen would signal a change here, so nothing but this catches
    // a route that rekeyed, retitled or re-stamped the original.
    expect(await fileOf(source.key)).toBe(before);
  });

  // @verifies TSK-20
  it("allocates the next key rather than reusing one, across repeated duplicates", async () => {
    const source = await create({ title: "Twice-copied task" });

    const first = (await (await duplicate(source.key)).json()) as TaskFrontmatterPublic;
    const second = (await (await duplicate(source.key)).json()) as TaskFrontmatterPublic;

    // Three distinct keys. Duplicating the *same* source twice is the
    // case that catches a counter that was read but never persisted:
    // both copies would come back with the same key.
    const keys = new Set([source.key, first.key, second.key]);
    expect(keys.size).toBe(3);

    // And all three exist on disk under those keys — a set of three
    // distinct strings proves nothing if one of them names no file.
    for (const key of keys) {
      expect(await fileOf(key)).toMatch(new RegExp(`^key:\\s*${key}\\s*$`, "m"));
    }
  });

  // @verifies TSK-20
  it("404s on an unknown source without allocating a key", async () => {
    const before = await readFile(join(root, ".loctt", "state.yaml"), "utf8");

    const res = await duplicate("T-99999");
    expect(res.status).toBe(404);

    // The counter did not move: a refused duplicate must not burn a
    // key, or the next real task skips a number for no reason.
    expect(await readFile(join(root, ".loctt", "state.yaml"), "utf8")).toBe(before);
  });
});

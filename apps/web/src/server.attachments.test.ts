import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

const BOUNDARY = "----loctttest";

function buildMultipart(
  fieldName: string,
  filename: string,
  content: Buffer | string,
): { body: ArrayBuffer; contentType: string } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n`
      + `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`
      + `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, "utf-8");
  const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return {
    body: bufferToArrayBuffer(Buffer.concat([head, data, tail])),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  view.set(buf);
  return ab;
}

async function createTask(base: string, title: string): Promise<string> {
  const res = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
    body: JSON.stringify({ title }),
  });
  const body = await res.json() as { key: string };
  return body.key;
}

describe("web server attachments", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-att-"));
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

  let key: string;
  beforeEach(async () => {
    key = await createTask(base, "attach test");
  });

  describe("POST /api/tasks/:ref/attachments", () => {
    it("uploads a file and returns 201", async () => {
      const { body, contentType } = buildMultipart("file", "hello.txt", "hello world");
      const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { name: string; size: number; overwritten: boolean; task_key: string };
      expect(json).toMatchObject({
        name: "hello.txt",
        size: 11,
        overwritten: false,
        task_key: key,
      });
    });

    it("returns 409 on collision without force", async () => {
      const m1 = buildMultipart("file", "dup.txt", "first");
      await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": m1.contentType, "X-Loctt-Client": "1" },
        body: m1.body,
      });
      const m2 = buildMultipart("file", "dup.txt", "second");
      const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": m2.contentType, "X-Loctt-Client": "1" },
        body: m2.body,
      });
      expect(res.status).toBe(409);
    });

    it("returns 201 with overwritten: true when force=true", async () => {
      const m1 = buildMultipart("file", "force.txt", "first");
      await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": m1.contentType, "X-Loctt-Client": "1" },
        body: m1.body,
      });
      const m2 = buildMultipart("file", "force.txt", "second");
      const res = await fetch(`${base}/api/tasks/${key}/attachments?force=true`, {
        method: "POST",
        headers: { "Content-Type": m2.contentType, "X-Loctt-Client": "1" },
        body: m2.body,
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { overwritten: boolean };
      expect(json.overwritten).toBe(true);
    });

    it("returns 400 for non-multipart body", async () => {
      const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ file: "nope" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for dotfile source", async () => {
      const { body, contentType } = buildMultipart("file", ".env", "secret");
      const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent ref", async () => {
      const { body, contentType } = buildMultipart("file", "x.txt", "x");
      const res = await fetch(`${base}/api/tasks/T-99999/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
      expect(res.status).toBe(404);
    });

    it("rejects POST without CSRF header", async () => {
      const { body, contentType } = buildMultipart("file", "x.txt", "x");
      const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/tasks/:ref/attachments/:name", () => {
    it("returns 200 and the file contents", async () => {
      const content = "the file body";
      const { body, contentType } = buildMultipart("file", "g.txt", content);
      await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
      const res = await fetch(`${base}/api/tasks/${key}/attachments/g.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-length")).toBe(String(content.length));
      const text = await res.text();
      expect(text).toBe(content);
    });

    it("returns 404 for missing attachment", async () => {
      const res = await fetch(`${base}/api/tasks/${key}/attachments/missing.txt`);
      expect(res.status).toBe(404);
    });

    it("returns 400 for traversal in name", async () => {
      const res = await fetch(`${base}/api/tasks/${key}/attachments/${encodeURIComponent("../foo")}`);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/tasks/:ref/attachments/:name", () => {
    it("returns 204 and removes the file", async () => {
      const { body, contentType } = buildMultipart("file", "del.txt", "bye");
      await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
      const res = await fetch(`${base}/api/tasks/${key}/attachments/del.txt`, {
        method: "DELETE",
        headers: { "X-Loctt-Client": "1" },
      });
      expect(res.status).toBe(204);
      const get = await fetch(`${base}/api/tasks/${key}/attachments/del.txt`);
      expect(get.status).toBe(404);
    });

    it("returns 400 for traversal in name", async () => {
      const res = await fetch(
        `${base}/api/tasks/${key}/attachments/${encodeURIComponent("../foo")}`,
        { method: "DELETE", headers: { "X-Loctt-Client": "1" } },
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent attachment", async () => {
      const res = await fetch(
        `${base}/api/tasks/${key}/attachments/none.txt`,
        { method: "DELETE", headers: { "X-Loctt-Client": "1" } },
      );
      expect(res.status).toBe(404);
    });
  });

  it("written file actually exists on disk under .loctt", async () => {
    const localKey = await createTask(base, "disk check");
    const { body, contentType } = buildMultipart("file", "disk.txt", "disk content");
    const res = await fetch(`${base}/api/tasks/${localKey}/attachments`, {
      method: "POST",
      headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
      body,
    });
    expect(res.status).toBe(201);

    // Look it up via the show endpoint to find the task id, then verify the file.
    const taskRes = await fetch(`${base}/api/tasks/${localKey}`);
    const taskBody = await taskRes.json() as { frontmatter: { id: string }; attachments: { name: string; size: number }[] };
    expect(taskBody.attachments.find(a => a.name === "disk.txt")).toBeDefined();
    const onDisk = await readFile(
      join(root, ".loctt", "tasks", taskBody.frontmatter.id, "attachments", "disk.txt"),
      "utf-8",
    );
    expect(onDisk).toBe("disk content");
  });
});

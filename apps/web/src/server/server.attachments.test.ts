import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

  // The inline-serve path (K95, REL-16 bullet 1): the tile's `<img src>`
  // asks for the raw bytes with `?inline=1` and an image Content-Type.
  // This is a SEPARATE path from the download above, which stays
  // octet-stream + attachment (REL-38) — the tests below assert both
  // that images serve inline with the right type + nosniff AND that the
  // download path is untouched.
  describe("GET /api/tasks/:ref/attachments/:name?inline=1", () => {
    async function upload(name: string, content: Buffer | string): Promise<void> {
      const { body, contentType } = buildMultipart("file", name, content);
      await fetch(`${base}/api/tasks/${key}/attachments`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
        body,
      });
    }

    // A minimal valid 1×1 PNG.
    const PNG_1PX = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        + "890000000d49444154789c6360000002000100ffff03000006000557bfabd4"
        + "0000000049454e44ae426082",
      "hex",
    );

    // @verifies REL-16
    it("serves an image inline with the extension-derived Content-Type and nosniff", async () => {
      await upload("shot.png", PNG_1PX);
      const res = await fetch(`${base}/api/tasks/${key}/attachments/shot.png?inline=1`);
      expect(res.status).toBe(200);
      // Matches core's mimeForFilename table — the same type the tile
      // uses to decide it is an image family.
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      // Inline: NOT a forced download.
      expect(res.headers.get("content-disposition")).toBeNull();
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.equals(PNG_1PX)).toBe(true);
    });

    // @verifies REL-16
    it("serves an SVG inline as image/svg+xml with nosniff (safe under <img>; nosniff blocks doc navigation)", async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
      await upload("vector.svg", svg);
      const res = await fetch(`${base}/api/tasks/${key}/attachments/vector.svg?inline=1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      // nosniff: a *navigation* to this URL cannot execute the SVG as a
      // top-level document. The <img> render relies on the image
      // sandbox, but the header guards the navigation case.
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    // @verifies REL-16
    it("does NOT serve a non-image inline — a .txt with ?inline=1 falls through to the octet-stream download", async () => {
      await upload("notes.txt", "plain text");
      const res = await fetch(`${base}/api/tasks/${key}/attachments/notes.txt?inline=1`);
      expect(res.status).toBe(200);
      // Falls through to the REL-38 download path: no derived text/plain
      // inline type, which would be an XSS vector for text/html.
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).not.toBeNull();
    });

    // @verifies REL-16
    it("leaves the download path (no ?inline) exactly as REL-38 protects it, even for an image", async () => {
      await upload("dl.png", PNG_1PX);
      const res = await fetch(`${base}/api/tasks/${key}/attachments/dl.png`);
      expect(res.status).toBe(200);
      // Without ?inline the image is still a forced octet-stream
      // download — the inline serve did not weaken this.
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-disposition")).not.toBeNull();
    });

    // @verifies REL-16
    it("returns 404 for a missing image asked inline", async () => {
      const res = await fetch(`${base}/api/tasks/${key}/attachments/gone.png?inline=1`);
      expect(res.status).toBe(404);
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

/**
 * A failed upload leaves nothing behind (ERR-24).
 *
 * The case's last bullet is the one that needs the filesystem:
 * "nothing is left in `tasks/<id>/attachments/` — verify by listing
 * the directory." A test that only asserted the error envelope would
 * pass against a server that wrote a partial file and then reported
 * failure, which is exactly the phantom attachment the case is named
 * for.
 *
 * The client-side bullets (no entry in the grid, retry offered) belong
 * with the attachments UI and are not claimed here.
 */
describe("a failed attachment upload leaves no phantom", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-attach-fail-"));
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

  // @verifies ERR-24
  it("writes nothing to the attachments directory when the upload is refused", async () => {
    const key = await createTask(base, "phantom check");
    const taskRes = await fetch(`${base}/api/tasks/${key}`);
    const { frontmatter } = await taskRes.json() as { frontmatter: { id: string } };
    const attachDir = join(root, ".loctt", "tasks", frontmatter.id, "attachments");

    // A truncated multipart body: the headers promise a part the body
    // never closes, so the parse fails partway through — the "fail an
    // upload mid-transfer" the case describes, rather than a request
    // rejected before any bytes were read.
    const boundary = "----loctttruncated";
    const truncated = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="ghost.txt"',
      "Content-Type: text/plain",
      "",
      "partial content with no closing boundary",
    ].join("\r\n");

    const res = await fetch(`${base}/api/tasks/${key}/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "X-Loctt-Client": "1",
      },
      body: truncated,
    });

    // Second bullet: it failed, and said so.
    expect(res.ok).toBe(false);

    // Last bullet: nothing was left behind. `readdir` on a directory
    // that was never created throws ENOENT, which is also a pass — the
    // requirement is that no attachment file exists, not that the
    // directory does.
    const entries = await readdir(attachDir).catch(() => [] as string[]);
    expect(entries).not.toContain("ghost.txt");
    expect(entries.filter(e => !e.startsWith("."))).toHaveLength(0);

    // First bullet, server-side: the task's own attachment list does
    // not report it either — the grid renders from this, so a phantom
    // here is a phantom on screen.
    const after = await fetch(`${base}/api/tasks/${key}`);
    const body = await after.json() as { attachments: { name: string }[] };
    expect(body.attachments.map(a => a.name)).not.toContain("ghost.txt");

    // Third bullet: "retrying does not create a duplicate". The retry
    // is a well-formed upload of the same name; it must land exactly
    // once, which is the positive control proving the directory checks
    // above are not passing because uploads never work here.
    const { body: goodBody, contentType } = buildMultipart("file", "ghost.txt", "the real thing");
    const retry = await fetch(`${base}/api/tasks/${key}/attachments`, {
      method: "POST",
      headers: { "Content-Type": contentType, "X-Loctt-Client": "1" },
      body: goodBody,
    });
    expect(retry.status).toBe(201);
    const finalEntries = await readdir(attachDir);
    expect(finalEntries.filter(e => e === "ghost.txt")).toHaveLength(1);
  });
});

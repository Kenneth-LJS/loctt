import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseMultipartFile } from "./multipart.js";

const BOUNDARY = "----loctttest-mp";

/**
 * A multipart body carrying one file part, presented as an
 * `IncomingMessage` (a Readable is enough — `parseMultipartFile` only
 * pipes it to Busboy).
 */
function multipartReq(filename: string, content: Buffer): IncomingMessage {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, "utf-8");
  return Readable.from([head, content, tail]) as unknown as IncomingMessage;
}
const contentType = `multipart/form-data; boundary=${BOUNDARY}`;

describe("parseMultipartFile size cap (K31 item 2)", () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "loctt-mp-")); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("accepts a file at or under the cap", async () => {
    const req = multipartReq("small.bin", Buffer.alloc(8, 0x61));
    const parsed = await parseMultipartFile(req, contentType, tmpDir, "file", 32);
    expect(parsed.size).toBe(8);
    expect(parsed.filename).toBe("small.bin");
  });

  it("rejects a file over the cap with a human-readable size, not a raw byte count", async () => {
    // A 4 MB cap, exceeded — the message must read "4 MB", never
    // "4194304 bytes" (K31 item 2: a raw byte count tells the user
    // nothing they can act on).
    const cap = 4 * 1024 * 1024;
    const req = multipartReq("big.bin", Buffer.alloc(cap + 1024, 0x62));
    await expect(
      parseMultipartFile(req, contentType, tmpDir, "file", cap),
    ).rejects.toThrow(/exceeds the maximum size of 4 MB/);
    // And never the raw byte count that used to be shown.
    await expect(
      parseMultipartFile(multipartReq("big.bin", Buffer.alloc(cap + 1024, 0x62)), contentType, tmpDir, "file", cap),
    ).rejects.not.toThrow(/\d{5,} bytes/);
  });
});

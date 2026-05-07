// Minimal multipart/form-data parser tailored for the attachments upload
// endpoint. Reads the request body up to a hard byte cap, parses out a
// single file part, and writes its bytes to a temp file. Other parts are
// ignored. Throws on malformed input or oversized bodies.

import { writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename } from "node:path";
import { join as pathJoin } from "node:path";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

export interface ParsedFilePart {
  /** Path to the temp file the upload was written to. */
  readonly tempPath: string;
  /** Filename declared in the part's Content-Disposition header. */
  readonly filename: string;
  /** Byte size of the written file. */
  readonly size: number;
}

function getBoundary(contentType: string): string {
  const match = /boundary=("?)([^";]+)\1/i.exec(contentType);
  if (!match) {
    throw new Error("missing multipart boundary");
  }
  return match[2]!;
}

async function readAll(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        req.destroy();
        reject(new Error(`upload exceeds maximum size of ${max} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Splits a multipart body into raw part buffers using `--boundary` as a
 * delimiter. The closing `--boundary--` and any preamble/epilogue are
 * dropped. Each returned buffer contains the part headers + CRLF + body.
 */
function splitParts(body: Buffer, boundary: string): Buffer[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let i = 0;
  // Find first boundary
  let next = body.indexOf(delim, i);
  if (next < 0) return parts;
  i = next + delim.length;

  while (i < body.length) {
    // After a boundary marker we expect either CRLF (more parts) or "--"
    // (end marker). Tolerate LF as well as CRLF.
    if (body[i] === 0x2d && body[i + 1] === 0x2d) {
      // "--" — end of multipart
      break;
    }
    // Skip the trailing CRLF (or LF) after the boundary line.
    if (body[i] === 0x0d && body[i + 1] === 0x0a) i += 2;
    else if (body[i] === 0x0a) i += 1;

    const partStart = i;
    next = body.indexOf(delim, i);
    if (next < 0) break;
    // Strip the CRLF that precedes the next boundary.
    let partEnd = next;
    if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    } else if (partEnd >= 1 && body[partEnd - 1] === 0x0a) {
      partEnd -= 1;
    }
    parts.push(body.subarray(partStart, partEnd));
    i = next + delim.length;
  }

  return parts;
}

interface PartHeaders {
  readonly disposition: string;
  readonly fieldName?: string;
  readonly filename?: string;
}

function parsePartHeaders(headerBlock: string): PartHeaders {
  const lines = headerBlock.split(/\r?\n/);
  let disposition = "";
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name === "content-disposition") {
      disposition = value;
    }
  }
  const fieldMatch = /\bname="([^"]*)"/.exec(disposition);
  const filenameMatch = /\bfilename="([^"]*)"/.exec(disposition);
  return {
    disposition,
    fieldName: fieldMatch?.[1],
    filename: filenameMatch?.[1],
  };
}

/**
 * Parses a multipart/form-data request body and writes the first file part
 * matching `fieldName` into `tmpDir`. Returns metadata about the written
 * file. Throws on malformed input, missing field, or empty filename.
 */
export async function parseMultipartFile(
  req: IncomingMessage,
  contentType: string,
  tmpDir: string,
  fieldName: string,
): Promise<ParsedFilePart> {
  const boundary = getBoundary(contentType);
  const body = await readAll(req, MAX_UPLOAD_BYTES);
  const parts = splitParts(body, boundary);
  if (parts.length === 0) {
    throw new Error("no parts found in multipart body");
  }

  for (const part of parts) {
    // Header / body split: blank line (CRLF CRLF or LF LF).
    let sep = part.indexOf("\r\n\r\n");
    let sepLen = 4;
    if (sep < 0) {
      sep = part.indexOf("\n\n");
      sepLen = 2;
    }
    if (sep < 0) continue;

    const headerBlock = part.subarray(0, sep).toString("utf-8");
    const content = part.subarray(sep + sepLen);
    const headers = parsePartHeaders(headerBlock);
    if (headers.fieldName !== fieldName) continue;
    if (!headers.filename || headers.filename.length === 0) {
      throw new Error(`field "${fieldName}" must include a filename`);
    }

    // Take basename of declared filename to defeat any directory components
    // a malicious client might inject; further validation is the core's
    // responsibility (assertSafeBasename).
    const safeName = basename(headers.filename);
    if (safeName.length === 0) {
      throw new Error(`field "${fieldName}" has empty filename`);
    }
    const tempPath = pathJoin(tmpDir, safeName);
    await writeFile(tempPath, content);
    return { tempPath, filename: safeName, size: content.length };
  }

  throw new Error(`field "${fieldName}" not found in multipart body`);
}

// Multipart/form-data parser for upload endpoints, backed by busboy.
// Streams file parts matching `fieldName` to temp files while draining
// other parts. Enforces a per-file size cap (default 50 MB, matching
// `DEFAULT_MAX_ATTACHMENT_BYTES` from core).
//
// Two entry points. `parseMultipartFile` keeps the first matching part
// and drains the rest — the shape every single-upload endpoint (attach,
// avatar) wants. `parseMultipartFiles` keeps ALL matching parts, which
// is what a split-backup restore needs: core's `restoreBackup` takes an
// array of part paths and `resolveBackupSet` orders and validates them,
// so the surface's only job is to land every part on disk (K30 / Ken
// 2026-09-23).

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, join as pathJoin } from "node:path";

import { DEFAULT_MAX_ATTACHMENT_BYTES } from "@loctt/core";
import Busboy from "busboy";

export interface ParsedFilePart {
  /** Path to the temp file the upload was written to. */
  readonly tempPath: string;
  /** Filename declared in the part's Content-Disposition header. */
  readonly filename: string;
  /** Byte size of the written file. */
  readonly size: number;
}

/**
 * Human-readable cap (MB, or GB past 1024 MB) — a raw byte count like
 * "2147483648 bytes" tells the user nothing they can act on. K31 item 2.
 */
function formatCap(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  return mb >= 1024
    ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
    : `${mb.toFixed(mb % 1 === 0 ? 0 : 1)} MB`;
}

/**
 * Parses a multipart/form-data request body and writes EVERY file part
 * matching `fieldName` into `tmpDir`, in the order the body carries
 * them. Returns metadata for each written file.
 *
 * Throws on malformed input, no matching part, an empty filename, a
 * duplicate filename (two parts would otherwise write to the same temp
 * path and the second would silently win), or when any one upload
 * exceeds `maxBytes` (default {@link DEFAULT_MAX_ATTACHMENT_BYTES}).
 *
 * On any rejection, every temp file this call created is removed before
 * the promise settles: a caller that never receives a path cannot clean
 * up after it.
 */
export async function parseMultipartFiles(
  req: IncomingMessage,
  contentType: string,
  tmpDir: string,
  fieldName: string,
  maxBytes: number = DEFAULT_MAX_ATTACHMENT_BYTES,
  /**
   * False keeps only the first matching part and drains the rest — the
   * pre-existing single-upload behaviour, unchanged.
   */
  keepAll = true,
): Promise<readonly ParsedFilePart[]> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: { "content-type": contentType },
        limits: { fileSize: maxBytes },
      });
    } catch (err) {
      reject(err as Error);
      return;
    }

    const captured: ParsedFilePart[] = [];
    // Every part write, in body order. Awaited together on close so a
    // later part cannot be reported before an earlier one finished.
    const writes: Promise<void>[] = [];
    // Every temp path this call has created, so a failure removes them
    // all rather than leaking the parts that happened to succeed.
    const tempPaths: string[] = [];
    const seenNames = new Set<string>();
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const fail = async (err: Error) => {
      await Promise.all(tempPaths.map(p => unlink(p).catch(() => undefined)));
      settle(() => reject(err));
    };

    bb.on("file", (name, fileStream, info) => {
      if (name !== fieldName || (!keepAll && captured.length > 0)) {
        fileStream.resume();
        return;
      }

      const filename = info.filename ?? "";
      if (filename.length === 0) {
        fileStream.resume();
        void fail(new Error(`field "${fieldName}" must include a filename`));
        return;
      }

      // Same guard as the single-file path: strip any directory
      // component the client declared before it names a path we write.
      const safeName = basename(filename);
      if (safeName.length === 0) {
        fileStream.resume();
        void fail(new Error(`field "${fieldName}" has empty filename`));
        return;
      }

      // Two parts with the same basename would resolve to one temp path,
      // and the second write would clobber the first — the restore would
      // then see N-1 distinct files while believing it had N. Refuse it
      // by name here; core separately refuses a genuine duplicate part
      // by its header (`resolveBackupSet`, BAK-C8).
      if (seenNames.has(safeName)) {
        fileStream.resume();
        void fail(new Error(
          `two uploaded files are both named "${safeName}". `
          + `Each part of a split backup must be a distinct file.`,
        ));
        return;
      }
      seenNames.add(safeName);

      const tempPath = pathJoin(tmpDir, safeName);
      tempPaths.push(tempPath);
      // Reserve this part's slot now, so the results stay in body order
      // however the individual writes interleave.
      const slot = captured.length;
      captured.push({ tempPath, filename: safeName, size: 0 });
      let size = 0;
      let limitHit = false;
      const out = createWriteStream(tempPath);

      writes.push(new Promise<void>((resolveWrite, rejectWrite) => {
        fileStream.on("data", (chunk: Buffer) => { size += chunk.length; });
        fileStream.on("limit", () => { limitHit = true; });
        fileStream.on("error", rejectWrite);
        out.on("error", rejectWrite);
        out.on("close", () => {
          if (limitHit) {
            rejectWrite(new Error(
              `${keepAll ? `${safeName}: ` : ""}`
              + `upload exceeds the maximum size of ${formatCap(maxBytes)}`,
            ));
            return;
          }
          captured[slot] = { tempPath, filename: safeName, size };
          resolveWrite();
        });
        fileStream.pipe(out);
      }));
    });

    bb.on("error", (err) => { void fail(err as Error); });

    bb.on("close", () => {
      void (async () => {
        try {
          await Promise.all(writes);
        } catch (err) {
          await fail(err as Error);
          return;
        }
        if (captured.length === 0) {
          await fail(new Error(`field "${fieldName}" not found in multipart body`));
          return;
        }
        settle(() => { resolve(captured); });
      })();
    });

    req.on("error", (err) => { void fail(err); });

    req.pipe(bb);
  });
}

/**
 * Parses a multipart/form-data request body and writes the first file part
 * matching `fieldName` into `tmpDir`. Returns metadata about the written
 * file. Throws on malformed input, missing field, empty filename, or when
 * the upload exceeds `maxBytes` (default
 * {@link DEFAULT_MAX_ATTACHMENT_BYTES}).
 *
 * Only the first matching part is kept; anything after it is drained.
 */
export async function parseMultipartFile(
  req: IncomingMessage,
  contentType: string,
  tmpDir: string,
  fieldName: string,
  maxBytes: number = DEFAULT_MAX_ATTACHMENT_BYTES,
): Promise<ParsedFilePart> {
  const parts = await parseMultipartFiles(
    req, contentType, tmpDir, fieldName, maxBytes, false,
  );
  const first = parts[0];
  if (first === undefined) {
    throw new Error(`field "${fieldName}" not found in multipart body`);
  }
  return first;
}

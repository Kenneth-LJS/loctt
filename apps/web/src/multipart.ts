// Multipart/form-data parser for the attachments upload endpoint, backed by
// busboy. Streams the first file part matching `fieldName` to a temp file
// while draining other parts. Enforces a hard 50 MB cap on the file body.

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, join as pathJoin } from "node:path";

import Busboy from "busboy";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

export interface ParsedFilePart {
  /** Path to the temp file the upload was written to. */
  readonly tempPath: string;
  /** Filename declared in the part's Content-Disposition header. */
  readonly filename: string;
  /** Byte size of the written file. */
  readonly size: number;
}

/**
 * Parses a multipart/form-data request body and writes the first file part
 * matching `fieldName` into `tmpDir`. Returns metadata about the written
 * file. Throws on malformed input, missing field, empty filename, or when
 * the upload exceeds the 50 MB cap.
 */
export async function parseMultipartFile(
  req: IncomingMessage,
  contentType: string,
  tmpDir: string,
  fieldName: string,
): Promise<ParsedFilePart> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: { "content-type": contentType },
        limits: { fileSize: MAX_UPLOAD_BYTES },
      });
    } catch (err) {
      reject(err as Error);
      return;
    }

    let captured: ParsedFilePart | undefined;
    let settled = false;
    let pendingWrite: Promise<void> | undefined;
    let tempPathToCleanup: string | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const fail = async (err: Error) => {
      if (tempPathToCleanup) {
        await unlink(tempPathToCleanup).catch(() => undefined);
      }
      settle(() => reject(err));
    };

    bb.on("file", (name, fileStream, info) => {
      // Only capture the first matching part. Drain everything else.
      if (name !== fieldName || captured !== undefined) {
        fileStream.resume();
        return;
      }

      const filename = info.filename ?? "";
      if (!filename || filename.length === 0) {
        fileStream.resume();
        void fail(new Error(`field "${fieldName}" must include a filename`));
        return;
      }

      // Take basename of declared filename to defeat any directory components
      // a malicious client might inject; further validation is the core's
      // responsibility (assertSafeBasename).
      const safeName = basename(filename);
      if (safeName.length === 0) {
        fileStream.resume();
        void fail(new Error(`field "${fieldName}" has empty filename`));
        return;
      }

      const tempPath = pathJoin(tmpDir, safeName);
      tempPathToCleanup = tempPath;
      let size = 0;
      let limitHit = false;
      const out = createWriteStream(tempPath);

      pendingWrite = new Promise<void>((resolveWrite, rejectWrite) => {
        fileStream.on("data", (chunk: Buffer) => { size += chunk.length; });
        fileStream.on("limit", () => {
          limitHit = true;
        });
        fileStream.on("error", rejectWrite);
        out.on("error", rejectWrite);
        out.on("close", () => {
          if (limitHit) {
            rejectWrite(new Error(`upload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`));
            return;
          }
          captured = { tempPath, filename: safeName, size };
          resolveWrite();
        });
        fileStream.pipe(out);
      });
    });

    bb.on("error", (err) => {
      void fail(err as Error);
    });

    bb.on("close", () => {
      void (async () => {
        if (pendingWrite) {
          try {
            await pendingWrite;
          } catch (err) {
            await fail(err as Error);
            return;
          }
        }
        const result = captured;
        if (!result) {
          await fail(new Error(`field "${fieldName}" not found in multipart body`));
          return;
        }
        settle(() => resolve(result));
      })();
    });

    req.on("error", (err) => {
      void fail(err);
    });

    req.pipe(bb);
  });
}

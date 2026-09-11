// Multipart/form-data parser for upload endpoints, backed by busboy.
// Streams the first file part matching `fieldName` to a temp file while
// draining other parts. Enforces a per-file size cap (default 50 MB,
// matching `DEFAULT_MAX_ATTACHMENT_BYTES` from core).

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
 * Parses a multipart/form-data request body and writes the first file part
 * matching `fieldName` into `tmpDir`. Returns metadata about the written
 * file. Throws on malformed input, missing field, empty filename, or when
 * the upload exceeds `maxBytes` (default
 * {@link DEFAULT_MAX_ATTACHMENT_BYTES}).
 */
export async function parseMultipartFile(
  req: IncomingMessage,
  contentType: string,
  tmpDir: string,
  fieldName: string,
  maxBytes: number = DEFAULT_MAX_ATTACHMENT_BYTES,
): Promise<ParsedFilePart> {
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

      // Take basename of the client-declared filename to strip any directory
      // components it might carry (`../`, absolute paths). This is the guard
      // on the name we write to disk — core does NOT re-validate this declared
      // string. What core validates (`assertSafeBasename` in addAttachment) is
      // the basename of the *temp file's own path*, which is this already-safe
      // value, so that check is defense-in-depth over the same name rather than
      // an independent gate. The one substantive check core adds beyond
      // `basename()` is the empty-name rejection, which we also do below.
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
            rejectWrite(new Error(`upload exceeds maximum size of ${maxBytes} bytes`));
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

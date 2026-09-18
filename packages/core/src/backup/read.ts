/**
 * Reading a JSONL backup, a line at a time.
 *
 * `readline` over a `createReadStream`, deliberately: the whole point
 * of the format is that a restore never holds the file in memory
 * (BAK-C19). A `readFile` + `split("\n")` implementation passes every
 * round-trip test and then throws on a backup larger than Node's
 * string limit — the one size at which a backup matters most.
 *
 * A malformed line is reported with its line number and skipped; every
 * other record still restores (BAK-C3). Refusing the whole file for one
 * bad line would make a partially-damaged backup worthless, which is
 * the opposite of P-11.
 */

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  type BackupHeader,
  BackupHeaderSchema,
  type BackupRecord,
  BackupRecordSchema,
} from "./format.js";

/** A line that would not parse, or would not validate (BAK-C3). */
export interface BadLine {
  /** 1-based, matching what a user sees in an editor. */
  readonly line: number;
  readonly file: string;
  readonly reason: string;
}

export class BackupFormatError extends Error {
  readonly name = "BackupFormatError" as const;
}

/**
 * Reads the header without consuming the rest of the file.
 *
 * This is what makes the version check cheap (BAK-C21): a backup from
 * a newer schema is refused after reading one line, not after parsing
 * a gigabyte of tasks.
 */
export async function readBackupHeader(path: string): Promise<BackupHeader> {
  const handle = await open(path, "r");
  try {
    const stream = handle.createReadStream({ encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      rl.close();
      stream.destroy();
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new BackupFormatError(
          `${path} is not a LocTT backup: its first line is not JSON.`,
        );
      }
      const parsed = BackupHeaderSchema.safeParse(raw);
      if (!parsed.success) {
        throw new BackupFormatError(
          `${path} is not a LocTT backup: its first line is not a backup header.`,
        );
      }
      return parsed.data;
    }
    throw new BackupFormatError(`${path} is empty.`);
  } finally {
    await handle.close();
  }
}

export interface ReadRecordsResult {
  readonly header: BackupHeader;
  readonly badLines: readonly BadLine[];
}

/**
 * Streams every record in one part, calling `onRecord` per record.
 *
 * The callback is awaited, so a caller that reports per task emits its
 * first line while the file is still being read — which is the
 * mechanically checkable half of BAK-C19.
 */
export async function readBackupPart(
  path: string,
  onRecord: (record: BackupRecord) => void | Promise<void>,
): Promise<ReadRecordsResult> {
  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const badLines: BadLine[] = [];
  let header: BackupHeader | undefined;
  let lineNo = 0;

  for await (const line of rl) {
    lineNo += 1;
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      if (lineNo === 1) {
        throw new BackupFormatError(
          `${path} is not a LocTT backup: its first line is not JSON.`,
        );
      }
      badLines.push({
        line: lineNo,
        file: path,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (lineNo === 1) {
      const parsed = BackupHeaderSchema.safeParse(raw);
      if (!parsed.success) {
        throw new BackupFormatError(
          `${path} is not a LocTT backup: its first line is not a backup header.`,
        );
      }
      header = parsed.data;
      continue;
    }
    const parsed = BackupRecordSchema.safeParse(raw);
    if (!parsed.success) {
      badLines.push({
        line: lineNo,
        file: path,
        reason: parsed.error.issues
          .map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    await onRecord(parsed.data);
  }

  if (header === undefined) throw new BackupFormatError(`${path} is empty.`);
  return { header, badLines };
}

/**
 * Orders the parts of a split set and refuses an incomplete one.
 *
 * Refusing before anything is written is BAK-C8: a half-restore
 * reporting success is the failure that costs most here, because the
 * user believes they have their data back.
 */
export async function resolveBackupSet(paths: readonly string[]): Promise<{
  readonly ordered: readonly string[];
  readonly header: BackupHeader;
}> {
  if (paths.length === 0) throw new BackupFormatError("no backup file given.");
  const headers = await Promise.all(
    paths.map(async p => ({ path: p, header: await readBackupHeader(p) })),
  );

  const first = headers[0];
  if (first === undefined) throw new BackupFormatError("no backup file given.");
  const expected = first.header.parts;
  const backupId = first.header.backup_id;

  // A part from a different export is not a member of this set. Without
  // this check, two backups of the same tracker could be mixed and the
  // count would still add up.
  const foreign = headers.find(h => h.header.backup_id !== backupId);
  if (foreign !== undefined) {
    throw new BackupFormatError(
      `${foreign.path} belongs to a different backup `
      + `(${foreign.header.backup_id}, not ${backupId}).`,
    );
  }

  const byPart = new Map<number, string>();
  for (const h of headers) byPart.set(h.header.part, h.path);
  const missing: number[] = [];
  for (let n = 1; n <= expected; n += 1) {
    if (!byPart.has(n)) missing.push(n);
  }
  if (missing.length > 0) {
    throw new BackupFormatError(
      `this backup is in ${String(expected)} parts and `
      + `${missing.length === 1 ? "part" : "parts"} `
      + `${missing.map(String).join(", ")} `
      + `${missing.length === 1 ? "is" : "are"} missing. `
      + `Nothing has been restored.`,
    );
  }

  const ordered: string[] = [];
  for (let n = 1; n <= expected; n += 1) {
    const p = byPart.get(n);
    if (p !== undefined) ordered.push(p);
  }
  return { ordered, header: first.header };
}

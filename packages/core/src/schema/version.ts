import { randomBytes } from "node:crypto";
import { cp, readFile } from "node:fs/promises";

import { getSchemaVersionPath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

/**
 * Current schema version expected by this code. Bump whenever any
 * on-disk schema changes — config files, frontmatter shape, state
 * structure, file layout, etc.
 *
 * Migrations are registered in `migrations.ts` and run sequentially
 * to bring an older tracker up to this version.
 */
export const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_VERSION_FILENAME = ".schema-version";

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

/**
 * A schema state `loctt migrate` cannot fix.
 *
 * The guard used to offer "run loctt migrate" for every mismatch that
 * was not `SchemaTooNewError`, which sent the user to a command that
 * refuses: a missing `.schema-version` needs re-initialization, and an
 * interrupted migration needs its backup restored. Pointing at a
 * command that cannot help is worse than offering nothing, because the
 * user spends a round trip finding out (ONB-C6, ERR-15).
 *
 * `remedy` is the sentence to show instead of a command.
 */
export class SchemaUnmigratableError extends SchemaVersionError {
  readonly remedy: string;
  constructor(message: string, remedy: string) {
    super(message);
    this.name = "SchemaUnmigratableError";
    this.remedy = remedy;
  }
}

export class SchemaTooNewError extends SchemaVersionError {
  readonly trackerVersion: number;
  readonly expectedVersion: number;
  constructor(trackerVersion: number, expectedVersion: number) {
    super(
      `This tracker was created by a newer version of LocTT (schema v${trackerVersion}), ` +
      `but this CLI only supports up to schema v${expectedVersion}. ` +
      `Please update your LocTT installation.`,
    );
    this.name = "SchemaTooNewError";
    this.trackerVersion = trackerVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Reads the schema version recorded on disk. Returns null if the
 * file is absent (legacy tracker, or a fresh directory).
 *
 * Throws SchemaVersionError if the file exists but its contents are
 * not a valid positive integer.
 */
export async function readSchemaVersion(locttDir: string): Promise<number | null> {
  const path = getSchemaVersionPath(locttDir);
  if (!(await fileExists(path))) return null;
  const raw = (await readFile(path, "utf-8")).trim();
  // A file that exists but does not hold a version is not a migratable
  // state: there is no version to migrate *from*, so `loctt migrate`
  // refuses exactly as it does for a missing file (ONB-C6).
  const REPAIR = `Fix ${SCHEMA_VERSION_FILENAME} by hand (it holds a single `
    + `positive integer), or re-initialize with 'loctt init --repair'. `
    + `'loctt migrate' cannot help: there is no readable version to migrate from.`;
  if (raw === "") {
    throw new SchemaUnmigratableError(`${SCHEMA_VERSION_FILENAME} is empty`, REPAIR);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new SchemaUnmigratableError(
      `${SCHEMA_VERSION_FILENAME} must be a positive integer, got: ${raw}`,
      REPAIR,
    );
  }
  return n;
}

/**
 * Writes the schema version atomically.
 */
export async function writeSchemaVersion(
  locttDir: string,
  version: number,
): Promise<void> {
  if (!Number.isInteger(version) || version < 1) {
    throw new SchemaVersionError(`schema version must be a positive integer, got: ${version}`);
  }
  await writeFileAtomically(getSchemaVersionPath(locttDir), `${version}\n`);
}

/**
 * Backs up the entire .loctt directory to a sibling
 * `.loctt.backup-v<from>-<timestamp>/` before running migrations.
 * Returns the backup path.
 */
export async function backupLocttDir(
  locttDir: string,
  fromVersion: number,
): Promise<string> {
  // ISO timestamp has 1-second resolution; two migrations triggered
  // within the same second would collide. Append a short random
  // suffix so concurrent backups never clobber each other.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = randomBytes(2).toString("hex");
  const backupPath = `${locttDir}.backup-v${fromVersion}-${ts}-${suffix}`;
  await cp(locttDir, backupPath, { recursive: true, errorOnExist: true, force: false });
  return backupPath;
}

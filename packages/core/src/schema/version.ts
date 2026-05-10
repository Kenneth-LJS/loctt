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
  if (raw === "") {
    throw new SchemaVersionError(`${SCHEMA_VERSION_FILENAME} is empty`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new SchemaVersionError(
      `${SCHEMA_VERSION_FILENAME} must be a positive integer, got: ${raw}`,
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
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${locttDir}.backup-v${fromVersion}-${ts}`;
  await cp(locttDir, backupPath, { recursive: true, errorOnExist: true, force: false });
  return backupPath;
}

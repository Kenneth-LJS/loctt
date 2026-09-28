import { randomBytes } from "node:crypto";
import { cp, readFile } from "node:fs/promises";

import { getSchemaVersionPath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

/**
 * The tracker format this code reads and writes (K142).
 *
 * A format version is the semver of the `loctt` release that introduced
 * that format, not a counter: `0.1.0` is the first format, `0.3.0` the
 * one where every link carries a rank (K143). A build writes the highest
 * format-changing release at or below its own version. Set it to the
 * release a format change ships in, and never change it once that
 * release is published. No pre-release tags.
 *
 * Migrations are registered in `migrations.ts`, keyed by these versions,
 * and run in order to bring an older tracker up to this one.
 */
export const CURRENT_SCHEMA_VERSION = "0.3.0";

/** `MAJOR.MINOR.PATCH`, each a whole number without leading zeros. */
const FORMAT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** True when `raw` is a format version: plain semver, no pre-release tag. */
export function isFormatVersion(raw: string): boolean {
  return FORMAT_VERSION_RE.test(raw);
}

function parts(v: string): [number, number, number] {
  const m = FORMAT_VERSION_RE.exec(v);
  if (m === null) throw new SchemaVersionError(`Not a format version: ${v}.`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compares two format versions as semver: negative when `a` is older,
 * zero when equal, positive when `a` is newer. Throws on a string that
 * is not a format version (callers only pass validated ones).
 */
export function compareFormatVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

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

/**
 * The tracker's format is older than this build reads, and upgrading it
 * is a deliberate step (K154): every surface refuses with this message
 * until the user runs `loctt migrate`, MCP `migrate_schema`, or the web
 * Upgrade button. Nothing upgrades on its own (K154 reversed K143's
 * automatic upgrade).
 *
 * `from` is the version as written in `.schema-version` (`0.2.1` stays
 * `0.2.1`, even though it reads as format `0.1.0`); `to` is
 * `CURRENT_SCHEMA_VERSION`.
 */
export class SchemaUpgradeRequiredError extends SchemaVersionError {
  readonly from: string;
  readonly to: string;
  constructor(from: string, to: string) {
    super(upgradeRequiredMessage(from, to));
    this.name = "SchemaUpgradeRequiredError";
    this.from = from;
    this.to = to;
  }
}

/** K154's refusal, word for word, for every surface that shows it as text. */
export function upgradeRequiredMessage(from: string, to: string): string {
  return `This tracker needs upgrading from ${from} to ${to}. Run \`loctt migrate\` (a backup is made first).`;
}

/**
 * The tracker's format is newer than this build reads. The format
 * version is the `loctt` release that introduced it, so the message
 * names the release to install (K142).
 */
export class SchemaTooNewError extends SchemaVersionError {
  readonly trackerVersion: string;
  readonly expectedVersion: string;
  constructor(trackerVersion: string, expectedVersion: string) {
    super(`This tracker needs loctt ${trackerVersion} or newer.`);
    this.name = "SchemaTooNewError";
    this.trackerVersion = trackerVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * What `.schema-version` must hold, for the refusal of anything else.
 * A tracker made before 0.3.0 holds the old counter `1`; K142 gives it
 * no compatibility (Ken edits his trackers by hand), so the remedy says
 * what to write instead. It names no command: `loctt migrate` needs a
 * readable version to start from, and `loctt init --repair` refuses a
 * tracker whose config and state are all present, so neither helps.
 * `0.1.0` is the safe guess: `loctt migrate` upgrades from there (K154).
 */
export const SCHEMA_VERSION_REPAIR = `Put the tracker's format version in ${".schema-version"}: `
  + `0.1.0 for a tracker made by loctt 0.2.x or earlier (which wrote 1). `
  + `If you don't know it, write 0.1.0. Then run 'loctt migrate' to upgrade the tracker from there.`;
const REPAIR = SCHEMA_VERSION_REPAIR;

/**
 * Reads the format version recorded on disk. Returns null if the file
 * is absent (a tracker from before versioning, or a fresh directory).
 *
 * Throws `SchemaUnmigratableError` if the file exists but does not hold
 * a format version (`MAJOR.MINOR.PATCH`), including the old integer `1`.
 */
export async function readSchemaVersion(locttDir: string): Promise<string | null> {
  const path = getSchemaVersionPath(locttDir);
  if (!(await fileExists(path))) return null;
  const raw = (await readFile(path, "utf-8")).trim();
  // A file that exists but does not hold a version is not a migratable
  // state: there is no version to migrate *from*, so `loctt migrate`
  // refuses exactly as it does for a missing file (ONB-C6).
  if (raw === "") {
    throw new SchemaUnmigratableError(
      `${SCHEMA_VERSION_FILENAME} is empty. It must hold a format version such as ${CURRENT_SCHEMA_VERSION}.`,
      REPAIR,
    );
  }
  if (!isFormatVersion(raw)) {
    throw new SchemaUnmigratableError(
      `${SCHEMA_VERSION_FILENAME} must hold a format version such as ${CURRENT_SCHEMA_VERSION} `
      + `(three whole numbers separated by dots). Got: ${raw}.`,
      REPAIR,
    );
  }
  return raw;
}

/**
 * Writes the format version atomically.
 */
export async function writeSchemaVersion(
  locttDir: string,
  version: string,
): Promise<void> {
  if (!isFormatVersion(version)) {
    throw new SchemaVersionError(`A format version is three whole numbers separated by dots (e.g. 0.3.0). Got: ${version}.`);
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
  fromVersion: string,
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

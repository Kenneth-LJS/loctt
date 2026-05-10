import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stringify as stringifyYaml } from "yaml";

/**
 * Atomically writes a YAML file at the given path. Serializes the
 * value via `yaml.stringify`, writes to a temp file in the same
 * directory, then renames into place. Concurrent readers never see
 * a half-written file.
 *
 * Coordination across writers (e.g. read-modify-write loops) is the
 * caller's responsibility — pair this with a lockfile when needed.
 *
 * Creates the parent directory if missing.
 */
export async function writeYamlAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, stringifyYaml(value), "utf-8");
  await rename(tmpPath, path);
}

/**
 * Atomic write for already-serialized text content (not necessarily
 * YAML). Same temp-file + rename guarantee.
 */
export async function writeFileAtomically(
  path: string,
  contents: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, contents, "utf-8");
  await rename(tmpPath, path);
}

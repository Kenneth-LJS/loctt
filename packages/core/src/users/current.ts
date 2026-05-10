import { readFile } from "node:fs/promises";

import { getCurrentUserPath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class CurrentUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrentUserError";
  }
}

/**
 * Reads the active user's UUID from `.loctt/.current-user`.
 * Returns null when the file doesn't exist (first run, or user
 * deleted the file manually).
 */
export async function readCurrentUserId(locttDir: string): Promise<string | null> {
  const path = getCurrentUserPath(locttDir);
  if (!(await fileExists(path))) return null;
  const raw = (await readFile(path, "utf-8")).trim();
  if (raw === "") return null;
  return raw;
}

/**
 * Writes the active user UUID to `.loctt/.current-user`. The file
 * is gitignored so each clone/checkout maintains its own active
 * user.
 */
export async function writeCurrentUserId(
  locttDir: string,
  userId: string,
): Promise<void> {
  if (userId.length === 0) {
    throw new CurrentUserError("user id must be non-empty");
  }
  await writeFileAtomically(getCurrentUserPath(locttDir), `${userId}\n`);
}

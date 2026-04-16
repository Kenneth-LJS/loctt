import { access } from "node:fs/promises";

/** Checks if a file or directory exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

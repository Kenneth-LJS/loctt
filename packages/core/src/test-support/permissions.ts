/**
 * `chmod` for fault-injection tests, portable to Windows.
 *
 * Many tests make a file unreadable (`0o000`) or a directory read-only
 * (`0o500`/`0o555`) to prove a surface reports the failure instead of
 * reading it as empty or overwriting it, then restore a permissive mode
 * (`0o644`/`0o755`) before cleanup. On Windows `fs.chmod` only toggles
 * the read-only attribute, so none of those failures happened and every
 * such test failed on its own premise.
 *
 * On Windows this translates the owner r/w bits of `mode` into `icacls` DENY
 * entries for Everyone (which includes the test process), and a mode that
 * grants everything removes them again — the same call sequence the tests
 * already make. Node reports a denied access as `EPERM` there rather than
 * `EACCES`; the product classifies both as a permission failure
 * (`utils/fs-errors.ts`, `utils/read-state.ts`).
 *
 * Specific rights are used, never the generic `W`: generic write shares
 * SYNCHRONIZE with generic read, so denying it blocks reads as well.
 *
 * Elsewhere this is exactly `fs.chmod`.
 *
 * Test-only. Nothing in `src/` outside a `.test.ts` should import this.
 */
import { execFileSync } from "node:child_process";
import { chmod as fsChmod, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EVERYONE = "*S-1-1-0";

/**
 * The errno a denial injected by {@link chmod} surfaces as: Node maps
 * Windows' ERROR_ACCESS_DENIED to `EPERM`, POSIX permission bits to
 * `EACCES`. For assertions on a real (not synthetic) denial.
 */
export const DENIED_CODE = process.platform === "win32" ? "EPERM" : "EACCES";

/** Node's `<code>: <description>` prefix for {@link DENIED_CODE}. */
export const DENIED_REASON = process.platform === "win32"
  ? "EPERM: operation not permitted"
  : "EACCES: permission denied";

function icacls(path: string, ...args: string[]): void {
  execFileSync("icacls", [path, ...args], { stdio: "pipe" });
}

/** Drop-in for `fs/promises` `chmod` in tests (owner bits only on Windows). */
export async function chmod(path: string, mode: number): Promise<void> {
  if (process.platform !== "win32") {
    await fsChmod(path, mode);
    return;
  }
  const isDir = (await stat(path)).isDirectory();
  // Every call starts from no injected denial, so a restore is just a
  // permissive mode and a second restrictive call replaces the first.
  icacls(path, "/remove:d", EVERYONE);

  const owner = (mode >> 6) & 0o7;
  const canRead = (owner & 0o4) !== 0;
  const canWrite = (owner & 0o2) !== 0;
  // The x bit is ignored on Windows. `fs.stat` there never reports it
  // (a directory reads back as 0o666), so a test that saves a directory's
  // mode and restores it would otherwise "restore" a lock-out.

  if (!isDir) {
    const rights = [...(canRead ? [] : ["RD"]), ...(canWrite ? [] : ["WD", "AD"])];
    if (rights.length > 0) icacls(path, "/deny", `${EVERYONE}:(${rights.join(",")})`);
    return;
  }

  // The directory itself: listing (r) and adding/removing entries (w).
  const own = [...(canRead ? [] : ["RD"]), ...(canWrite ? [] : ["WD", "AD", "DC"])];
  if (own.length > 0) icacls(path, "/deny", `${EVERYONE}:(${own.join(",")})`);
  //
  // Not emulated: without w, POSIX also stops an existing entry being
  // deleted or renamed away. Windows allows that through the entry's own
  // DELETE right, and denying DELETE on a file makes Node fail every open
  // of it, reads included. Creating an entry (every atomic write's temp
  // file) is refused, which is the failure these tests inject.
}

/**
 * Whether this process may create a FILE symlink. Windows allows it only
 * with Developer Mode or an elevated shell (otherwise `EPERM`); directory
 * junctions need neither, so a test about a linked directory should use
 * `symlink(target, path, "junction")` and run everywhere instead.
 */
export async function canCreateFileSymlinks(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const dir = await mkdtemp(join(tmpdir(), "loctt-symprobe-"));
  try {
    await writeFile(join(dir, "t"), "");
    await symlink(join(dir, "t"), join(dir, "l"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

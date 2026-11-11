import { rename } from "node:fs/promises";

/**
 * Renames `from` over `to`: the last step of every temp-file-then-rename
 * write.
 *
 * On Windows, replacing a file fails transiently with `EPERM`, `EACCES`
 * or `EBUSY` while another handle has the target open (a concurrent
 * reader, another writer's rename landing, an antivirus or indexer
 * scan). POSIX rename never fails that way. Under load the atomic writes
 * therefore threw "Permission denied" for a file that was perfectly
 * writable (atomic-yaml.test's concurrent-readers case). The fix is the
 * one `graceful-fs` and `write-file-atomic` use: retry briefly on those
 * codes, on Windows only. A denial that persists past the budget is real
 * and is rethrown unchanged for `withFsErrors` to classify.
 */
const RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const BUDGET_MS = 2000;

export async function replaceFile(from: string, to: string): Promise<void> {
  if (process.platform !== "win32") {
    await rename(from, to);
    return;
  }
  const started = Date.now();
  let delay = 5;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRY_CODES.has(code) || Date.now() - started >= BUDGET_MS) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 100);
    }
  }
}

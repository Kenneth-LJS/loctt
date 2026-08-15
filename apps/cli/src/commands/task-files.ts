import { isAbsolute, resolve as resolvePath } from "node:path";

import { attachFile, AttachmentExistsError, detachFile, lookupTask, resolveLocttDir } from "@loctt/core";

import { hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";

/**
 * `loctt attach <task> <file>` — copy a file into the task's
 * attachments directory. On collision, re-throws a new
 * `AttachmentExistsError` carrying the `use --force to overwrite`
 * hint so `runCommand`'s canonical domain-error formatting picks
 * it up. The hint is CLI-specific (MCP just passes `force: true`).
 */
/**
 * Accepted flags per command. `getArg`/`hasFlag` are pure extractors and
 * cannot notice a flag nobody asked about, so without this an unknown
 * option is silently dropped and the command runs without it.
 */
const ATTACH_FLAGS: readonly string[] = ["--force"];
const DETACH_FLAGS: readonly string[] = [];

export async function attach(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ATTACH_FLAGS);
  const ref = args[1];
  const filePath = args[2];
  if (!ref || !filePath) {
    throw new UsageError(
      "missing task ref or file path",
      "loctt attach <task> <file-path> [--force]",
    );
  }
  const force = hasFlag(args, "--force");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const sourcePath = isAbsolute(filePath)
    ? filePath
    : resolvePath(process.cwd(), filePath);
  try {
    const result = await attachFile({
      locttDir,
      taskId: task.frontmatter.id,
      sourcePath,
      force,
    });
    const prefix = result.overwritten ? "(overwrote existing) " : "";
    console.log(
      `${prefix}Attached ${result.name} (${result.size} bytes) to ${task.frontmatter.key}`,
    );
  } catch (err) {
    if (err instanceof AttachmentExistsError) {
      throw new AttachmentExistsError(
        `${err.attachmentName} (use --force to overwrite)`,
      );
    }
    throw err;
  }
}

/**
 * `loctt detach <task> <name>` — remove an attachment. The
 * basename check at the boundary is the CLI's defense; core's
 * `assertSafeBasename` is the second layer.
 */
export async function detach(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, DETACH_FLAGS);
  const ref = args[1];
  const name = args[2];
  if (!ref || !name) {
    throw new UsageError("missing task ref or name", "loctt detach <task> <name>");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new UsageError(`<name> must be a plain basename (no path separators or '..')`);
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  await detachFile({
    locttDir,
    taskId: task.frontmatter.id,
    name,
  });
  console.log(`Detached ${name} from ${task.frontmatter.key}`);
}

/**
 * Interactive confirmation primitives for destructive CLI commands.
 *
 * Three outcomes are distinct because they map to different exit
 * codes:
 *
 *   - **yes** — user confirmed (or `--yes` flag was passed). Proceed
 *     with the destructive operation.
 *   - **no** — user explicitly declined at the prompt. EXIT.SUCCESS;
 *     this is a clean "the user said no," not an error.
 *   - **refused** — non-interactive context without `--yes`. EXIT.USAGE;
 *     the *script* forgot the flag.
 *
 * Scripts can tell apart "user said no" from "you wrote the script
 * wrong" by checking the exit code.
 */

import { hasFlag } from "./args.js";

/**
 * Reads a single line from stdin and resolves true on a `y`/`yes`
 * response (case-insensitive), false on anything else (including
 * empty input or EOF). Used for non-destructive confirmations that
 * don't need the `--yes` flag bypass.
 *
 * If stdin isn't a TTY (piped input, CI), returns false — callers
 * should pass `--yes` to skip the prompt non-interactively.
 */
export async function confirmInteractive(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      `Refusing to prompt for confirmation in non-interactive mode. Pass --yes to skip.`,
    );
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export type ConfirmOutcome = "yes" | "no" | "refused";

/**
 * Confirms a destructive action.
 * - `--yes` flag → "yes" (no prompt).
 * - Interactive TTY: prompts; user "y" → "yes", anything else → "no".
 * - Non-TTY without `--yes` → "refused" (a usage error, not a denial).
 *
 * Callers should map `"no"` → EXIT.SUCCESS (clean refusal)
 * and `"refused"` → EXIT.USAGE (the script forgot `--yes`).
 */
export async function confirmHardDelete(args: string[], question: string): Promise<ConfirmOutcome> {
  if (hasFlag(args, "--yes")) return "yes";
  if (!process.stdin.isTTY) {
    console.error(
      `Refusing to prompt for confirmation in non-interactive mode. Pass --yes to skip.`,
    );
    return "refused";
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes" ? "yes" : "no";
  } finally {
    rl.close();
  }
}

/**
 * Argument parsers shared by every CLI command. Rolled by hand
 * because off-the-shelf parsers (mri, minimist, yargs) all have
 * surprises around empty-string values, repeated flags, or the
 * `--key=value` form. The contract here is small, predictable,
 * and unit-tested against real `process.argv` shapes.
 *
 * Conventions across all three helpers:
 *
 * - **Long-form only.** `--flag` / `--flag value` / `--flag=value`.
 *   `-flag` (single dash) is NOT accepted — LocTT defines no short
 *   flags, so the single-dash form was always a typo.
 * - **`--` ends flag parsing.** Tokens after `--` are positional
 *   and never matched as flag values.
 * - **Repeated flags: last wins.** `--limit 1 --limit 2` → `2`.
 * - **Empty-string values are preserved.** `--set ""` returns `""`,
 *   not coerced or treated as missing.
 */

import { UsageError } from "./errors.js";

/**
 * Returns the string value for `--flag <value>` or `--flag=value`.
 * Returns undefined if the flag is absent or used in boolean form
 * (`--flag` followed by another flag), so callers can distinguish
 * "not set" from "set to empty string".
 *
 * For values that themselves start with `-` (e.g. a negative number),
 * use the `=` form: `--limit=-3`. The bare-arg form refuses to
 * swallow a token that looks like another flag.
 */
export function getArg(args: string[], flag: string): string | undefined {
  const name = flag.replace(/^--?/, "");
  let result: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a === undefined) continue;
    // `--flag=value` form
    if (a === `--${name}=` || a.startsWith(`--${name}=`)) {
      result = a.slice(`--${name}=`.length);
      continue;
    }
    // `--flag value` form. Treat the next arg as a value unless it
    // looks like another flag — in which case --flag was bare/boolean.
    if (a === `--${name}`) {
      const next = args[i + 1];
      if (next === undefined) continue;
      if (next.startsWith("-") && next !== "-") continue;
      result = next;
      i += 1;
    }
  }
  return result;
}

/**
 * Removes `--cwd <value>` and `--cwd=<value>` occurrences from an
 * argv slice. Used by `main()` after extracting the cwd value so
 * handlers never see the global flag and so the first positional
 * after `loctt` is always the subcommand. Repeated occurrences are
 * all stripped (last one wins for the value, consistent with
 * {@link getArg}).
 *
 * Mirrors `getArg`'s rules so the two helpers can't disagree about
 * what counts as the value of `--cwd`.
 */
export function stripCwdArg(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined) { i += 1; continue; }
    if (a === "--") {
      out.push(...args.slice(i));
      return out;
    }
    if (a === "--cwd") {
      const next = args[i + 1];
      // Same rule as getArg: only treat the next token as the value
      // if it doesn't itself look like a flag (so `--cwd --help`
      // leaves `--help` intact).
      if (next !== undefined && !next.startsWith("-")) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (a.startsWith("--cwd=")) {
      i += 1;
      continue;
    }
    out.push(a);
    i += 1;
  }
  return out;
}

/**
 * Throws a {@link UsageError} naming any `--flag` in `args` that isn't
 * in `allowed`. Positionals, everything after `--`, and the global
 * `--cwd` are ignored.
 *
 * Exists because a removed-but-still-documented flag is indistinguishable
 * from a working one when the parser ignores what it doesn't recognize:
 * `--project-key` was dropped from init, and without this an old script
 * passing it would keep exiting 0 while doing something different from
 * what its author wrote.
 *
 * Opt-in per command rather than global — some commands take
 * pass-through arguments that must not be validated here.
 */
export function rejectUnknownFlags(args: string[], allowed: readonly string[]): void {
  const known = new Set(allowed.map(f => f.replace(/^--?/, "")));
  known.add("cwd");
  for (const a of args) {
    if (a === "--") break;
    if (a === undefined || !a.startsWith("--")) continue;
    const name = a.slice(2).split("=")[0];
    if (name === undefined || name.length === 0) continue;
    if (!known.has(name)) {
      throw new UsageError(
        // "Accepted: ." on a command that takes no flags reads as a
        // truncated message. Say so instead.
        allowed.length === 0
          ? `unknown option --${name}. This command accepts no options.`
          : `unknown option --${name}. Accepted: ${allowed.map(f => `--${f.replace(/^--?/, "")}`).join(", ")}.`,
      );
    }
  }
}

const TRUTHY_FLAG_SUFFIXES = new Set(["true", "1", "yes", "on"]);
const FALSY_FLAG_SUFFIXES = new Set(["false", "0", "no", "off"]);

/**
 * Returns true when a boolean flag is present (`--archived`,
 * `--archived=true`). `--archived=false` is treated as absent so a
 * caller can override a default-true behaviour.
 *
 * Accepted suffixes:
 *   truthy: `true`, `1`, `yes`, `on`
 *   falsy:  `false`, `0`, `no`, `off`
 *
 * An unrecognized suffix (`--archived=ture`) throws a {@link UsageError}
 * rather than silently being interpreted as truthy, so typos
 * surface as a clear error instead of silently triggering the flag.
 */
export function hasFlag(args: string[], flag: string): boolean {
  const name = flag.replace(/^--?/, "");
  let present = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a === undefined) continue;
    if (a === `--${name}`) { present = true; continue; }
    if (a.startsWith(`--${name}=`)) {
      const suffix = a.slice(`--${name}=`.length).toLowerCase();
      if (TRUTHY_FLAG_SUFFIXES.has(suffix)) { present = true; continue; }
      if (FALSY_FLAG_SUFFIXES.has(suffix)) { present = false; continue; }
      throw new UsageError(
        `invalid value for --${name}: ${JSON.stringify(suffix)}. Expected one of: true, false, 1, 0, yes, no, on, off.`,
      );
    }
  }
  return present;
}

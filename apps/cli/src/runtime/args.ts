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

import type { ArchivedScope } from "@loctt/contracts";
import { DEFAULT_ARCHIVED_SCOPE } from "@loctt/contracts";

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
 * Every value given for a REPEATABLE flag, in the order they appeared.
 *
 * {@link getArg} keeps only the last occurrence — right for a flag that
 * names one value. A repeatable flag (`views create --filter a --filter b`)
 * needs them all, and needs them IN ORDER, because a saved view's filter
 * list is ordered as authored (K102).
 *
 * Matches `getArg`'s value rules exactly (both `--flag value` and
 * `--flag=value` forms; a bare flag followed by another flag contributes
 * nothing) so the two cannot disagree about what counts as a value.
 */
export function getArgAll(args: string[], flag: string): string[] {
  const name = flag.replace(/^--?/, "");
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a === undefined) continue;
    if (a === `--${name}=` || a.startsWith(`--${name}=`)) {
      out.push(a.slice(`--${name}=`.length));
      continue;
    }
    if (a === `--${name}`) {
      const next = args[i + 1];
      if (next === undefined) continue;
      if (next.startsWith("-") && next !== "-") continue;
      out.push(next);
      i += 1;
    }
  }
  return out;
}

/**
 * Removes `--<flag> <value>` and `--<flag>=<value>` occurrences from an
 * argv slice. Used by `main()` after extracting the value so handlers
 * never see the global flag and so the first positional after `loctt`
 * is always the subcommand. Repeated occurrences are all stripped (last
 * one wins for the value, consistent with {@link getArg}).
 *
 * Mirrors `getArg`'s rules so the two helpers can't disagree about
 * what counts as the value of the flag.
 */
export function stripGlobalFlag(args: string[], flag: string): string[] {
  const name = flag.replace(/^--?/, "");
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined) { i += 1; continue; }
    if (a === "--") {
      out.push(...args.slice(i));
      return out;
    }
    if (a === `--${name}`) {
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
    if (a.startsWith(`--${name}=`)) {
      i += 1;
      continue;
    }
    out.push(a);
    i += 1;
  }
  return out;
}

/**
 * Strips BOTH global tracker-root flags — the canonical `--root` and
 * its back-compat alias `--cwd` — so the first positional after `loctt`
 * is always the subcommand and `loctt ui`/`loctt mcp` never see them as
 * "unknown option" (CLI-1).
 */
export function stripRootArgs(args: string[]): string[] {
  return stripGlobalFlag(stripGlobalFlag(args, "--root"), "--cwd");
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
/**
 * Reads a positional argument, refusing anything that looks like a flag.
 *
 * `const name = args[2]` takes whatever sits in that slot. So
 * `loctt project create --name "Second" --prefix SEC` created a
 * project **literally named `--name`** and discarded "Second" —
 * silently, exit 0, listed as `--name` forever after.
 *
 * `rejectUnknownFlags` cannot catch it: `--name` is a legitimate flag
 * of `project rename`, so it is in the accepted list and passes the
 * guard on its way to being eaten as a positional.
 *
 * The same `args[2]` appears in create for projects, labels, sprints,
 * milestones and users. A user who guesses `--name` — a reasonable
 * guess, since rename takes it — gets a wrongly named entity on every
 * one of them.
 *
 * A name that genuinely begins with `--` is passed after a bare `--`:
 * `loctt label create -- --weird`. That is why this reads *past* the
 * separator rather than stopping at it — an earlier cut returned
 * `undefined` for `--`, so the documented escape hatch produced a
 * usage error instead of the name.
 */
export function positional(args: string[], index: number, usage: string): string | undefined {
  const value = args[index];
  if (value === undefined) return undefined;
  // Everything after `--` is literal, flags included.
  if (value === "--") return args[index + 1];
  if (value.startsWith("--")) {
    throw new UsageError(
      `expected a name here, got the flag ${value}. `
      + `If the name really begins with "--", pass it after a bare "--".`,
      usage,
    );
  }
  return value;
}

export function rejectUnknownFlags(args: string[], allowed: readonly string[]): void {
  const known = new Set(allowed.map(f => f.replace(/^--?/, "")));
  // The global tracker-root flags are stripped before any command sees
  // argv, but keep both in the known set so the guard never flags them.
  known.add("cwd");
  known.add("root");
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

/**
 * Reads a flag whose value must be a non-negative integer.
 *
 * Returns undefined when the flag is absent — the caller decides what
 * "no limit" means. Rejects `abc`, `-1` and `1.5` alike, because
 * `Number("abc")` is NaN and a NaN limit compares false against
 * everything, so a bad value would silently mean "no limit" rather
 * than an error.
 *
 * Extracted because `list --limit` and `log --limit` carried
 * byte-identical copies of this in one file, which is how the two
 * drift into disagreeing about what `--limit -1` means.
 */
export function getNonNegativeIntArg(
  args: string[],
  flag: string,
): number | undefined {
  const raw = getArg(args, flag);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (Number.isNaN(value) || value < 0 || !Number.isInteger(value)) {
    throw new UsageError(`${flag} must be a non-negative integer`);
  }
  return value;
}

/**
 * The archived scope (K107) for a list command, from `--archived
 * <active|archived|all>`. Bare `--archived` (no value) means `all` — the
 * back-compat spelling from when `--archived` was a boolean "include
 * archived" flag. `--all` is accepted as a deprecated alias for
 * `--archived all` (the config-entity list commands used it). Absent →
 * the default `active` (hide archived).
 *
 * An unrecognized value throws a UsageError rather than silently
 * defaulting, so a typo (`--archived activ`) surfaces.
 */
/**
 * Whether the user actually passed an archived flag.
 *
 * `parseArchivedScope` cannot answer this: it returns the DEFAULT when no
 * flag was given, so "not specified" and "explicitly --archived active"
 * collapse to the same value. That distinction became load-bearing under
 * K102, where a saved view carries its OWN `archivedScope` field and the
 * resolution order is: explicit flag > the view's field > the default.
 * Passing the parsed default unconditionally would shadow every view's
 * stored scope — a view saved as `all` would still hide archived rows.
 */
export function hasArchivedFlag(args: string[]): boolean {
  return args.includes("--all")
    || args.includes("--archived")
    || args.some(a => a.startsWith("--archived="));
}

/**
 * The archived scope the user asked for, or `undefined` when they asked
 * for none — so a caller can let a saved view's own scope apply. See
 * {@link hasArchivedFlag}.
 */
export function parseOptionalArchivedScope(args: string[]): ArchivedScope | undefined {
  return hasArchivedFlag(args) ? parseArchivedScope(args) : undefined;
}

export function parseArchivedScope(args: string[]): ArchivedScope {
  const hasAll = args.includes("--all");
  const raw = getArg(args, "--archived");
  const bareArchived = raw === undefined && args.includes("--archived");

  if (bareArchived || hasAll) return "all";
  if (raw === undefined) return DEFAULT_ARCHIVED_SCOPE;
  if (raw === "active" || raw === "archived" || raw === "all") return raw;
  throw new UsageError(
    `invalid value for --archived: ${JSON.stringify(raw)}. `
    + `Expected one of: active, archived, all (or bare --archived for all).`,
  );
}

import { describe, expect, it } from "vitest";

import { rejectUnknownFlags, stripGlobalFlag, stripRootArgs } from "./args.js";

/**
 * CLI-1: `--root` is the canonical global tracker-root flag, `--cwd` is
 * its back-compat alias, and BOTH must be stripped from argv before a
 * subcommand sees them — otherwise `loctt ui --root <dir>` reaches
 * `ui`'s `rejectUnknownFlags` and dies with "unknown option --root".
 */
describe("stripRootArgs", () => {
  it("strips --root <value> so the first positional is the subcommand", () => {
    expect(stripRootArgs(["--root", "/some/dir", "ui", "--no-open"]))
      .toEqual(["ui", "--no-open"]);
  });

  it("strips --cwd <value> too (the alias)", () => {
    expect(stripRootArgs(["--cwd", "/some/dir", "mcp"]))
      .toEqual(["mcp"]);
  });

  it("strips the --root=<value> form", () => {
    expect(stripRootArgs(["--root=/some/dir", "list"]))
      .toEqual(["list"]);
  });

  it("strips both when both are present", () => {
    expect(stripRootArgs(["--root", "/a", "--cwd", "/a", "list"]))
      .toEqual(["list"]);
  });

  it("does not swallow a following flag when the value looks like a flag", () => {
    // `loctt --root --help` must leave --help intact.
    expect(stripRootArgs(["--root", "--help"])).toEqual(["--help"]);
  });

  it("leaves tokens after a bare -- untouched", () => {
    expect(stripRootArgs(["ui", "--", "--root", "literal"]))
      .toEqual(["ui", "--", "--root", "literal"]);
  });
});

describe("stripGlobalFlag", () => {
  it("strips only the named flag, leaving others", () => {
    expect(stripGlobalFlag(["--root", "/a", "--cwd", "/a", "x"], "--root"))
      .toEqual(["--cwd", "/a", "x"]);
  });
});

describe("rejectUnknownFlags accepts the global tracker-root flags", () => {
  it("does not throw on --root or --cwd even when a command declares neither", () => {
    // Defensive: the flags are stripped before a command sees argv, but
    // the guard must never flag them if one slips through.
    expect(() => rejectUnknownFlags(["--root", "/a"], ["--no-open"])).not.toThrow();
    expect(() => rejectUnknownFlags(["--cwd", "/a"], ["--no-open"])).not.toThrow();
  });

  it("still throws on a genuinely unknown flag", () => {
    expect(() => rejectUnknownFlags(["--bogus"], ["--no-open"]))
      .toThrow(/unknown option --bogus/);
  });
});

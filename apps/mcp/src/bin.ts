/**
 * `loctt-mcp`: the `@loctt/mcp` package's own launcher (K89, A352).
 *
 * Starts the same server `loctt mcp` starts (`startMcpServer`), so an
 * agent can be pointed at LocTT without installing the CLI:
 *
 *   { "command": "npx", "args": ["-y", "@loctt/mcp"] }
 *
 * The tracker root follows the CLI's rules: `--root <dir>` (or its alias
 * `--cwd <dir>`), else `LOCTT_ROOT`, else the working directory.
 */

import { resolve } from "node:path";

import { packageVersion, startMcpServer } from "./server.js";

const args = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq !== undefined) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const next = args[i + 1];
  return next === undefined || next.startsWith("-") ? undefined : next;
}

const USAGE = `Usage: loctt-mcp [--root <dir>]

Starts the LocTT MCP server on stdio. Point your MCP client at this command.

Options:
  --root <dir>   The tracker to serve (default: LOCTT_ROOT, then the
                 current directory). --cwd is accepted as an alias.
  --version      Print the version and exit.
  --help         Print this help and exit.`;

if (args.includes("--version")) {
  console.log(packageVersion());
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
} else {
  const rootFlag = flagValue("--root");
  const cwdFlag = flagValue("--cwd");
  if (rootFlag !== undefined && cwdFlag !== undefined && resolve(rootFlag) !== resolve(cwdFlag)) {
    console.error("Error: --root and --cwd point at different directories. Pass one of them.");
    process.exit(2);
  }
  const root = resolve(rootFlag ?? cwdFlag ?? process.env["LOCTT_ROOT"] ?? process.cwd());
  await startMcpServer(root);
}

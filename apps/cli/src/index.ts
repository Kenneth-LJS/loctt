#!/usr/bin/env node

// @loctt/cli — command-line interface
// Entry point for the `loctt` CLI command.
// Command implementations will be added in Task 32.

export function main(): void {
  process.stdout.write("loctt: not yet implemented\n");
  process.exitCode = 1;
}

// Only auto-run when executed directly (not imported by tests)
const isDirectRun = process.argv[1]?.endsWith("cli/dist/index.js") ?? false;
if (isDirectRun) {
  main();
}

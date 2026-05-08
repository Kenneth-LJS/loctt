// Runner for `npm run llm:verify <scenario-name> [--root <path>]`.
//
// Resolves tests/llm/verify/<name>.ts, dynamically imports its default
// export, and invokes it with the workspace root. Exit 0 on pass, 1 on
// failure with a clear message.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AssertionError } from "./expect.js";

const VERIFY_DIR = path.resolve(new URL("../verify", import.meta.url).pathname);

interface ParsedArgs {
  scenario: string | undefined;
  root: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let scenario: string | undefined;
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--root") {
      const next = args[i + 1];
      if (!next) {
        console.error("error: --root requires a path argument");
        process.exit(1);
      }
      root = path.resolve(next);
      i++;
    } else if (a.startsWith("--root=")) {
      root = path.resolve(a.slice("--root=".length));
    } else if (!scenario) {
      scenario = a;
    } else {
      console.error(`error: unexpected argument "${a}"`);
      process.exit(1);
    }
  }
  return { scenario, root };
}

function listScenarios(): string[] {
  try {
    return readdirSync(VERIFY_DIR)
      .filter(f => f.endsWith(".ts") && !f.startsWith("_"))
      .map(f => f.replace(/\.ts$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const { scenario, root } = parseArgs(process.argv);

  if (!scenario) {
    console.error("usage: llm:verify <scenario-name> [--root <path>]");
    console.error("");
    console.error("available scenarios:");
    for (const name of listScenarios()) console.error(`  ${name}`);
    process.exit(1);
  }

  const verifyPath = path.join(VERIFY_DIR, `${scenario}.ts`);
  try {
    statSync(verifyPath);
  } catch {
    console.error(`error: no verify script found for "${scenario}" (looked at ${verifyPath})`);
    console.error("");
    console.error("available scenarios:");
    for (const name of listScenarios()) console.error(`  ${name}`);
    process.exit(1);
  }

  // The verify scripts call helpers in expect.ts that read from
  // process.cwd(). Switch into the workspace before importing.
  try {
    process.chdir(root);
  } catch (err) {
    console.error(`error: cannot chdir to ${root}: ${(err as Error).message}`);
    process.exit(1);
  }

  let mod: { default?: (root: string) => Promise<void> };
  try {
    mod = (await import(pathToFileURL(verifyPath).href)) as typeof mod;
  } catch (err) {
    console.error(`error: failed to import verify script ${verifyPath}`);
    console.error((err as Error).stack ?? (err as Error).message);
    process.exit(1);
  }

  const fn = mod.default;
  if (typeof fn !== "function") {
    console.error(`error: ${verifyPath} does not have a default export function`);
    process.exit(1);
  }

  try {
    await fn(root);
    console.log(`pass: ${scenario}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AssertionError) {
      console.error(`fail: ${scenario}`);
      console.error(`  ${err.message}`);
    } else {
      console.error(`fail: ${scenario} (unexpected error)`);
      console.error((err as Error).stack ?? String(err));
    }
    process.exit(1);
  }
}

void main();

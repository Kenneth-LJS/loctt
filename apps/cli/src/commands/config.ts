import {
  CONFIG_KEYS,
  getConfigValue,
  resolveLocttDir,
  setConfigValue,
  unsetConfigValue,
} from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt config <get|set|unset|list>` — read/write machine-local
 * tracker config (git remote/branch settings, user preferences).
 * Pulls the canonical set of keys from core's CONFIG_KEYS so a new
 * key needs zero CLI changes.
 */
const ACCEPTED_FLAGS: readonly string[] = [];

export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0 — `loctt git publish --frce` reported success
  // while pushing nothing the user asked for.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "get": {
      const key = args[2];
      if (!key) {
        console.error("Usage: loctt config get <key>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      const value = await getConfigValue(locttDir, key);
      if (value === undefined) {
        // print empty line for missing
        console.log("");
      } else {
        console.log(String(value));
      }
      break;
    }
    case "set": {
      const key = args[2];
      const value = args[3];
      if (!key || value === undefined) {
        console.error("Usage: loctt config set <key> <value>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      await setConfigValue({ locttDir, root }, key, value);
      console.log(`Set ${key} = ${value}`);
      break;
    }
    case "unset": {
      const key = args[2];
      if (!key) {
        console.error("Usage: loctt config unset <key>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      await unsetConfigValue({ locttDir, root }, key);
      console.log(`Unset ${key}`);
      break;
    }
    case "list": {
      // `.catch(() => undefined)` printed a blank, which reads as "not
      // set" — while `config get` on the same file exits 1 with the
      // real cause. The same binary contradicted itself in adjacent
      // subcommands, and the quieter of the two was the wrong one.
      let anyUnreadable = false;
      for (const def of CONFIG_KEYS) {
        let display: string;
        try {
          const value = await getConfigValue(locttDir, def.key);
          display = value === undefined ? "" : String(value);
        } catch (err) {
          anyUnreadable = true;
          display = `<unreadable: ${err instanceof Error ? err.message : String(err)}>`;
        }
        console.log(`${def.key} = ${display}`);
      }
      // A blank line is a legitimate reading (the key is unset); a
      // failed one is not, so the exit code has to say so.
      if (anyUnreadable) process.exitCode = EXIT.RUNTIME;
      break;
    }
    default:
      console.error("Usage: loctt config <get|set|unset|list> [key] [value]");
      process.exitCode = EXIT.USAGE;
      break;
  }
}

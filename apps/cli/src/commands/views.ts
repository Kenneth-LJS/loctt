import { loadOptionalConfigs, resolveLocttDir } from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";

const ACCEPTED_FLAGS: readonly string[] = [];

/**
 * `loctt views` — list saved views from queries.yaml. One line per
 * view: `<name>  <query>` plus a `[sort: ...]` suffix when the
 * view declares a sort.
 */
export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0, reporting success for something it never did —
  // the same defect PRU-C9 fixed on the entity commands.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const { queriesConfig } = await loadOptionalConfigs(locttDir);
  if (!queriesConfig || queriesConfig.queries.length === 0) {
    console.log("No saved views.");
    return;
  }
  for (const v of queriesConfig.queries) {
    const sortPart = v.sort && v.sort.length > 0
      ? `  [sort: ${v.sort.map(s => `${s.field} ${s.direction}`).join(", ")}]`
      : "";
    console.log(`${v.name}  ${v.query}${sortPart}`);
  }
}

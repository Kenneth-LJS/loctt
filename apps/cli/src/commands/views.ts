import { loadOptionalConfigs, resolveLocttDir } from "@loctt/core";

/**
 * `loctt views` — list saved views from queries.yaml. One line per
 * view: `<name>  <query>` plus a `[sort: ...]` suffix when the
 * view declares a sort.
 */
export async function run(_args: string[], root: string): Promise<void> {
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

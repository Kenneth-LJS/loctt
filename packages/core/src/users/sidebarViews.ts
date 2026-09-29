import { loadOptionalConfigs } from "../config/index.js";
import { type SidebarSavedView, sidebarSavedViews } from "./sidebarGroups.js";

/**
 * The saved views the sidebar's Views group lists for this user, in their
 * default order (K158; `sidebarSavedViews`), read from `queries.yaml`.
 *
 * CLI and MCP read `sidebar_groups` through this so a `view:<id>` resolves,
 * is validated and is named exactly as the web sidebar does. A
 * `queries.yaml` that cannot be read at all throws its own config error,
 * as every other command reading it does.
 */
export async function loadSidebarSavedViews(
  locttDir: string,
): Promise<readonly SidebarSavedView[]> {
  const { queriesConfig } = await loadOptionalConfigs(locttDir);
  return sidebarSavedViews(
    queriesConfig?.queries ?? [],
    queriesConfig?.broken ?? [],
  );
}

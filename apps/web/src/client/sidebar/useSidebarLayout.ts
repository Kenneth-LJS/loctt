import type { SidebarGroups, UserSettings } from "@loctt/contracts";

import { useViews } from "../api/hooks/sidebarData.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import {
  isLegacySidebarGroups,
  readSidebarGroups,
  resolveSidebarLayout,
  type SidebarLayoutRow,
  type SidebarSavedView,
  sidebarSavedViews,
} from "../settings/sidebarGroups.ts";

/**
 * The sidebar's resolved layout (SHL-45, K158), shared by the sidebar and
 * the Customize-sidebar panel so both read the same rows.
 *
 * Reads the per-user `sidebar_groups` setting and the saved views, and
 * resolves them through core (`resolveSidebarLayout`): the groups in the
 * user's order, and the Views group's children (built-in and saved views)
 * in theirs. While the settings are loading or failed, the default layout
 * is used, so navigation never disappears (P7).
 *
 * `canWrite` is false while a pre-K158 setting cannot yet be migrated
 * faithfully (the saved views have not loaded): writing then would drop
 * what the old setting said about the saved views as a block.
 *
 * `write` saves a new `sidebar_groups` value through the same merged
 * `PUT /api/user-settings` every personal panel uses.
 */
export function useSidebarLayout(): {
  readonly settings: ReturnType<typeof useUserSettings>;
  readonly views: ReturnType<typeof useViews>;
  readonly savedViews: readonly SidebarSavedView[];
  readonly groups: SidebarGroups;
  readonly rows: readonly SidebarLayoutRow[];
  readonly canWrite: boolean;
  readonly write: (next: SidebarGroups | undefined) => void;
  readonly save: ReturnType<typeof useUserSettingsMutation>;
} {
  const settings = useUserSettings();
  const views = useViews();
  const save = useUserSettingsMutation();
  const stored = settings.data?.settings;
  const savedViews = sidebarSavedViews(
    views.data?.queries ?? [],
    views.data?.broken ?? [],
  );
  const groups = readSidebarGroups(stored, savedViews);
  const rows = resolveSidebarLayout(groups, savedViews);
  const canWrite = stored !== undefined && (!isLegacySidebarGroups(stored) || views.isSuccess);
  const write = (next: SidebarGroups | undefined): void => {
    if (stored === undefined) return;
    if (next === undefined) {
      const { sidebar_groups: _drop, ...rest } = stored;
      save.mutate(rest as UserSettings);
      return;
    }
    save.mutate({ ...stored, sidebar_groups: next } as UserSettings);
  };
  return { settings, views, savedViews, groups, rows, canWrite, write, save };
}

import type { UserSettings } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

interface UserSettingsResponse {
  readonly user: string;
  readonly settings: UserSettings;
}

/**
 * Writes the current user's settings (BRD-4, BRD-47, BRD-48).
 *
 * **`PUT /api/user-settings` replaces the whole object.** There is no
 * PATCH, so the caller must send the settings it wants to *end up
 * with*, merged from the cached copy. Sending only the changed key
 * would drop every other preference the user has — `default_project`,
 * `editor_mode`, `card_layout` — which is why the merge happens here,
 * once, rather than at each call site.
 *
 * ## Optimistic, because the column must vanish on click
 *
 * BRD-4 is explicit: "the board is not blocked on the settings write —
 * the column disappears immediately on click, before the PATCH
 * resolves." So `onMutate` writes the cache and the board re-renders
 * off it; the request follows.
 *
 * ## And rolled back, because a lost preference must be visible
 *
 * BRD-48 rules out the tempting middle ground: hiding the column,
 * failing the write, and saying nothing. On reload the column returns
 * and the user is never told why. `onError` restores the snapshot, so
 * the board's rendered state and the file agree again, and the caller
 * surfaces the error. That also covers BRD-47 — a failed `card_layout`
 * write leaves the board rendering the last-known-good layout rather
 * than an empty or default one, because the rollback restores exactly
 * what was on disk.
 */
export function useUserSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["user-settings", "write"],
    mutationFn: (settings: UserSettings) =>
      apiClient.put<UserSettingsResponse>("/api/user-settings", settings),

    onMutate: async (settings: UserSettings) => {
      await queryClient.cancelQueries({ queryKey: ["user-settings"] });
      const previous = queryClient.getQueryData<UserSettingsResponse>(["user-settings"]);
      if (previous !== undefined) {
        queryClient.setQueryData<UserSettingsResponse>(["user-settings"], {
          ...previous,
          settings,
        });
      }
      return { previous };
    },

    onError: (_err, _settings, context) => {
      // Put back exactly what the server last told us. Leaving the
      // optimistic value in place would make the board present its own
      // state as fact (P1) — the file says otherwise.
      if (context?.previous !== undefined) {
        queryClient.setQueryData<UserSettingsResponse>(["user-settings"], context.previous);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
  });
}

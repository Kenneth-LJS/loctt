import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Switches the active user via `POST /api/user/switch`. On success we
 * invalidate every query whose result depends on "who is current" —
 * the current-user query itself, the user list (its `current` marker),
 * recents (per-user), the built-in filter counts ("Assigned to me"
 * / "Reported by me" change identity), and the acting user's settings.
 * The broad invalidation is cheap here: these are all small local
 * reads.
 *
 * `["user-settings"]` is the one that is easy to miss and the one
 * PRU-9 turns on. `settings.yaml` is per *user*, and three surfaces
 * read it through that single key: the shell's theme
 * (`AppShell` → `adoptStoredTheme`), the list's `list_columns`, and
 * the board's `card_layout`. Each of those already handles a change
 * correctly — `adoptStoredTheme` exists precisely to overwrite this
 * browser's cached theme with the incoming user's. Without the
 * invalidation none of them ever hears about the switch, so the new
 * user inherits the previous one's theme, columns and card layout
 * until an unrelated refetch or a reload.
 */
export function useSwitchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) =>
      apiClient.post<{ current: string }>("/api/user/switch", { ref }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user", "current"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["recents"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
      void qc.invalidateQueries({ queryKey: ["user-settings"] });
    },
  });
}

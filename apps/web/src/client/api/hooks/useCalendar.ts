import type { CalendarConfig } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The workspace calendar — `working_days` (0 = Sunday) and `holidays`.
 *
 * TSK-8 requires the date editors to mark non-working days per
 * `calendar.yaml`. A native `<input type="date">` cannot style its own
 * popup, so the panel renders its own month grid and reads this to
 * decide which cells are non-working. Config, so it rides the app-wide
 * stale window like the other config queries.
 */
export function useCalendar() {
  return useQuery({
    queryKey: ["calendar"],
    queryFn: ({ signal }) => apiClient.get<CalendarConfig>("/api/calendar", { signal }),
  });
}

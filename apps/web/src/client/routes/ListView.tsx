import { useSearch } from "@tanstack/react-router";

import { Placeholder } from "./Placeholder.tsx";

export function ListView() {
  // Typed search params via the validated schema. Hovering `search`
  // in the IDE should show the full ListSearch shape (no `unknown`).
  const search = useSearch({ from: "/list" });
  return (
    <Placeholder
      title="List view"
      subtitle="Filter / sort / paginate / bulk-bar / export land in Phase 1."
    >
      <pre className="bg-bg-muted border border-border-subtle rounded-md p-3 text-xs overflow-auto">
{JSON.stringify(search, null, 2)}
      </pre>
    </Placeholder>
  );
}

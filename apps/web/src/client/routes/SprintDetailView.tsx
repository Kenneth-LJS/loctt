import { useParams } from "@tanstack/react-router";

import { Placeholder } from "./Placeholder.tsx";

export function SprintDetailView() {
  const { key } = useParams({ from: "/sprints/$key" });
  return (
    <Placeholder
      title={`Sprint detail · ${key}`}
      subtitle="Phase 9 — sprint metadata + burndown + filtered task list."
    />
  );
}

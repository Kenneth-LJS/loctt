import { useParams } from "@tanstack/react-router";

import { Placeholder } from "./Placeholder.tsx";

export function SettingsView() {
  const { section } = useParams({ from: "/settings/$section" });
  return (
    <Placeholder
      title={`Settings · ${section}`}
      subtitle="Phase 8 — workspace, workflow, data, tracker, personal panels."
    />
  );
}

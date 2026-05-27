import { useParams } from "@tanstack/react-router";

import { Placeholder } from "./Placeholder.tsx";

export function TaskDetailView() {
  const { key } = useParams({ from: "/tasks/$key" });
  return (
    <Placeholder
      title={`Task detail · ${key}`}
      subtitle="Phase 2 — meta panel, body editor, comments, activity, attachments."
    />
  );
}

import type { Op } from "./types.js";

/**
 * A canonical create→mutate→link→archive→delete flow exercising the
 * core mutating operations. Designed so that the resulting `.loctt/`
 * exercises:
 *   - frontmatter changes (status, priority)
 *   - body content (replace + append spacing)
 *   - relationships (link + bilateral inverse, then partial unlink)
 *   - lifecycle (archive then unarchive)
 *   - hard delete (one task removed)
 *
 * The remaining tasks should be byte-equal regardless of which surface
 * drove them.
 */
export const basicLifecycle: readonly Op[] = [
  { kind: "create", title: "first task" },
  { kind: "create", title: "second task" },
  { kind: "create", title: "third task" },
  { kind: "set_field", ref: "T-1", field: "status", value: "in_progress" },
  { kind: "set_field", ref: "T-2", field: "priority", value: "high" },
  { kind: "replace_body", ref: "T-1", body: "initial body content" },
  { kind: "append_body", ref: "T-1", text: "second paragraph" },
  { kind: "link", from: "T-1", type: "blocks", to: "T-2" },
  { kind: "link", from: "T-2", type: "blocks", to: "T-3" },
  { kind: "unlink", from: "T-2", type: "blocks", to: "T-3" },
  { kind: "archive", ref: "T-3" },
  { kind: "unarchive", ref: "T-3" },
  { kind: "delete", ref: "T-3" },
];

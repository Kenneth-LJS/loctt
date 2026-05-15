/**
 * Renders a single history entry as a one-line log message.
 *
 * The discriminator (`entry.kind`) is exhaustive over the
 * HistoryKind union from @loctt/contracts; new kinds need a new
 * case here, otherwise they fall through to the bare `{ts} {kind}`
 * fallback (which is wrong-but-not-broken — operator sees the kind,
 * just no per-kind details).
 */

import type { HistoryEntry } from "@loctt/contracts";

import { formatValue } from "./value.js";

/**
 * Narrows a `link_added` / `link_removed` history entry's `meta`
 * into the {type, target} shape the formatter expects. Type-guards
 * at runtime instead of casting blindly so a future kind that
 * happens to share the meta slot can't render with stale labels.
 */
export function readLinkMeta(meta: unknown): { type: string; target: string } {
  if (
    typeof meta === "object"
    && meta !== null
    && "type" in meta
    && "target" in meta
    && typeof (meta as { type: unknown }).type === "string"
    && typeof (meta as { target: unknown }).target === "string"
  ) {
    return meta as { type: string; target: string };
  }
  // Corrupt or out-of-shape entry — surface visibly rather than
  // rendering a phantom "undefined → undefined".
  return { type: "(unknown)", target: "(unknown)" };
}

export function formatHistoryEntry(entry: HistoryEntry): string {
  const ts = entry.timestamp;
  switch (entry.kind) {
    case "created":
      return `${ts}  created`;
    case "field_change":
      return `${ts}  ${entry.field}: ${formatValue(entry.before)} → ${formatValue(entry.after)}`;
    case "custom_field_change":
      return `${ts}  ${entry.field}: ${formatValue(entry.before)} → ${formatValue(entry.after)}`;
    case "label_added":
      return `${ts}  label added: ${String(entry.after)}`;
    case "label_removed":
      return `${ts}  label removed: ${String(entry.before)}`;
    case "archived":
      return `${ts}  archived`;
    case "unarchived":
      return `${ts}  unarchived`;
    case "link_added": {
      const meta = readLinkMeta(entry.meta);
      return `${ts}  link added: ${meta.type} → ${meta.target}`;
    }
    case "link_removed": {
      const meta = readLinkMeta(entry.meta);
      return `${ts}  link removed: ${meta.type} → ${meta.target}`;
    }
    case "body_edited":
      return `${ts}  body edited`;
    default:
      return `${ts}  ${entry.kind}`;
  }
}

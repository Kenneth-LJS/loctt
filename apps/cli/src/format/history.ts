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

/**
 * Renders `(by X)` for a comment event whose original author differs
 * from the acting user — i.e. someone edited or deleted a comment
 * that wasn't theirs. Returns an empty string when the two match, or
 * when either is missing, so the common self-edit case stays terse.
 */
function formatOriginalAuthor(entry: HistoryEntry): string {
  const author = (entry.meta as { author?: unknown } | undefined)?.author;
  if (typeof author !== "string") return "";
  if (entry.actor === undefined || entry.actor === author) return "";
  return ` (author: ${author})`;
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
    // Activity only — no comment body is captured, matching
    // `body_edited`. The acting user lives on `entry.actor`; `meta.author`
    // is the comment's original author, shown only when it differs, so
    // an edit of someone else's comment is visible in the log.
    case "comment_added":
      return `${ts}  comment added`;
    case "comment_edited":
      return `${ts}  comment edited${formatOriginalAuthor(entry)}`;
    case "comment_deleted":
      return `${ts}  comment deleted${formatOriginalAuthor(entry)}`;
    default:
      return `${ts}  ${entry.kind}`;
  }
}

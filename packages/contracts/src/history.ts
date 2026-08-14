/**
 * Discriminator for history entry kinds.
 *
 * - `created` — task was created
 * - `field_change` — built-in field changed
 * - `custom_field_change` — custom field changed
 * - `label_added` / `label_removed` — label list changed
 * - `archived` / `unarchived` — archive state toggled
 * - `link_added` / `link_removed` — relationship added/removed
 * - `body_edited` — body content changed (no content captured)
 * - `attachment_added` / `attachment_removed` — file attached/detached
 * - `comment_added` / `comment_edited` / `comment_deleted` — comment
 *   lifecycle. Anyone may edit or delete anyone's comment (LocTT is
 *   local and unauthenticated, so there's no trust boundary to
 *   enforce), which is exactly why the action is logged: `actor` says
 *   who changed it and `meta.author` who originally wrote it, so an
 *   edit of someone else's comment stays traceable. No comment body is
 *   captured, matching `body_edited`.
 */
export type HistoryKind =
  | "created"
  | "field_change"
  | "custom_field_change"
  | "label_added"
  | "label_removed"
  | "archived"
  | "unarchived"
  | "link_added"
  | "link_removed"
  | "body_edited"
  | "attachment_added"
  | "attachment_removed"
  | "comment_added"
  | "comment_edited"
  | "comment_deleted";

/** A single history/activity entry for a task. */
export interface HistoryEntry {
  readonly timestamp: string;
  readonly kind: HistoryKind;
  readonly field?: string;
  // `before`/`after` capture arbitrary field transitions — built-in
  // and custom field types span string/number/boolean/array/object,
  // so we surface the raw value and let the rendering layer format
  // it. `meta` carries kind-specific extras (e.g. attachment name).
  readonly before?: unknown;
  readonly after?: unknown;
  readonly meta?: Readonly<Record<string, unknown>>;
  /**
   * The user (by id) who performed the action, when one was active.
   * Absent when the action was driven by a headless/internal path
   * with no current user (e.g. crash recovery, first-run before
   * any user exists). Stamped by core's appendHistory.
   */
  readonly actor?: string;
  /**
   * Stamped by core's bulk operations (`bulkSetField`, `bulkArchive`,
   * etc.) on every history entry emitted during a single bulk call.
   * The UI uses this to collapse adjacent entries into one expandable
   * row ("Ken bulk-changed status on 50 tasks"). Absent on single-task
   * operations.
   */
  readonly bulk_op_id?: string;
}

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
  | "body_edited";

/** A single history/activity entry for a task. */
export interface HistoryEntry {
  readonly timestamp: string;
  readonly kind: HistoryKind;
  readonly field?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly meta?: Readonly<Record<string, unknown>>;
}

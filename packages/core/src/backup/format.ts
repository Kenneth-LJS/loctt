/**
 * The JSONL backup format (K4 ruling 3, K17).
 *
 * One JSON value per line, so the file streams: a restore reads and
 * reports a task at a time rather than parsing the whole of it
 * (BAK-C19). That is the property the format exists for — a tracker
 * whose serialized form exceeds Node's ~512MB string limit still
 * restores, which a `readFileSync` + `JSON.parse` implementation
 * cannot do at any size.
 *
 * Line 1 is always the header. It carries the schema version the
 * backup was taken at, so the version check happens before any task is
 * read (BAK-C21) — a footer would satisfy "carries its version" and
 * contradict the streaming property, since it could only be reached by
 * consuming the file to the end.
 *
 * Lines 2..n are records, each tagged by `kind`. Tasks carry their
 * whole directory — frontmatter, body, comments, history, attachments
 * — because a task is not restorable from `task.md` alone (K4: the CSV
 * dropping exactly this is why the format exists).
 *
 * Attachments are base64 in the task's own line rather than a sidecar
 * directory, so the deliverable stays one portable file (K17 ruling 1,
 * which chose completeness over the size cost).
 */

import { z } from "zod";

/** Everything the backup deliberately leaves behind (A96, Q22). */
export const EXCLUDED_FROM_BACKUP: readonly string[] = [
  // A96: machine-local, and restoring one machine's onto another is a
  // correctness and privacy failure, not an inconvenience.
  ".loctt/local/key-index.yaml",
  ".loctt/local/sync.yaml",
  ".loctt/local/reconcile.yaml",
  ".loctt/local/prefix-rename.yaml",
  ".loctt/local/journal.yaml",
  // Q22: "machine-local and gitignored — never published."
  ".loctt/users/<id>/settings.yaml",
  ".loctt/users/<id>/recents.yaml",
  // Restoring it hands the destination a tracker presenting as
  // mid-migration. Same argument as prefix-rename.yaml.
  ".loctt/.schema-migration-in-progress",
];

/**
 * Why each exclusion is excluded, shown by the export so the list is
 * self-describing rather than folklore (BAK-C1: "anything excluded is
 * listed by the export itself").
 */
export const EXCLUSION_REASONS: Readonly<Record<string, string>> = {
  ".loctt/local/key-index.yaml": "derived cache; rebuilt from the restored tasks",
  ".loctt/local/sync.yaml": "this checkout's git remote",
  ".loctt/local/reconcile.yaml": "an in-flight reconcile on this checkout",
  ".loctt/local/prefix-rename.yaml": "a rename in progress on this checkout",
  ".loctt/local/journal.yaml": "crash-recovery journal for this machine",
  ".loctt/users/<id>/settings.yaml": "per-machine user settings",
  ".loctt/users/<id>/recents.yaml": "machine-local browsing history (Q22)",
  ".loctt/.schema-migration-in-progress": "would present the destination as mid-migration",
};

/**
 * The split threshold, in bytes of serialized output (BAK-C7).
 *
 * No case names a number, so this is an agent call recorded in
 * decisions.md § 8 with a revert path. 100 MB: comfortably under the
 * ~512 MB string limit even if a consumer does buffer a whole part,
 * large enough that a normal tracker is one file, and a round number a
 * human can recognise in a directory listing.
 */
export const DEFAULT_SPLIT_THRESHOLD_BYTES = 100 * 1024 * 1024;

/** An attachment, carried inline as base64 (K17 ruling 1). */
export const BackupAttachmentSchema = z.object({
  name: z.string().min(1),
  /** base64. Compared as bytes on restore, never as a decoded string. */
  bytes: z.string(),
}).strict();
export type BackupAttachment = z.infer<typeof BackupAttachmentSchema>;

/**
 * A displaced body preserved by `restore --overwrite` (K17 ruling 6):
 * a `displaced-body-<ulid>.md` file written into the task's own
 * directory. Carried as UTF-8 text on the task's line, alongside its
 * other task-dir content, so a subsequent `backup` does not lose it
 * (BAK-C13).
 *
 * This is deliberately NOT a new top-level record kind — it is task-dir
 * content, so it travels on the task record exactly as `task.md`,
 * comments, history and attachments do.
 */
export const BackupDisplacedBodySchema = z.object({
  /** The `displaced-body-<ulid>.md` filename, a plain basename. */
  name: z.string().min(1),
  content: z.string(),
}).strict();
export type BackupDisplacedBody = z.infer<typeof BackupDisplacedBodySchema>;

/**
 * Line 1. Read before anything else, and the only line the version
 * check needs (BAK-C21).
 */
export const BackupHeaderSchema = z.object({
  kind: z.literal("loctt-backup"),
  /** Format version of the backup file itself, not of the tracker. */
  format: z.literal(1),
  /**
   * The tracker's `.schema-version` at export time. Recorded, not
   * restored: the destination keeps its own (BAK-C21).
   */
  schema_version: z.number().int().min(1),
  created_at: z.string().min(1),
  /** 1-based index of this part and the total, for a split set. */
  part: z.number().int().min(1),
  parts: z.number().int().min(1),
  /**
   * Ties the parts of one split set together, so a part from a
   * different export cannot be passed off as a member (BAK-C8).
   */
  backup_id: z.string().min(1),
  /** False when `--no-history` was used (K17 ruling 1, BAK-C4). */
  includes_history: z.boolean(),
  /** Echoed into the file so the exclusions travel with it (BAK-C1). */
  excluded: z.array(z.string()),
}).strict();
export type BackupHeader = z.infer<typeof BackupHeaderSchema>;

/**
 * A whole task directory: `task.md` (frontmatter + body),
 * `_comments.yaml`, `_history.yaml` and `attachments/`.
 *
 * `comments` and `history` are `unknown[]`: a malformed entry is
 * carried through rather than dropped (P-11 — leniency means keeping).
 * Validating them here would discard exactly the data the backup
 * exists to preserve.
 */
export const BackupTaskSchema = z.object({
  kind: z.literal("task"),
  id: z.string().min(1),
  /** Raw `task.md`, so nothing is lost to a re-serialization round. */
  raw: z.string(),
  comments: z.array(z.unknown()).optional(),
  history: z.array(z.unknown()).optional(),
  attachments: z.array(BackupAttachmentSchema).optional(),
  /**
   * `displaced-body-<ulid>.md` files in the task dir (BAK-C13). Optional
   * and omitted when there are none, so a task without any carries no
   * displaced-body structure at all — the same rule as attachments.
   */
  displacedBodies: z.array(BackupDisplacedBodySchema).optional(),
}).strict();
export type BackupTaskRecord = z.infer<typeof BackupTaskSchema>;

/** A config file, carried as its raw text. */
export const BackupConfigSchema = z.object({
  kind: z.literal("config"),
  /** Path relative to `.loctt/`, e.g. `config/workflow.yaml`. */
  path: z.string().min(1),
  content: z.string(),
}).strict();
export type BackupConfigRecord = z.infer<typeof BackupConfigSchema>;

/** A user's `profile.yaml` and avatar. Never settings or recents (Q22). */
export const BackupUserSchema = z.object({
  kind: z.literal("user"),
  id: z.string().min(1),
  profile: z.string(),
  avatar: BackupAttachmentSchema.optional(),
}).strict();
export type BackupUserRecord = z.infer<typeof BackupUserSchema>;

/** `state.yaml` — the key allocation counters (A96: these travel). */
export const BackupStateSchema = z.object({
  kind: z.literal("state"),
  content: z.string(),
}).strict();
export type BackupStateRecord = z.infer<typeof BackupStateSchema>;

export const BackupRecordSchema = z.discriminatedUnion("kind", [
  BackupTaskSchema,
  BackupConfigSchema,
  BackupUserSchema,
  BackupStateSchema,
]);
export type BackupRecord = z.infer<typeof BackupRecordSchema>;

/** Serializes one record as a single line — no embedded newlines. */
export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

import type {
  CustomFieldDef,
  HistoryEntry,
  HistoryKind,
  LabelDef,
  MilestoneDef,
  ProjectDef,
  SprintDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";

import { shortDate } from "../list/format.ts";

/**
 * Turning one history entry into words.
 *
 * Every string a reader sees for an entry is decided here, so the
 * per-kind phrasing (CMT-15), the before/after rendering (CMT-14), the
 * drift markers (CMT-26, CMT-27) and the actor-less byline (CMT-28)
 * cannot drift apart between the panel and the collapsed bulk row.
 *
 * ## Nothing here hardcodes the user's vocabulary
 *
 * P3. `status`, `priority` and `task_type` values are keys; their
 * labels come from `workflow.yaml`. A custom field is named by its
 * `label` from `custom_fields`, never its key (CMT-27's first bullet).
 * The only literals in this file are LocTT's own field *names* —
 * "Status", "Assignee" — and even those defer to the workflow when it
 * declares one.
 *
 * ## A value the config no longer declares is marked, not blanked
 *
 * CMT-26 and CMT-27's last bullet. History is a record of what
 * happened; a priority deleted from `workflow.yaml` last week does not
 * un-happen. So an unresolvable stored value renders as the raw key
 * with an explicit "no longer defined" marker — distinguishable from
 * a label, which is the whole point, and never blank.
 */

/** Shown for the side of a change that had no value (CMT-14). */
export const EMPTY_VALUE = "—";

/** Appended to a stored value the config no longer declares. */
export const DRIFT_SUFFIX = "(no longer defined)";

/** Shown as the actor of an entry with no `actor` (CMT-28). */
export const NO_ACTOR = "System";

export interface DescribeContext {
  readonly workflow: WorkflowConfig | undefined;
  readonly users: readonly UserProfile[];
  readonly labels: readonly LabelDef[];
  readonly milestones: readonly MilestoneDef[];
  readonly sprints: readonly SprintDef[];
  readonly projects: readonly ProjectDef[];
}

/** One rendered value: the words, and whether config still knows it. */
export interface RenderedValue {
  readonly text: string;
  /** True when a stored key resolved to nothing in config (P7). */
  readonly drifted: boolean;
}

export interface DescribedEntry {
  /**
   * What happened, in a sentence fragment that follows the actor:
   * "changed Status", "added the label bug". The actor is rendered
   * separately so an entry with none can say "System" without this
   * string having to know (CMT-28).
   */
  readonly summary: string;
  /** A short word for the kind, shown beside the icon (CMT-15). */
  readonly kindLabel: string;
  /** Present only for kinds that carry a before/after pair. */
  readonly change?: {
    readonly field: string;
    readonly before: RenderedValue;
    readonly after: RenderedValue;
  };
}

/* ------------------------------------------------------------------ *
 * Kinds
 * ------------------------------------------------------------------ */

/**
 * The word beside each icon.
 *
 * CMT-15's second bullet: "icons are supplemented by text — icon alone
 * is not the only carrier of meaning". This map is that text, and it
 * is exhaustive over `HistoryKind` by its type, so a kind added to
 * contracts and not here does not compile.
 */
export const KIND_LABELS: Readonly<Record<HistoryKind, string>> = {
  created: "Created",
  field_change: "Field",
  custom_field_change: "Field",
  label_added: "Label",
  label_removed: "Label",
  archived: "Archived",
  unarchived: "Unarchived",
  link_added: "Link",
  link_removed: "Link",
  body_edited: "Description",
  attachment_added: "Attachment",
  attachment_removed: "Attachment",
  comment_added: "Comment",
  comment_edited: "Comment",
  comment_deleted: "Comment",
  merge_resolved: "Merge",
  rank_changed: "Order",
};

/**
 * A distinct glyph per kind.
 *
 * Distinguishable is the requirement (CMT-15's first bullet), not
 * beautiful — and every one is `aria-hidden` beside the word above,
 * so a reader who cannot see it loses nothing.
 */
export const KIND_ICONS: Readonly<Record<HistoryKind, string>> = {
  created: "✦",
  field_change: "◆",
  custom_field_change: "◇",
  label_added: "⊕",
  label_removed: "⊖",
  archived: "▣",
  unarchived: "▢",
  link_added: "⇄",
  link_removed: "⇹",
  body_edited: "¶",
  attachment_added: "📎",
  attachment_removed: "✂",
  comment_added: "💬",
  comment_edited: "✎",
  comment_deleted: "🗑",
  merge_resolved: "⑂",
  rank_changed: "↕",
};

/* ------------------------------------------------------------------ *
 * Field names
 * ------------------------------------------------------------------ */

/**
 * LocTT's own field names, in the words the UI already uses for them
 * elsewhere. These are not the user's vocabulary — they are the
 * product's — so they are safe to state here, unlike any *value*.
 */
const BUILTIN_FIELD_LABELS: Readonly<Record<string, string>> = {
  status: "Status",
  priority: "Priority",
  task_type: "Type",
  assignee: "Assignee",
  reporter: "Reporter",
  title: "Title",
  due_date: "Due date",
  start_date: "Start date",
  completed_date: "Completed date",
  estimate: "Estimate",
  milestone: "Milestone",
  sprint: "Sprint",
  project: "Project",
  key: "Key",
  labels: "Labels",
  board_rank: "Board order",
};

function customField(
  ctx: DescribeContext,
  key: string,
): CustomFieldDef | undefined {
  return ctx.workflow?.custom_fields?.find(f => f.key === key);
}

/**
 * The name to print for a changed field.
 *
 * A custom field is named by its configured `label` (CMT-27's first
 * bullet). One that config no longer declares falls back to its raw
 * key and says so — a `custom_field_change` for a removed field is
 * CMT-27's last bullet, and blanking it would erase the fact that
 * something changed at all.
 */
export function fieldName(
  ctx: DescribeContext,
  kind: HistoryKind,
  key: string,
): RenderedValue {
  if (kind === "custom_field_change") {
    const def = customField(ctx, key);
    if (def !== undefined) return { text: def.label, drifted: false };
    return { text: key, drifted: true };
  }
  const builtin = BUILTIN_FIELD_LABELS[key];
  if (builtin !== undefined) return { text: builtin, drifted: false };
  return { text: key, drifted: false };
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

function known(text: string): RenderedValue {
  return { text, drifted: false };
}

function drifted(text: string): RenderedValue {
  return { text, drifted: true };
}

/** Absent, null, or the empty string — the "—" side of CMT-14. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * One stored value, rendered.
 *
 * Which lookup applies is decided by the **field**, because that is
 * what the stored key means: `status: "done"` is a workflow key,
 * `assignee: "01M15…"` is a user id, and neither is guessable from the
 * value alone. A field with no lookup renders its value as text.
 */
export function renderValue(
  ctx: DescribeContext,
  kind: HistoryKind,
  field: string | undefined,
  value: unknown,
): RenderedValue {
  if (isEmpty(value)) return known(EMPTY_VALUE);

  if (kind === "custom_field_change") {
    return renderCustomValue(ctx, field, value);
  }

  if (Array.isArray(value)) {
    // Arrays only reach here for `labels`-shaped built-ins; each
    // member resolves on its own so a half-known list is half-marked
    // rather than dumped whole (CMT-27's third bullet).
    const parts = value.map(v => renderValue(ctx, kind, field, v));
    return {
      text: parts.map(p => (p.drifted ? `${p.text} ${DRIFT_SUFFIX}` : p.text)).join(", "),
      drifted: parts.some(p => p.drifted),
    };
  }

  const key = String(value);
  switch (field) {
    case "status": {
      const def = ctx.workflow?.statuses.find(s => s.key === key);
      return def === undefined ? drifted(key) : known(def.label);
    }
    case "priority": {
      const def = ctx.workflow?.priorities.find(p => p.key === key);
      return def === undefined ? drifted(key) : known(def.label);
    }
    case "task_type": {
      const def = ctx.workflow?.task_types.find(t => t.key === key);
      return def === undefined ? drifted(key) : known(def.label);
    }
    // **Matched by id OR name, deliberately.** The frontmatter stores
    // a ULID, but history does not: `loctt set T-1 milestone v1`
    // records `after: v1` — the name the user typed. Measured on a
    // real tracker.
    //
    // Matching on `id` alone therefore failed every CLI-written entry
    // and marked a **live** milestone "(no longer defined)", which is
    // CMT-26's second bullet inverted: the marker exists to flag a
    // value config no longer knows, and it was firing on values config
    // knows perfectly well. Found by the M2 gate, which put two rows
    // for the same milestone on one screen — one id-shaped, one
    // name-shaped, rendering differently.
    //
    // Id first: it is the stored form and cannot collide. The name
    // fallback can in principle match a renamed entity's old name, but
    // that is the same entity by any reading the user has, and it
    // beats declaring a live value dead.
    case "assignee":
    case "reporter": {
      const u = ctx.users.find(x => x.id === key) ?? ctx.users.find(x => x.name === key);
      return u === undefined ? drifted(key) : known(u.name);
    }
    case "milestone": {
      const m = ctx.milestones.find(x => x.id === key)
        ?? ctx.milestones.find(x => x.name === key);
      return m === undefined ? drifted(key) : known(m.name);
    }
    case "sprint": {
      const s = ctx.sprints.find(x => x.id === key)
        ?? ctx.sprints.find(x => x.name === key);
      return s === undefined ? drifted(key) : known(s.name);
    }
    case "project": {
      const p = ctx.projects.find(x => x.id === key);
      return p === undefined ? drifted(key) : known(p.name);
    }
    case "labels": {
      const l = ctx.labels.find(x => x.id === key || x.name === key);
      return l === undefined ? drifted(key) : known(l.name);
    }
    case "due_date":
    case "start_date":
    case "completed_date":
      return known(shortDate(key));
    default:
      return known(key);
  }
}

/**
 * A custom field's value, rendered by the field's configured `type`
 * (CMT-27's second bullet).
 *
 * An enum resolves to its value label; a date goes through the same
 * formatter the rest of the app uses; a number is printed as a number.
 * A multi-valued field renders its members individually rather than
 * as an array dump (third bullet) — and the *diff* between the two
 * sides is computed by the caller, which is where both sides are in
 * hand.
 */
function renderCustomValue(
  ctx: DescribeContext,
  field: string | undefined,
  value: unknown,
): RenderedValue {
  const def = field === undefined ? undefined : customField(ctx, field);

  if (Array.isArray(value)) {
    const parts = value.map(v => renderCustomScalar(def, v));
    return {
      text: parts.map(p => (p.drifted ? `${p.text} ${DRIFT_SUFFIX}` : p.text)).join(", "),
      drifted: parts.some(p => p.drifted),
    };
  }
  return renderCustomScalar(def, value);
}

function renderCustomScalar(
  def: CustomFieldDef | undefined,
  value: unknown,
): RenderedValue {
  if (isEmpty(value)) return known(EMPTY_VALUE);
  // No definition at all: the field itself is drifted, and the caller
  // marks that on the *name*. The value is all that survives, so it is
  // printed as-is rather than marked twice.
  if (def === undefined) return known(stringify(value));

  switch (def.type) {
    case "enum": {
      const v = def.values?.find(x => x.key === String(value));
      return v === undefined ? drifted(String(value)) : known(v.label);
    }
    case "date":
      return known(shortDate(String(value)));
    case "number":
      return known(typeof value === "number" ? String(value) : stringify(value));
    case "boolean":
      return known(value === true ? "Yes" : "No");
    default:
      return known(stringify(value));
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? String(value);
}

/* ------------------------------------------------------------------ *
 * Whole entries
 * ------------------------------------------------------------------ */

/**
 * Describes one entry.
 *
 * `resolveUser` is passed in rather than read from `ctx` so the panel's
 * one `UserIndex` — the same join the comments use, with the same
 * "Unknown user" fallback — is the only place a ULID can leak. That is
 * the LST-33 shape and it gets one home, not two.
 */
export function describeEntry(
  entry: HistoryEntry,
  ctx: DescribeContext,
  resolveUser: (id: string) => string,
): DescribedEntry {
  const kindLabel = KIND_LABELS[entry.kind];

  switch (entry.kind) {
    case "created":
      return { kindLabel, summary: "created this task" };

    case "archived":
      return { kindLabel, summary: "archived this task" };

    case "unarchived":
      return { kindLabel, summary: "unarchived this task" };

    case "body_edited":
      /**
       * CMT-15's third bullet: says the body changed **without
       * pretending to show a diff**. `before`/`after` do carry the
       * whole text on this kind, but rendering them as a change pair
       * would put two documents in a feed row and imply a comparison
       * nothing here computed.
       */
      return { kindLabel, summary: "edited the description" };

    case "label_added":
      return {
        kindLabel,
        summary: `added the label ${labelText(ctx, entry.after)}`,
      };

    case "label_removed":
      return {
        kindLabel,
        summary: `removed the label ${labelText(ctx, entry.before)}`,
      };

    case "attachment_added":
      // CMT-15's fourth bullet: names the file from `meta`.
      return { kindLabel, summary: `attached ${metaString(entry, "name") ?? "a file"}` };

    case "attachment_removed":
      return { kindLabel, summary: `removed ${metaString(entry, "name") ?? "a file"}` };

    case "link_added":
      return { kindLabel, summary: `added a ${relationshipLabel(ctx, entry)} link` };

    case "link_removed":
      return { kindLabel, summary: `removed a ${relationshipLabel(ctx, entry)} link` };

    case "comment_added":
    case "comment_edited":
    case "comment_deleted":
      return { kindLabel, summary: commentSummary(entry, resolveUser) };

    case "rank_changed":
      return {
        kindLabel,
        summary: `reordered this task${
          entry.field === undefined ? "" : ` (${fieldName(ctx, entry.kind, entry.field).text})`
        }`,
      };

    case "merge_resolved": {
      const name = entry.field === undefined
        ? undefined
        : fieldName(ctx, entry.kind, entry.field);
      return {
        kindLabel,
        summary: `resolved a sync conflict${name === undefined ? "" : ` on ${name.text}`}`,
        ...(entry.field === undefined
          ? {}
          : {
              change: {
                field: name?.text ?? entry.field,
                before: renderValue(ctx, entry.kind, entry.field, entry.before),
                after: renderValue(ctx, entry.kind, entry.field, entry.after),
              },
            }),
      };
    }

    case "field_change":
    case "custom_field_change": {
      const key = entry.field;
      if (key === undefined) {
        // A `field_change` with no field is malformed but readable;
        // saying so beats printing a change with a blank name.
        return { kindLabel, summary: "changed a field this entry does not name" };
      }
      const name = fieldName(ctx, entry.kind, key);
      return {
        kindLabel,
        summary: `changed ${name.text}`,
        change: {
          field: name.drifted ? `${name.text} ${DRIFT_SUFFIX}` : name.text,
          before: renderValue(ctx, entry.kind, key, entry.before),
          after: renderValue(ctx, entry.kind, key, entry.after),
        },
      };
    }
  }
}

function labelText(ctx: DescribeContext, value: unknown): string {
  const v = renderValue(ctx, "label_added", "labels", value);
  return v.drifted ? `${v.text} ${DRIFT_SUFFIX}` : v.text;
}

function relationshipLabel(ctx: DescribeContext, entry: HistoryEntry): string {
  const type = metaString(entry, "type");
  if (type === undefined) return "relationship";
  const def = ctx.workflow?.relationships.find(r => r.key === type);
  return def?.label ?? type;
}

function metaString(entry: HistoryEntry, key: string): string | undefined {
  const v = entry.meta?.[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * CMT-15's last bullet.
 *
 * `actor` is who acted; `meta.author` is who *wrote* the comment. When
 * they differ the entry has to say so — "Ken edited Ana's comment",
 * not a bare "comment edited" — because an edit of someone else's
 * words is the fact the entry exists to record, and it is invisible
 * otherwise.
 *
 * The actor half is left out of this string: the row prints the actor
 * before it. So this returns "edited Ana's comment" and the row reads
 * "Ken edited Ana's comment".
 */
function commentSummary(
  entry: HistoryEntry,
  resolveUser: (id: string) => string,
): string {
  const verb = entry.kind === "comment_added"
    ? "added"
    : entry.kind === "comment_edited" ? "edited" : "deleted";
  const author = metaString(entry, "author");
  if (author === undefined || author === entry.actor) {
    return entry.kind === "comment_added" ? "commented" : `${verb} their comment`;
  }
  return `${verb} ${possessive(resolveUser(author))} comment`;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

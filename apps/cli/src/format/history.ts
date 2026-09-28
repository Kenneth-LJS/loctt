/**
 * Renders a single history entry as a one-line log message.
 *
 * The discriminator (`entry.kind`) is exhaustive over the
 * HistoryKind union from @loctt/contracts; new kinds need a new
 * case here, otherwise they fall through to the bare `{ts} {kind}`
 * fallback (which is wrong-but-not-broken — operator sees the kind,
 * just no per-kind details).
 */

import type { HistoryEntry, WorkflowConfig } from "@loctt/contracts";

import { formatValue } from "./value.js";

/**
 * Everything `formatHistoryEntry` needs to turn stored keys and ULIDs
 * into the names a person recognises. Both members are optional so a
 * caller that has neither (or whose config failed to load) still gets a
 * readable line — it degrades to the raw values rather than throwing.
 */
export interface HistoryDisplayContext {
  readonly workflow?: WorkflowConfig;
  /** user id → display name. */
  readonly users?: ReadonlyMap<string, string>;
  /**
   * K148: entity id → name for the other references a task holds, so
   * the log prints names as `show` does. A missing entry (a deleted
   * entity, or a config that did not load) prints the stored id.
   */
  readonly labels?: ReadonlyMap<string, string>;
  readonly milestones?: ReadonlyMap<string, string>;
  readonly sprints?: ReadonlyMap<string, string>;
  readonly projects?: ReadonlyMap<string, string>;
}

/** Which name map resolves a field holding an entity id. */
function entityNames(field: string, ctx: HistoryDisplayContext): ReadonlyMap<string, string> | undefined {
  switch (field) {
    case "assignee":
    case "reporter": return ctx.users;
    case "milestone": return ctx.milestones;
    case "sprint": return ctx.sprints;
    case "project": return ctx.projects;
    case "labels": return ctx.labels;
    default: return undefined;
  }
}

/** A stored entity id (or list of them) as names, the id where unknown. */
function nameEntityValue(raw: unknown, names: ReadonlyMap<string, string>): unknown {
  if (typeof raw === "string") return names.get(raw) ?? raw;
  if (Array.isArray(raw)) return (raw as unknown[]).map(v => (typeof v === "string" ? names.get(v) ?? v : v));
  return raw;
}

/**
 * Marks a value that is stored on the task but no longer declared in
 * `workflow.yaml`. Rendering it blank would be the worst option — the
 * value is still there and still filters, so hiding it makes the log
 * disagree with the data. Showing the bare key with a marker says both
 * "this is what is stored" and "your config no longer explains it".
 */
const DRIFT_MARKER = " (?)";

/** Fields whose values are workflow enum keys, and the list each resolves against. */
const ENUM_FIELDS: Record<string, keyof WorkflowConfig> = {
  status: "statuses",
  priority: "priorities",
  task_type: "task_types",
};

/**
 * Resolves one stored enum key to its configured label.
 *
 * Three outcomes, deliberately distinct:
 *  - config absent → the raw key, unmarked (we cannot know it drifted)
 *  - key present in config → the label
 *  - key absent from config → the raw key plus a drift marker
 */
function labelForEnum(
  field: string,
  raw: unknown,
  ctx: HistoryDisplayContext,
): string | undefined {
  const listKey = ENUM_FIELDS[field];
  if (listKey === undefined || typeof raw !== "string") return undefined;
  const workflow = ctx.workflow;
  if (workflow === undefined) return undefined;
  const list = workflow[listKey];
  if (!Array.isArray(list)) return undefined;
  const hit = (list as Array<{ key: string; label: string }>).find(d => d.key === raw);
  return hit ? hit.label : `${raw}${DRIFT_MARKER}`;
}

/** Renders one side of a field change, preferring a configured label. */
function formatFieldValue(
  field: string,
  raw: unknown,
  ctx: HistoryDisplayContext,
): string {
  const names = entityNames(field, ctx);
  if (names !== undefined) return formatValue(nameEntityValue(raw, names));
  return labelForEnum(field, raw, ctx) ?? formatValue(raw);
}

/** Names a custom field by its configured label rather than its key. */
function customFieldLabel(field: string, ctx: HistoryDisplayContext): string {
  const defs = ctx.workflow?.custom_fields;
  if (!Array.isArray(defs)) return field;
  return defs.find(d => d.key === field)?.label ?? field;
}

/**
 * Renders the trailing actor attribution.
 *
 * An entry with no actor gets a stated placeholder rather than a blank:
 * "who did this is not recorded" and "this line happens to end early"
 * look identical otherwise, and only one of them is a data problem.
 * A `.current-user` that was never written is normal on first run, so
 * this is a real state, not a corruption.
 */
function formatActor(entry: HistoryEntry, ctx: HistoryDisplayContext): string {
  if (entry.actor === undefined) return "  (actor unknown)";
  const name = ctx.users?.get(entry.actor);
  // Falling back to the id keeps a deleted user's actions attributable;
  // the alternative is a log that silently drops attribution the moment
  // someone leaves.
  return `  (${name ?? entry.actor})`;
}

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

function labelName(raw: unknown, ctx: HistoryDisplayContext): string {
  return typeof raw === "string" ? ctx.labels?.get(raw) ?? raw : String(raw);
}

export function formatHistoryEntry(
  entry: HistoryEntry,
  ctx: HistoryDisplayContext = {},
): string {
  return `${formatHistoryBody(entry, ctx)}${formatActor(entry, ctx)}`;
}

function formatHistoryBody(entry: HistoryEntry, ctx: HistoryDisplayContext): string {
  const ts = entry.timestamp;
  switch (entry.kind) {
    case "created":
      return `${ts}  created`;
    case "field_change": {
      // `field` is optional on the shared entry type. It has always been
      // present in practice for this kind, but interpolating it blind
      // printed the string "undefined" if it ever were not.
      const field = entry.field ?? "(unknown field)";
      return `${ts}  ${field}: ${formatFieldValue(field, entry.before, ctx)} → ${formatFieldValue(field, entry.after, ctx)}`;
    }
    case "custom_field_change": {
      const field = entry.field ?? "(unknown field)";
      return `${ts}  ${customFieldLabel(field, ctx)}: ${formatValue(entry.before)} → ${formatValue(entry.after)}`;
    }
    case "label_added":
      return `${ts}  label added: ${labelName(entry.after, ctx)}`;
    case "label_removed":
      return `${ts}  label removed: ${labelName(entry.before, ctx)}`;
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

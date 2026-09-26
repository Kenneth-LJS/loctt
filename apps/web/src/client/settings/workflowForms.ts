import type {
  CustomFieldDef,
  CustomFieldType,
  EntityColor,
  PriorityDef,
  RelationshipDef,
  StatusDef,
  TaskTypeDef,
  WorkflowConfig,
} from "@loctt/contracts";

/**
 * The pure create/edit-form rules behind the B2 workflow settings
 * dialogs (SET-46, SET-47, SET-48, SET-49).
 *
 * These live outside the components in the shape of `projectForm.ts`:
 * the point of validating on the client is the second bullet shared by
 * every create case — a duplicate key is rejected **before** the `PUT`,
 * so no round-trip half-writes the collection. The server enforces the
 * same uniqueness (`applyWorkflowEdit` re-parses the whole document
 * through Zod, which rejects two entries with the same key); this is the
 * early warning, not the enforcement.
 *
 * The key shape mirrors the enum-key convention already in the file:
 * lowercase, starting with a letter, letters/digits/underscore. It is
 * not enforced by a Zod `.regex` on the schemas (they accept any
 * non-empty string), so validating it here keeps the panel from minting
 * a key that reads unlike every other key in the tracker.
 */

/** lowercase, starts with a letter, then letters/digits/underscore. */
const KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Derives a candidate key from a label, same spirit as `slugify`. */
export function keyFromLabel(label: string): string {
  const collapsed = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (collapsed.length === 0) return "";
  return /^[a-z]/.test(collapsed) ? collapsed : `k_${collapsed}`;
}

export interface EntryDraft {
  readonly key: string;
  readonly label: string;
  /**
   * Optional presentational fields. Threaded through the builders so a
   * Create dialog that sets an icon/colour writes them (before this they
   * were dropped, and only survived a hand-authored round-trip). Undefined
   * drops the field off the stored row.
   */
  readonly icon?: string | undefined;
  /** K103: one of the three colour shapes, not a hex string. */
  readonly color?: EntityColor | undefined;
}

export interface EntryProblems {
  readonly key?: string;
  readonly label?: string;
}

/**
 * SET-46/47/48: a status / priority / task-type / relationship key must
 * be non-empty, well-formed, and not collide with an existing key in
 * the same collection.
 *
 * `existingKeys` is the collision set; passing it in (rather than the
 * whole collection) keeps this reusable across the four collections
 * whose row shapes differ but whose key rule does not.
 */
export function validateNewEntry(
  draft: EntryDraft,
  existingKeys: readonly string[],
): EntryProblems {
  const problems: { key?: string; label?: string } = {};
  const key = draft.key.trim();
  const label = draft.label.trim();

  if (label.length === 0) {
    problems.label = "A label is required.";
  }

  if (key.length === 0) {
    problems.key = "A key is required. Task files store it, so it is permanent.";
  } else if (!KEY_RE.test(key)) {
    const suggested = keyFromLabel(key);
    problems.key = "A key is lowercase letters, digits or underscore, starting "
      + "with a letter."
      + (suggested.length > 0 && suggested !== key ? ` Try ${suggested}.` : "");
  } else if (existingKeys.includes(key)) {
    // The collision, named — SET-46's third bullet.
    problems.key = `The key ${key} is already in use. Keys must be unique.`;
  }

  return problems;
}

/** True when a draft has no problems and can be submitted. */
export function hasNoProblems(problems: EntryProblems): boolean {
  return problems.key === undefined && problems.label === undefined;
}

/**
 * Builds the new `StatusDef` a Create dialog PUTs. `category` and
 * `default` are collected in the dialog; `default` is only ever set true
 * here when the user asked for it, and `setDefaultStatus` clears the old
 * one in the same edit so the document keeps exactly one default.
 */
export function buildStatus(draft: {
  readonly key: string;
  readonly label: string;
  readonly category: StatusDef["category"];
  readonly icon?: string | undefined;
  /** K103: one of the three colour shapes, not a hex string. */
  readonly color?: EntityColor | undefined;
}): StatusDef {
  return {
    key: draft.key.trim(),
    label: draft.label.trim(),
    category: draft.category,
    ...presentational(draft),
  };
}

/**
 * The optional icon/colour pair, included only when set — an empty string
 * or undefined drops the key so the stored row stays clean and the schema
 * (which rejects a blank icon and a malformed colour) never sees one.
 */
function presentational(
  draft: { readonly icon?: string | undefined; readonly color?: EntityColor | undefined },
): { icon?: string; color?: EntityColor } {
  const out: { icon?: string; color?: EntityColor } = {};
  const icon = draft.icon?.trim();
  if (icon !== undefined && icon.length > 0) out.icon = icon;
  // K103: a colour is no longer necessarily a string, so it cannot be
  // trimmed. The only "empty" values are `undefined` and an empty
  // single hex; the object shapes are never empty. Trimming an object
  // was a type error here, but the same pattern elsewhere widened
  // through inference and silently produced `[object Object]`.
  const color = draft.color;
  if (color !== undefined && !(typeof color === "string" && color.trim().length === 0)) {
    out.color = typeof color === "string" ? color.trim() : color;
  }
  return out;
}

/**
 * A new priority. `value` is deliberately omitted: the panel renumbers
 * every priority from position on save (`renumberPriorities`), so a
 * value set here would be overwritten. Task-types share the bare
 * key/label shape.
 */
export function buildPriority(draft: EntryDraft): PriorityDef {
  return { key: draft.key.trim(), label: draft.label.trim(), ...presentational(draft) };
}

export function buildTaskType(draft: EntryDraft): TaskTypeDef {
  return { key: draft.key.trim(), label: draft.label.trim(), ...presentational(draft) };
}

/**
 * A new relationship. Symmetric drops the inverse fields (the schema
 * rejects a symmetric rel whose `inverse` differs from its `key`);
 * directional carries both. `graph` and `ranked` come straight from the
 * dialog.
 */
export interface RelationshipDraft {
  readonly key: string;
  readonly label: string;
  readonly symmetric: boolean;
  readonly inverse: string;
  readonly inverse_label: string;
  readonly graph: RelationshipDef["graph"];
  readonly ranked: boolean;
  /**
   * Presentational fields the Edit dialog has no controls for. Seeded
   * from the row being edited and carried straight back, so editing a
   * relationship's label does not wipe its icon/color — the dialog only
   * knows the fields it renders.
   */
  readonly icon?: string | undefined;
  /** K103: one of the three colour shapes, not a hex string. */
  readonly color?: EntityColor | undefined;
}

export function buildRelationship(draft: RelationshipDraft): RelationshipDef {
  const base = {
    key: draft.key.trim(),
    label: draft.label.trim(),
    graph: draft.graph ?? "none",
    ranked: draft.ranked,
    // Preserve the presentational fields the dialog does not edit.
    ...(draft.icon !== undefined ? { icon: draft.icon } : {}),
    ...(draft.color !== undefined ? { color: draft.color } : {}),
  };
  if (draft.symmetric) {
    return { ...base, kind: "symmetric" };
  }
  return {
    ...base,
    kind: "directional",
    inverse: draft.inverse.trim(),
    inverse_label: draft.inverse_label.trim(),
  };
}

/**
 * SET-48's inverse fields are required for a directional relationship
 * (the schema's `superRefine` rejects a directional rel with no
 * `inverse`/`inverse_label`), so the dialog validates them before the
 * `PUT` rather than surfacing the 400.
 */
export function validateNewRelationship(
  draft: RelationshipDraft,
  existingKeys: readonly string[],
): EntryProblems & { inverse?: string; inverse_label?: string } {
  const base = validateNewEntry(draft, existingKeys);
  const extra: { inverse?: string; inverse_label?: string } = {};
  if (!draft.symmetric) {
    if (draft.inverse.trim().length === 0) {
      extra.inverse = "A directional relationship needs an inverse key "
        + "(or mark it symmetric).";
    } else if (draft.inverse.trim() === draft.key.trim()) {
      extra.inverse = "The inverse equals the key. Mark the relationship "
        + "symmetric instead.";
    }
    if (draft.inverse_label.trim().length === 0) {
      extra.inverse_label = "A directional relationship needs an inverse label.";
    }
  }
  return { ...base, ...extra };
}

/** SET-49: the fields a custom-field Create dialog collects. */
export interface CustomFieldDraft {
  readonly key: string;
  readonly label: string;
  readonly type: CustomFieldType;
  readonly multi: boolean;
  readonly searchable: boolean;
  /**
   * K91/TSK-12: an optional allowlist of task_type keys this field is
   * scoped to. Undefined (or empty from the dialog) = global — the field
   * shows for every type. When non-empty the field shows only for a task
   * whose task_type is listed (see `customFieldInScope`). Threaded here so
   * the authoring control reaches the stored row on both create and edit;
   * the consumption side (create-modal + detail filtering) already shipped.
   */
  readonly task_types?: readonly string[] | undefined;
  /** Only meaningful when `type === "enum"`. */
  readonly values: readonly {
    readonly key: string;
    readonly label: string;
    readonly value?: number;
    /**
     * Presentational fields the dialog has no controls for. Seeded from
     * the value being edited and carried back, so editing a value's
     * label does not wipe its icon/color.
     */
    readonly icon?: string | undefined;
    /** K103: one of the three colour shapes, not a hex string. */
    readonly color?: EntityColor | undefined;
  }[];
}

/**
 * SET-49: a custom field's key rules match the others, and an enum field
 * must declare at least one value with a unique, well-formed key — the
 * schema's `superRefine` rejects an empty enum and duplicate value keys,
 * so the dialog blocks them before the `PUT`.
 */
export function validateNewCustomField(
  draft: CustomFieldDraft,
  existingKeys: readonly string[],
): EntryProblems & { values?: string } {
  const base = validateNewEntry(draft, existingKeys);
  const extra: { values?: string } = {};
  if (draft.type === "enum") {
    const values = draft.values.filter(v => v.key.trim().length > 0 || v.label.trim().length > 0);
    if (values.length === 0) {
      extra.values = "An enum field needs at least one value.";
    } else {
      const seen = new Set<string>();
      for (const v of values) {
        const k = v.key.trim();
        if (k.length === 0 || !KEY_RE.test(k)) {
          extra.values = `Each value needs a key: lowercase letters, digits or `
            + `underscore, starting with a letter${k.length > 0 ? ` (got "${k}")` : ""}.`;
          break;
        }
        if (seen.has(k)) {
          extra.values = `Duplicate value key "${k}". A task storing it would be ambiguous.`;
          break;
        }
        seen.add(k);
        if (v.label.trim().length === 0) {
          extra.values = `The value "${k}" needs a label.`;
          break;
        }
      }
    }
  }
  return { ...base, ...extra };
}

export function buildCustomField(draft: CustomFieldDraft): CustomFieldDef {
  const base = {
    key: draft.key.trim(),
    label: draft.label.trim(),
    type: draft.type,
    multi: draft.multi,
    searchable: draft.searchable,
    // K91: only carry `task_types` when the field is scoped. An empty
    // allowlist is a valid "shows for no type" config, but the dialog
    // treats empty as "global" (the consumption default when absent), so
    // an empty selection drops the key rather than storing a field that
    // shows nowhere — that is the semantic the create-modal/detail
    // consumption side reads via `customFieldInScope` (absent ⇒ global).
    ...(draft.task_types !== undefined && draft.task_types.length > 0
      ? { task_types: [...draft.task_types] }
      : {}),
  };
  if (draft.type !== "enum") return base;
  return {
    ...base,
    values: draft.values
      .filter(v => v.key.trim().length > 0)
      .map(v => ({
        key: v.key.trim(),
        label: v.label.trim(),
        ...(v.value !== undefined ? { value: v.value } : {}),
        // Preserve the presentational fields the dialog does not edit.
        ...(v.icon !== undefined ? { icon: v.icon } : {}),
        ...(v.color !== undefined ? { color: v.color } : {}),
      })),
  };
}

/**
 * SET-28: has the entry the Edit dialog opened over changed on disk?
 *
 * The Edit dialog captures the row as it was when the dialog opened
 * (`baseline`). Before the `PUT`, the mutation re-reads the whole
 * document; this compares the freshly-read version of that same key
 * against the baseline. A difference means the file was hand-edited
 * underneath the open dialog, so the save is refused rather than
 * clobbering the hand edit — the dialog cannot merge two orderings or
 * two label edits it never saw.
 *
 * A row that vanished from the file (deleted by hand) also counts as
 * changed: writing the panel's copy back would resurrect it.
 */
export function entryChangedOnDisk<T extends { readonly key: string }>(
  baseline: T,
  fresh: readonly T[],
): boolean {
  const current = fresh.find(r => r.key === baseline.key);
  if (current === undefined) return true;
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

/** The collision set for a collection, for `validateNewEntry`. */
export function collectionKeys(
  workflow: WorkflowConfig,
  collection: "statuses" | "priorities" | "task_types" | "relationships" | "custom_fields",
): string[] {
  return (workflow[collection] as readonly { key: string }[]).map(r => r.key);
}

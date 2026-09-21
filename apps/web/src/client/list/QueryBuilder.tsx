import type { WorkflowConfig } from "@loctt/contracts";
// `ComparisonOp`/`QueryValue` come from core by per-file subpath, NOT the
// barrel: the barrel drags node:path/sharp into the browser bundle (see
// dslToSearch.ts's parser.js import, A37). The tree model itself is
// web-client-local — K102 removed it from core along with the saved-view
// storage that once used it; see builderTree.ts's header.
import type { ComparisonOp, QueryValue } from "@loctt/core/query/parser.js";
import { useMemo } from "react";

import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import {
  Combobox,
  ComboboxButton,
  type ComboboxOption,
  type ComboboxSearch,
  SelectCombobox,
} from "../ui/Combobox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { TextField } from "../ui/TextField.tsx";
import type { BuilderTree } from "./builderTree.ts";
// The component derives the live `q` preview from the same serializer the
// surface applies through, so the preview and the applied query share one
// grammar rather than two that agree by coincidence.
import { builderTreeToQuery } from "./builderTree.ts";

/**
 * The visual query builder's FORM (K83, step 2) — a controlled renderer
 * over a {@link BuilderTree}. The PARENT owns the tree state and the
 * initial parse from a `q` string (step 3 wires FilterBar to it via
 * `queryToBuilderTree`); this component only renders a tree, edits it
 * through pickers, and emits the next tree on every change.
 *
 * ## Why controlled, and why config comes in as props
 *
 * FilterBar already reads workflow + sidebar data (statuses, priorities,
 * task_types, labels, users) and turns them into option lists
 * (`buildFacetOptions`). Rather than re-fetch here — which would couple
 * the builder to react-query and make it un-testable in isolation — the
 * builder takes those option sources as a single {@link BuilderConfig}
 * prop. Step 3 assembles it from the same hooks the bar uses, so the
 * builder can NEVER offer a value `validateQuery` would reject: its
 * pickers are populated from the identical config the validator reads.
 *
 * ## Op-by-field-kind, then per-field: FILTERED (agent decision A186/A187)
 *
 * The op picker is constrained to the renderable ops that make SENSE for
 * the field's kind — enum fields do not offer `~` (substring over an
 * enum key is a category error the DSL rejects), and only date/number
 * fields offer `<`/`>` ordering. The alternative (offer every renderable
 * op on every field) was rejected: it would let the builder emit
 * `status ~ foo`, which the validator then rejects — reintroducing the
 * exact "builder offered a query the validator refuses" gap the
 * config-sourced pickers close.
 *
 * TWO fields the validator constrains more tightly than their kind are
 * narrowed per-field (`OPS_BY_FIELD`), so the "cannot offer a query the
 * validator rejects, by construction" property actually holds (F3/F4 —
 * before that fix the kind default leaked ops the validator refused):
 *  - the `text` alias FIELD offers ONLY `~` (validate.ts: the substring
 *    alias rejects every other operator, presence included) — while the
 *    `text` KIND used by title/id/key keeps the full string set;
 *  - `comment_mentions` offers ONLY =, !=, in, not in (CMT-10) — its
 *    kind is `user`, which would otherwise add the presence ops.
 */

// ── Field catalog ────────────────────────────────────────────────────

/**
 * The kind of a field, which drives BOTH the operator set and the value
 * control. Mirrors the DSL's own value semantics rather than inventing a
 * parallel taxonomy:
 *  - `enum`     — status/priority/task_type + enum custom fields:
 *                 value is one of a closed config-defined set.
 *  - `entity`   — assignee/reporter/labels/milestone/sprint/project:
 *                 value is a ULID chosen from a config list.
 *  - `text`     — title/text/id/key and string custom fields: free text,
 *                 substring (`~`) allowed.
 *  - `date`     — *_date / *_at fields: ordering + `today`.
 *  - `number`   — estimate/board_rank + number custom fields: ordering.
 *  - `boolean`  — archived + boolean custom fields.
 *  - `user`     — assignee/reporter specifically: entity-like, but also
 *                 offers a `currentUser()` affordance.
 */
export type FieldKind =
  | "enum" | "entity" | "user" | "text" | "date" | "number" | "boolean";

/** One choosable field in the field picker. */
export interface BuilderField {
  /** The DSL field token, e.g. `status`, `assignee`, `fields.severity`. */
  readonly field: string;
  /** Human label for the picker. */
  readonly label: string;
  readonly kind: FieldKind;
  /**
   * For `enum`/`entity`/`user` fields: the closed set of choosable
   * values (value = stored key/ULID, label = human). Absent for the
   * free-value kinds (text/date/number/boolean).
   *
   * For an `entity`/`user` field with a {@link search}, this is only the
   * SEED list (the capped initial fetch) — used before the user types and
   * to keep the current selection's label resolvable; the live candidates
   * come from `search`.
   */
  readonly options?: readonly ValueOption[];
  /**
   * K90: server-side value search for `entity`/`user` fields. When present
   * the value picker queries the server `?q=` as the user types rather than
   * filtering the capped {@link options} in memory — so a workspace past the
   * fetch window (hundreds of users/labels/milestones/sprints, A211) is
   * searchable, matching the rest of the app (task-meta, the filter facets).
   * Absent for enum fields (a closed config set, never large) and the
   * free-value kinds. Returns `{ value, label }` rows already mapped, plus
   * a `disabled`/`suffix` for archived entities so they stay visible but
   * unselectable (the option mapper carries the same rule the sidebar hooks
   * apply).
   */
  readonly search?: EntitySearch;
}

export interface ValueOption {
  readonly value: string;
  readonly label: string;
  /** Present-but-disabled (archived entities), with the reason as a suffix. */
  readonly disabled?: boolean;
  readonly suffix?: string;
}

/**
 * K90: an imperative entity search. `q` is the trimmed search text (empty
 * before the user types); resolves to the bounded, already-mapped matches.
 * Mirrors {@link ComboboxSearch.onQuery}'s contract so it threads straight
 * through to the value Combobox.
 */
export type EntitySearch = (q: string) => Promise<readonly ValueOption[]>;

/**
 * Everything the builder needs to populate its pickers. Step 3 builds
 * this from `useWorkflow` + the sidebar hooks (the same sources
 * `buildFacetOptions` reads); step 2 tests pass it directly.
 */
export interface BuilderConfig {
  readonly fields: readonly BuilderField[];
}

/**
 * The built-in DSL fields the builder always offers, independent of
 * workflow config. Kept parallel to core's `QUERYABLE_FIELDS`: every
 * entry here is a name the validator accepts, and the kind chosen for
 * each matches how the evaluator reads it. Entity fields
 * (assignee/reporter/labels/milestone/sprint/project) get their option
 * lists spliced in by {@link buildBuilderConfig} from sidebar data.
 */
const BUILTIN_FIELDS: readonly Omit<BuilderField, "options">[] = [
  { field: "title", label: "Title", kind: "text" },
  { field: "text", label: "Text (title + body)", kind: "text" },
  { field: "id", label: "ID", kind: "text" },
  { field: "key", label: "Key", kind: "text" },
  { field: "project", label: "Project", kind: "entity" },
  { field: "assignee", label: "Assignee", kind: "user" },
  { field: "reporter", label: "Reporter", kind: "user" },
  { field: "labels", label: "Label", kind: "entity" },
  { field: "milestone", label: "Milestone", kind: "entity" },
  { field: "sprint", label: "Sprint", kind: "entity" },
  { field: "comment_mentions", label: "Comment mentions", kind: "user" },
  { field: "parent", label: "Parent", kind: "text" },
  { field: "created_at", label: "Created", kind: "date" },
  { field: "updated_at", label: "Updated", kind: "date" },
  { field: "status_updated_at", label: "Status updated", kind: "date" },
  { field: "start_date", label: "Start date", kind: "date" },
  { field: "due_date", label: "Due date", kind: "date" },
  { field: "completed_date", label: "Completed", kind: "date" },
  { field: "archived_at", label: "Archived at", kind: "date" },
  { field: "estimate", label: "Estimate", kind: "number" },
  { field: "board_rank", label: "Board rank", kind: "number" },
  { field: "archived", label: "Archived", kind: "boolean" },
];

/**
 * Assembles the field catalog from workflow + sidebar option sources —
 * the SAME sources FilterBar's `buildFacetOptions` reads, so the builder
 * cannot offer a value the validator would reject.
 *
 * Exported for step 3 (the FilterBar wiring) and for the tests, which
 * feed a small hand-built config to exercise the constrained pickers.
 */
export function buildBuilderConfig(input: {
  readonly workflow: WorkflowConfig | undefined;
  readonly projects: readonly ValueOption[];
  readonly users: readonly ValueOption[];
  readonly labels: readonly ValueOption[];
  readonly milestones: readonly ValueOption[];
  readonly sprints: readonly ValueOption[];
  /**
   * K90: per-entity-type server search. Threaded onto the matching
   * `entity`/`user` fields so their value pickers query the server as the
   * user types instead of filtering the capped seed list. Optional — the
   * step-2 tests and any caller that only has the seed lists omit it, and
   * the picker falls back to client-side filtering over `options`.
   */
  readonly search?: {
    readonly projects?: EntitySearch;
    readonly users?: EntitySearch;
    readonly labels?: EntitySearch;
    readonly milestones?: EntitySearch;
    readonly sprints?: EntitySearch;
  };
}): BuilderConfig {
  const entityOptions: Record<string, readonly ValueOption[]> = {
    project: input.projects,
    assignee: input.users,
    reporter: input.users,
    comment_mentions: input.users,
    labels: input.labels,
    milestone: input.milestones,
    sprint: input.sprints,
  };

  // The search fn for each entity field, by the SAME field→source mapping
  // as entityOptions above, so a field's live search matches its seed list.
  const entitySearch: Record<string, EntitySearch | undefined> = {
    project: input.search?.projects,
    assignee: input.search?.users,
    reporter: input.search?.users,
    comment_mentions: input.search?.users,
    labels: input.search?.labels,
    milestone: input.search?.milestones,
    sprint: input.search?.sprints,
  };

  const enumFields: BuilderField[] = [
    { field: "status", label: "Status", kind: "enum",
      options: (input.workflow?.statuses ?? []).map(s => ({ value: s.key, label: s.label })) },
    { field: "priority", label: "Priority", kind: "enum",
      options: (input.workflow?.priorities ?? []).map(p => ({ value: p.key, label: p.label })) },
    { field: "task_type", label: "Type", kind: "enum",
      options: (input.workflow?.task_types ?? []).map(t => ({ value: t.key, label: t.label })) },
  ];

  const builtins: BuilderField[] = BUILTIN_FIELDS.map((f): BuilderField => {
    if (!(f.field in entityOptions)) return { ...f };
    // Bind to a local so the `!== undefined` narrowing sticks — a record
    // index access re-widens to `EntitySearch | undefined` at each use,
    // which exactOptionalPropertyTypes rejects for the optional `search`.
    const search = entitySearch[f.field];
    return {
      ...f,
      options: entityOptions[f.field] ?? [],
      ...(search !== undefined ? { search } : {}),
    };
  });

  const customFields: BuilderField[] = (input.workflow?.custom_fields ?? []).map(cf => {
    const field = `fields.${cf.key}`;
    if (cf.type === "enum") {
      return {
        field, label: cf.label, kind: "enum" as const,
        options: (cf.values ?? []).map(v => ({ value: v.key, label: v.label })),
      };
    }
    const kind: FieldKind =
      cf.type === "number" ? "number"
      : cf.type === "date" ? "date"
      : cf.type === "boolean" ? "boolean"
      : "text";
    return { field, label: cf.label, kind };
  });

  // Enum fields first (the common filters), then the rest, then custom.
  return { fields: [...enumFields, ...builtins, ...customFields] };
}

// ── Operator sets by field kind ──────────────────────────────────────

/**
 * The renderable ops offered for each field kind. A subset of core's
 * RENDERABLE_OPS, filtered to what is meaningful for the kind — see the
 * op-by-field-kind note at the top. Ordering matches the DSL's own
 * conventional reading (equality, membership, ordering, substring,
 * presence).
 */
const OPS_BY_KIND: Record<FieldKind, readonly ComparisonOp[]> = {
  enum: ["=", "!=", "in", "not in", "is empty", "is not empty"],
  entity: ["=", "!=", "in", "not in", "is empty", "is not empty"],
  // `user` covers assignee/reporter, which are scalar entity refs;
  // equality/membership/presence fit them, and we deliberately do NOT
  // offer `~` on a ULID. `comment_mentions` shares this kind but is
  // narrowed further by OPS_BY_FIELD below (CMT-10).
  user: ["=", "!=", "in", "not in", "is empty", "is not empty"],
  // The `text` KIND (title/id/key + string custom fields) accepts the
  // full string operator set. The `text` alias FIELD is narrower — see
  // OPS_BY_FIELD (F3): the validator accepts only `~` on it.
  text: ["=", "!=", "~", "is empty", "is not empty"],
  date: ["=", "!=", "<", "<=", ">", ">=", "is empty", "is not empty"],
  number: ["=", "!=", "<", "<=", ">", ">=", "is empty", "is not empty"],
  boolean: ["=", "!="],
};

/**
 * Field-specific operator sets that OVERRIDE the kind default, for the two
 * fields the validator constrains more tightly than their kind — so the
 * builder cannot offer an operator `validateQuery` would reject (the
 * "cannot offer a query the validator rejects, by construction" property).
 *
 * - `text` (F3): a substring-search alias over title+body. The validator
 *   (validate.ts, "text alias only accepts ~") rejects EVERY non-`~`
 *   operator, presence tests included — so the builder offers only `~`.
 *   This is the alias FIELD, not the `text` KIND (title/id/key still get
 *   the full set).
 * - `comment_mentions` (F4 / CMT-10): flat set membership — the validator
 *   accepts only =, !=, in, not in (no ordering, substring, or presence).
 *   Its kind is `user`, which would otherwise offer the presence ops.
 */
const OPS_BY_FIELD: Readonly<Record<string, readonly ComparisonOp[]>> = {
  text: ["~"],
  comment_mentions: ["=", "!=", "in", "not in"],
};

/** The operators the builder offers for a field — its override, else its kind's. */
function opsFor(field: string, kind: FieldKind): readonly ComparisonOp[] {
  return OPS_BY_FIELD[field] ?? OPS_BY_KIND[kind];
}

/** Human labels for the operators, for the op picker's options. */
const OP_LABELS: Record<ComparisonOp, string> = {
  "=": "is",
  "!=": "is not",
  "in": "is any of",
  "not in": "is none of",
  "<": "before / less than",
  "<=": "on or before / ≤",
  ">": "after / greater than",
  ">=": "on or after / ≥",
  "~": "contains",
  "is empty": "is empty",
  "is not empty": "is not empty",
};

/** The postfix presence ops carry no right-hand value. */
function isPostfix(op: ComparisonOp): boolean {
  return op === "is empty" || op === "is not empty";
}

/** Whether the op takes a list value (multi-value control). */
function isListOp(op: ComparisonOp): boolean {
  return op === "in" || op === "not in";
}

// ── Value construction ───────────────────────────────────────────────

/**
 * Maps a config/search {@link ValueOption} to the value picker's
 * {@link ComboboxOption}, carrying an archived entity's disabled+suffix so
 * it stays visible-but-unselectable — the same rule the task-meta pickers'
 * option mappers apply, so the builder and the rest of the app render an
 * archived value the same way.
 */
function valueOptionToCombobox(o: ValueOption): ComboboxOption {
  return {
    key: o.value,
    label: o.label,
    ...(o.disabled === true ? { disabled: true } : {}),
    ...(o.suffix !== undefined ? { suffix: o.suffix } : {}),
  };
}

/**
 * The empty/default value for a (field, op) pair — used when the op
 * changes and the previous value no longer fits (e.g. switching to a
 * list op, or to a presence op that takes no value).
 */
function defaultValueFor(kind: FieldKind, op: ComparisonOp): QueryValue {
  if (isPostfix(op)) return { type: "empty" };
  if (isListOp(op)) return { type: "list", values: [] };
  if (kind === "boolean") return { type: "boolean", value: false };
  if (kind === "number") return { type: "number", value: 0 };
  if (kind === "date") return { type: "date", value: "" };
  return { type: "string", value: "" };
}

/** A single scalar from a raw string, per field kind. */
function scalarFromString(kind: FieldKind, raw: string): QueryValue {
  if (kind === "number") {
    const n = Number(raw);
    return { type: "number", value: Number.isFinite(n) ? n : 0 };
  }
  if (kind === "date") return { type: "date", value: raw };
  return { type: "string", value: raw };
}

/** The current scalar value rendered as an editable string. */
function scalarToString(v: QueryValue): string {
  switch (v.type) {
    case "string": return v.value;
    case "date": return v.value;
    case "number": return String(v.value);
    case "today": return "today";
    case "current_user": return "currentUser()";
    default: return "";
  }
}

// ── Tree editing helpers ─────────────────────────────────────────────

/**
 * Immutably replaces the node at `path` (a list of child indices from
 * the root) using `fn`, or removes it when `fn` returns `null`. Removing
 * the sole child of a group leaves an empty group, which the caller
 * (remove control) guards against by refusing to remove a group's last
 * child at the root; nested empties are pruned here.
 */
function editAt(
  tree: BuilderTree,
  path: readonly number[],
  fn: (node: BuilderTree) => BuilderTree | null,
): BuilderTree | null {
  if (path.length === 0) return fn(tree);
  if (tree.kind !== "group") return tree; // path into a leaf: no-op
  const [head, ...rest] = path;
  const idx = head ?? 0;
  const child = tree.children[idx];
  if (child === undefined) return tree;
  const next = editAt(child, rest, fn);
  const children = [...tree.children];
  if (next === null) children.splice(idx, 1);
  else children[idx] = next;
  return { ...tree, children };
}

// ── Component ────────────────────────────────────────────────────────

export interface QueryBuilderProps {
  readonly tree: BuilderTree;
  readonly onChange: (tree: BuilderTree) => void;
  readonly config: BuilderConfig;
}

export function QueryBuilder({ tree, onChange, config }: QueryBuilderProps) {
  const fieldByName = useMemo(() => {
    const m = new Map<string, BuilderField>();
    for (const f of config.fields) m.set(f.field, f);
    return m;
  }, [config.fields]);

  // The derived q preview. builderTreeToQuery throws only on an empty
  // group; the builder never emits one through the UI, but a defensive
  // catch keeps the preview from crashing the whole form mid-edit.
  const preview = (() => {
    try {
      return builderTreeToQuery(tree);
    } catch {
      return "";
    }
  })();

  const replaceRoot = (next: BuilderTree | null): void => {
    // A fully-removed root collapses to an empty AND group rather than
    // nothing, so the form always has something to render and add to.
    onChange(next ?? { kind: "group", op: "and", children: [] });
  };

  const edit = (
    path: readonly number[],
    fn: (node: BuilderTree) => BuilderTree | null,
  ): void => {
    replaceRoot(editAt(tree, path, fn));
  };

  return (
    <div data-testid="query-builder" className="flex flex-col gap-2">
      <GroupNode
        node={tree.kind === "group" ? tree : { kind: "group", op: "and", children: [tree] }}
        path={[]}
        edit={edit}
        fields={config.fields}
        fieldByName={fieldByName}
        isRoot
      />

      <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
        <span className="text-[0.7857rem] font-medium text-text-tertiary">Query</span>
        <code
          data-testid="query-builder-preview"
          className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-[0.8571rem] text-text-secondary"
        >
          {preview}
        </code>
      </div>
    </div>
  );
}

// ── Group ────────────────────────────────────────────────────────────

function GroupNode({
  node,
  path,
  edit,
  fields,
  fieldByName,
  isRoot = false,
}: {
  readonly node: Extract<BuilderTree, { kind: "group" }>;
  readonly path: readonly number[];
  readonly edit: (path: readonly number[], fn: (n: BuilderTree) => BuilderTree | null) => void;
  readonly fields: readonly BuilderField[];
  readonly fieldByName: ReadonlyMap<string, BuilderField>;
  readonly isRoot?: boolean;
}) {
  const firstField = fields[0];

  const setOp = (op: "and" | "or"): void => {
    edit(path, n => (n.kind === "group" ? { ...n, op } : n));
  };

  const addCondition = (): void => {
    if (firstField === undefined) return;
    const op: ComparisonOp = opsFor(firstField.field, firstField.kind)[0] ?? "=";
    const leaf: BuilderTree = {
      kind: "leaf",
      field: firstField.field,
      op,
      value: defaultValueFor(firstField.kind, op),
    };
    edit(path, n => (n.kind === "group" ? { ...n, children: [...n.children, leaf] } : n));
  };

  const addGroup = (): void => {
    const group: BuilderTree = { kind: "group", op: "and", children: [] };
    edit(path, n => (n.kind === "group" ? { ...n, children: [...n.children, group] } : n));
  };

  return (
    <div
      data-testid="query-builder-group"
      className={
        isRoot
          ? "flex flex-col gap-2"
          : "flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-surface/40 p-2"
      }
    >
      <div className="flex items-center gap-2">
        <AndOrToggle value={node.op} onChange={setOp} />
        <span className="text-[0.7857rem] text-text-tertiary">
          {node.op === "and" ? "Match all of:" : "Match any of:"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 pl-3">
        {node.children.length === 0 ? (
          <p className="text-[0.8571rem] text-text-tertiary">No conditions yet.</p>
        ) : (
          node.children.map((child, i) => (
            // A leaf's remove button centers with its single row of h-7
            // controls; a nested group is tall, so its remove button aligns
            // to the top of the group card instead.
            <div
              key={i}
              className={
                child.kind === "leaf"
                  ? "flex items-center gap-1.5"
                  : "flex items-start gap-1.5"
              }
            >
              <div className="min-w-0 flex-1">
                {child.kind === "leaf" ? (
                  <LeafRow
                    node={child}
                    path={[...path, i]}
                    edit={edit}
                    fields={fields}
                    fieldByName={fieldByName}
                  />
                ) : child.kind === "group" ? (
                  <GroupNode
                    node={child}
                    path={[...path, i]}
                    edit={edit}
                    fields={fields}
                    fieldByName={fieldByName}
                  />
                ) : null /* not/has_link are stored-conditions kinds the
                  visual builder never produces (queryToBuilderTree refuses
                  them); nothing to render here. */}
              </div>
              <IconButton
                size="xs"
                testId="qb-remove"
                aria-label="Remove condition"
                onClick={() => { edit([...path, i], () => null); }}
                className={child.kind === "leaf" ? "shrink-0" : "mt-1.5 shrink-0"}
              >
                <Icon name="close" size={14} />
              </IconButton>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 pl-3">
        <Button
          variant="secondary"
          size="sm"
          testId="qb-add-condition"
          onClick={addCondition}
        >
          <Icon name="plus" size={12} />
          Condition
        </Button>
        <Button
          variant="secondary"
          size="sm"
          testId="qb-add-group"
          onClick={addGroup}
        >
          <Icon name="plus" size={12} />
          Group
        </Button>
      </div>
    </div>
  );
}

function AndOrToggle({
  value,
  onChange,
}: {
  readonly value: "and" | "or";
  readonly onChange: (op: "and" | "or") => void;
}) {
  return (
    <div
      data-testid="qb-and-or"
      role="group"
      aria-label="Match all or any"
      className="inline-flex overflow-hidden rounded border border-border-subtle text-[0.8571rem]"
    >
      {(["and", "or"] as const).map(op => (
        <button
          key={op}
          type="button"
          data-testid={`qb-and-or-${op}`}
          aria-pressed={value === op}
          onClick={() => { onChange(op); }}
          className={
            "px-2 py-0.5 " +
            (value === op
              ? "bg-accent text-accent-contrast"
              : "bg-bg-surface text-text-secondary hover:bg-bg-muted")
          }
        >
          {op === "and" ? "AND" : "OR"}
        </button>
      ))}
    </div>
  );
}

// ── Leaf row ─────────────────────────────────────────────────────────

function LeafRow({
  node,
  path,
  edit,
  fields,
  fieldByName,
}: {
  readonly node: Extract<BuilderTree, { kind: "leaf" }>;
  readonly path: readonly number[];
  readonly edit: (path: readonly number[], fn: (n: BuilderTree) => BuilderTree | null) => void;
  readonly fields: readonly BuilderField[];
  readonly fieldByName: ReadonlyMap<string, BuilderField>;
}) {
  // The field's kind drives both the op set and the value control. An
  // unknown field (edited via a query the config doesn't describe) falls
  // back to text, so the row still renders and edits rather than crashing.
  const fieldDef = fieldByName.get(node.field);
  const kind: FieldKind = fieldDef?.kind ?? "text";
  const ops = opsFor(node.field, kind);

  const setLeaf = (next: Partial<Extract<BuilderTree, { kind: "leaf" }>>): void => {
    edit(path, n => (n.kind === "leaf" ? { ...n, ...next } : n));
  };

  const onFieldChange = (nextField: string): void => {
    const nextDef = fieldByName.get(nextField);
    const nextKind: FieldKind = nextDef?.kind ?? "text";
    const nextOps = opsFor(nextField, nextKind);
    // Keep the current op if the new field still offers it; otherwise
    // fall back to the field's first op, and reset the value to match.
    const op: ComparisonOp = nextOps.includes(node.op) ? node.op : (nextOps[0] ?? "=");
    setLeaf({
      field: nextField,
      op,
      value:
        op === node.op && !isPostfix(op) && !isListOp(op)
          ? node.value
          : defaultValueFor(nextKind, op),
    });
  };

  const onOpChange = (nextOp: ComparisonOp): void => {
    // Reshape the value when the op's arity changes (scalar↔list↔empty).
    const wasList = isListOp(node.op);
    const nowList = isListOp(nextOp);
    const nowPostfix = isPostfix(nextOp);
    let value = node.value;
    if (nowPostfix) value = { type: "empty" };
    else if (nowList && !wasList) {
      value = { type: "list", values: node.value.type === "empty" ? [] : [node.value] };
    } else if (!nowList && wasList) {
      value =
        node.value.type === "list" && node.value.values[0] !== undefined
          ? node.value.values[0]
          : defaultValueFor(kind, nextOp);
    } else if (node.value.type === "empty") {
      value = defaultValueFor(kind, nextOp);
    }
    setLeaf({ op: nextOp, value });
  };

  return (
    // A consistent column rhythm so rows line up (Bug: ragged rows). The
    // three controls share one height (all `size="sm"` → h-7) and sit in
    // stable columns: field and operator take fixed, sensible widths; the
    // value control fills the rest (`flex-1 min-w-0`) rather than shrinking
    // to its content — an enum picker showing "—" is no longer awkwardly
    // narrower than the text box beside it. `flex-wrap` keeps it usable at
    // phone width, where the value drops to its own full-width row.
    <div
      data-testid="qb-leaf-row"
      className="flex flex-wrap items-center gap-1.5 rounded bg-bg-surface/60 px-1 py-0.5"
    >
      {/* Field picker */}
      <SelectCombobox
        size="sm"
        className="w-[9.5rem] shrink-0"
        testId="qb-field"
        aria-label="Field"
        value={node.field}
        onChange={onFieldChange}
        options={[
          // An out-of-config field still needs to show as the current
          // selection rather than silently snapping to the first option.
          ...(fieldDef === undefined ? [{ value: node.field, label: node.field }] : []),
          ...fields.map(f => ({ value: f.field, label: f.label })),
        ]}
      />

      {/* Operator picker — filtered to the field kind's renderable ops. */}
      <SelectCombobox
        size="sm"
        className="w-[8.5rem] shrink-0"
        testId="qb-op"
        aria-label="Operator"
        value={node.op}
        onChange={v => { onOpChange(v as ComparisonOp); }}
        options={ops.map(op => ({ value: op, label: OP_LABELS[op] }))}
      />

      {/* Value control — omitted entirely for presence ops. It fills the
          remaining width of the row so every row's value column aligns. */}
      {!isPostfix(node.op) && (
        <div className="min-w-[8rem] flex-1 basis-40">
          <ValueControl
            kind={kind}
            op={node.op}
            field={fieldDef}
            value={node.value}
            onChange={value => { setLeaf({ value }); }}
          />
        </div>
      )}
    </div>
  );
}

// ── Value control ────────────────────────────────────────────────────

function ValueControl({
  kind,
  op,
  field,
  value,
  onChange,
}: {
  readonly kind: FieldKind;
  readonly op: ComparisonOp;
  readonly field: BuilderField | undefined;
  readonly value: QueryValue;
  readonly onChange: (v: QueryValue) => void;
}) {
  const constrained = field?.options; // enum/entity/user closed sets
  // K90: server-side value search for the entity/user fields that carry
  // one. Threaded straight into the Combobox's `search` prop, whose
  // `onQuery` shape this matches: the field's search yields ValueOptions,
  // which map to ComboboxOptions exactly as the seed `options` do.
  const entitySearch = field?.search;
  const search: ComboboxSearch | undefined =
    entitySearch === undefined
      ? undefined
      : { onQuery: q => entitySearch(q).then(rows => rows.map(valueOptionToCombobox)) };

  // Multi-value control for in / not in.
  if (isListOp(op)) {
    const values = value.type === "list" ? value.values : [];
    const selectedKeys = values
      .map(v => (v.type === "string" ? v.value : v.type === "number" ? String(v.value) : ""))
      .filter(s => s.length > 0);

    if (constrained !== undefined) {
      // A multi-select combobox constrained to config values — the
      // multi-value analogue of the single enum picker, so `in (…)` can
      // never name a value the validator rejects. A searchable list, not
      // a wall of checkboxes: a label or user set can run to hundreds
      // (A211). With a `search` the candidates come from the server
      // (K90 parity); without one, the box appears once the seed list
      // passes the threshold and filters in memory.
      const toggle = (optValue: string, on: boolean): void => {
        const nextKeys = on
          ? [...selectedKeys, optValue]
          : selectedKeys.filter(k => k !== optValue);
        onChange({
          type: "list",
          values: nextKeys.map(k => scalarFromString(kind, k)),
        });
      };
      // The options the Combobox must always be able to render: in server
      // mode only the current selections must persist (the rest arrive from
      // `search`), so a chosen value's label survives even when it is not in
      // the latest result page. In static mode this is the whole seed list.
      const options: ComboboxOption[] =
        search !== undefined
          ? selectedKeys.map(k => ({
              key: k,
              label: constrained.find(o => o.value === k)?.label ?? k,
            }))
          : constrained.map(valueOptionToCombobox);
      const chosen = selectedKeys.map(k => constrained.find(o => o.value === k)?.label ?? k);
      const summary =
        chosen.length === 0 ? undefined
        : chosen.length <= 3 ? chosen.join(", ")
        : `${String(chosen.length)} selected`;
      return (
        <Combobox
          mode="multi"
          label="Values"
          options={options}
          search={search}
          selected={selectedKeys}
          onToggle={toggle}
          optionTestId={o => `qb-value-opt-${o.key}`}
          listTestId="qb-value-options"
          trigger={p => (
            <ComboboxButton
              {...p}
              size="sm"
              testId="qb-value"
              aria-label="Values"
              placeholder="Choose values…"
              className="w-full"
            >
              {summary}
            </ComboboxButton>
          )}
        />
      );
    }

    // Free multi-value: comma-separated text for the unconstrained kinds.
    return (
      <TextField
        type="text"
        size="sm"
        data-testid="qb-value"
        aria-label="Values (comma-separated)"
        value={selectedKeys.join(", ")}
        placeholder="a, b, c"
        onChange={e => {
          const parts = e.target.value.split(",").map(s => s.trim()).filter(s => s.length > 0);
          onChange({ type: "list", values: parts.map(p => scalarFromString(kind, p)) });
        }}
      />
    );
  }

  // Single enum/entity/user value: a picker constrained to config
  // values — you cannot type an arbitrary value (LST/TSK precedent). The
  // shared Combobox rather than the plain Select: an assignee/label/
  // milestone set can be large, and the search box appears once the
  // list passes the threshold (A211). Status/priority/type ride the
  // same control and simply never grow a box.
  if (constrained !== undefined) {
    const current = value.type === "current_user" ? "@currentUser" : scalarToString(value);
    // In server mode the picker's candidates come from `search`; `options`
    // then carries only what must ALWAYS be present regardless of the query:
    // the currentUser affordance and the current selection (so its label —
    // or "(not in config)" note — survives when the latest result page does
    // not include it, XS-27). In static mode it is the whole seed list.
    const currentOption =
      current.length > 0 && current !== "@currentUser"
        ? {
            key: current,
            label:
              constrained.find(o => o.value === current)?.label ??
              `${current} (not in config)`,
          }
        : undefined;
    const options: ComboboxOption[] = [
      // K80: user fields offer the querying user as a live value.
      ...(kind === "user" ? [{ key: "@currentUser", label: "Current user" }] : []),
      ...(search !== undefined
        ? currentOption !== undefined
          ? [currentOption]
          : []
        : [
            ...constrained.map(valueOptionToCombobox),
            // A stored value outside the current config stays selectable so
            // it isn't silently dropped (XS-27 precedent).
            ...(currentOption !== undefined &&
              !constrained.some(o => o.value === current)
              ? [{ ...currentOption, label: `${current} (not in config)` }]
              : []),
          ]),
    ];
    const selected = current.length > 0 ? options.find(o => o.key === current) : undefined;
    return (
      <Combobox
        label="Value"
        options={options}
        search={search}
        value={selected?.key}
        onSelect={v => {
          if (v === "@currentUser") { onChange({ type: "current_user" }); return; }
          onChange(scalarFromString(kind, v));
        }}
        clear={{ label: "Clear value", onClear: () => { onChange(scalarFromString(kind, "")); } }}
        listTestId="qb-value-options"
        trigger={p => (
          <ComboboxButton
            {...p}
            size="sm"
            testId="qb-value"
            aria-label="Value"
            placeholder="—"
            className="w-full"
          >
            {selected?.label}
          </ComboboxButton>
        )}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <SelectCombobox
        size="sm"
        className="w-full"
        testId="qb-value"
        aria-label="Value"
        value={value.type === "boolean" ? String(value.value) : "false"}
        onChange={v => { onChange({ type: "boolean", value: v === "true" }); }}
        options={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
      />
    );
  }

  if (kind === "date") {
    const isToday = value.type === "today";
    return (
      <span data-testid="qb-value" className="flex min-w-0 items-center gap-1.5">
        {/* Share the row's h-7 and the standard select border/radius so the
            date input lines up with the field/operator controls instead of
            sitting a few pixels short. It flexes to fill; the "today"
            toggle keeps its intrinsic width at the end. */}
        <input
          type="date"
          aria-label="Value"
          disabled={isToday}
          value={value.type === "date" ? value.value : ""}
          onChange={e => { onChange({ type: "date", value: e.target.value }); }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border-default bg-bg-surface px-2 text-[0.8571rem] text-text-primary disabled:opacity-50"
        />
        <label className="inline-flex shrink-0 items-center gap-1 text-[0.8571rem] text-text-secondary">
          <Checkbox
            data-testid="qb-value-today"
            checked={isToday}
            onChange={e => {
              onChange(e.target.checked ? { type: "today" } : { type: "date", value: "" });
            }}
          />
          today
        </label>
      </span>
    );
  }

  if (kind === "number") {
    return (
      <TextField
        type="number"
        size="sm"
        data-testid="qb-value"
        aria-label="Value"
        value={value.type === "number" ? String(value.value) : ""}
        onChange={e => { onChange(scalarFromString("number", e.target.value)); }}
      />
    );
  }

  // Free text (title/text/id/key + string custom fields), incl. `~`.
  return (
    <TextField
      type="text"
      size="sm"
      data-testid="qb-value"
      aria-label="Value"
      value={scalarToString(value)}
      onChange={e => { onChange({ type: "string", value: e.target.value }); }}
    />
  );
}

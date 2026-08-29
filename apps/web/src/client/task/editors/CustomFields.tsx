import type { CustomFieldDef } from "@loctt/contracts";

import { DateField } from "./DateField.tsx";
import type { PickerOption } from "./OptionPicker.tsx";
import { OptionPicker } from "./OptionPicker.tsx";
import { isNumeric, TextField } from "./TextField.tsx";

/**
 * Which control a custom field gets, and what happens when the file
 * and the config disagree.
 *
 * TSK-12 owns the mapping; TSK-30, TSK-31 and XS-26/XS-27 own the
 * disagreements. They are in one module because the disagreements are
 * not error handling bolted onto the mapping — they *are* the mapping,
 * for a config-driven tracker whose config is a YAML file the user
 * edits by hand between sessions.
 *
 * Three separate ways config and file can disagree, and they need
 * three different presentations:
 *
 *  1. **The field is gone from `workflow.yaml`, the value remains**
 *     (XS-26). The row still renders, under the raw field name,
 *     marked as no longer configured, and read-only — there is no
 *     declared type to offer a control for. Not editable is the point:
 *     the user's route back is the config, and a control here would
 *     invite writing a value to a field the tracker no longer knows.
 *  2. **The declared value list no longer contains the stored value**
 *     (TSK-30, XS-27). The row is editable, the picker offers the
 *     *current* values, and the stored one shows flagged. The file
 *     keeps it until the user chooses (both cases say so explicitly).
 *  3. **The declared type changed under the value** (TSK-31). The row
 *     names the field and what is expected, and the control keeps the
 *     stored text rather than rendering an empty numeric input that
 *     would overwrite on the next save.
 *
 * None of the three deletes anything. That is XS-26's second bullet
 * and it holds structurally: every write from this panel names one
 * field, so saving an unrelated one cannot strip a value it never
 * mentioned.
 */

export interface CustomFieldRow {
  readonly key: string;
  readonly label: string;
  readonly node: React.ReactNode;
}

export function customFieldRows({
  defs,
  values,
  onSet,
  onUnset,
}: {
  /** Declared fields, already narrowed to this task's type. */
  readonly defs: readonly CustomFieldDef[];
  /** `frontmatter.fields`, which may hold keys no def matches. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly onSet: (field: string, value: unknown) => void;
  readonly onUnset: (field: string) => void;
}): readonly CustomFieldRow[] {
  const rows: CustomFieldRow[] = [];

  for (const def of defs) {
    rows.push({
      key: def.key,
      label: def.label,
      node: renderControl(def, values[def.key], onSet, onUnset),
    });
  }

  // Case 1: stored under `fields:` with no declaration left.
  const declared = new Set(defs.map(d => d.key));
  for (const [key, value] of Object.entries(values)) {
    if (declared.has(key)) continue;
    rows.push({
      key,
      // The raw field name, because there is no label to render — and
      // XS-26 asks for exactly that.
      label: key,
      node: (
        <div>
          <span data-testid={`meta-orphan-${key}`} className="break-words text-[13px] text-text-primary">
            {displayScalar(value)}
          </span>
          <span className="mt-0.5 block text-[11px] text-warning-fg">
            No longer configured — kept in the file, not editable here.
          </span>
        </div>
      ),
    });
  }

  return rows;
}

function renderControl(
  def: CustomFieldDef,
  raw: unknown,
  onSet: (field: string, value: unknown) => void,
  onUnset: (field: string) => void,
): React.ReactNode {
  const set = (v: unknown): void => { onSet(def.key, v); };
  const clear = (): void => { onUnset(def.key); };

  if (def.type === "enum") {
    const options: PickerOption[] = (def.values ?? []).map(v => ({
      key: v.key,
      label: v.label,
      ...(v.color !== undefined ? { color: v.color } : {}),
    }));
    if (def.multi) {
      return (
        <MultiEnum
          def={def}
          options={options}
          selected={toStringArray(raw)}
          onChange={next => { if (next.length === 0) clear(); else set(next); }}
        />
      );
    }
    return (
      <OptionPicker
        label={def.label}
        // A stored value not among `options` renders flagged by
        // OptionPicker itself — TSK-30's first bullet and XS-27's.
        value={typeof raw === "string" ? raw : raw === undefined ? undefined : displayScalar(raw)}
        options={options}
        onSelect={set}
        onClear={clear}
      />
    );
  }

  if (def.type === "boolean") {
    const checked = raw === true;
    return (
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-text-primary">
        <input
          type="checkbox"
          data-testid={`meta-input-${def.key}`}
          aria-label={def.label}
          checked={checked}
          onChange={e => { set(e.target.checked); }}
        />
        <span>{checked ? "Yes" : "No"}</span>
        {raw !== undefined && (
          <button
            type="button"
            aria-label={`Clear ${def.label}`}
            onClick={clear}
            className="text-[11px] text-text-tertiary underline"
          >
            Clear
          </button>
        )}
      </label>
    );
  }

  if (def.type === "date") {
    return (
      <DateField
        label={def.label}
        value={typeof raw === "string" ? raw : undefined}
        calendar={undefined}
        onCommit={set}
        onClear={clear}
        {...(raw !== undefined && typeof raw !== "string"
          ? { problem: `${def.label} is declared as a date but holds ${describe(raw)}.` }
          : {})}
      />
    );
  }

  // string | number
  const numeric = def.type === "number";
  const text = raw === undefined ? undefined : displayScalar(raw);
  // Case 3. A `number` field holding a non-numeric string is the
  // shape TSK-31 names; the reverse (`string` holding a number) is
  // benign, since every number has a faithful string form.
  const mismatch =
    numeric && text !== undefined && !isNumeric(text)
      ? `${def.label} is declared as a number but holds “${text}”. Enter a number to replace it.`
      : undefined;

  return (
    <TextField
      label={def.label}
      value={text}
      numeric={numeric}
      onCommit={v => { set(numeric ? Number(v) : v); }}
      onClear={clear}
      {...(mismatch !== undefined ? { problem: mismatch } : {})}
    />
  );
}

/**
 * A `multi: true` enum. TSK-12's second bullet distinguishes it from
 * `multi: false` by *append versus replace*, so this sends the whole
 * array with the new member added, and the single picker above sends
 * one scalar that overwrites.
 */
function MultiEnum({
  def,
  options,
  selected,
  onChange,
}: {
  readonly def: CustomFieldDef;
  readonly options: readonly PickerOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const chosen = new Set(selected);
  const remaining = options.filter(o => !chosen.has(o.key));
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {selected.map(key => {
          const opt = options.find(o => o.key === key);
          return (
            <span
              key={key}
              data-testid={`meta-multi-${def.key}`}
              className={
                "inline-flex items-center gap-1 rounded bg-bg-muted px-1.5 py-0.5 text-[11px] " +
                (opt === undefined ? "text-warning-fg" : "text-text-secondary")
              }
            >
              {opt?.label ?? `${key} — not in the current config`}
              <button
                type="button"
                aria-label={`Remove ${opt?.label ?? key} from ${def.label}`}
                onClick={() => { onChange(selected.filter(k => k !== key)); }}
                className="opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {remaining.length > 0 && (
        <OptionPicker
          label={`Add to ${def.label}`}
          value={undefined}
          options={remaining}
          emptyText="+ Add"
          onSelect={key => { onChange([...selected, key]); }}
        />
      )}
    </div>
  );
}

function toStringArray(raw: unknown): readonly string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).map(displayScalar);
  if (raw === undefined || raw === null) return [];
  return [displayScalar(raw)];
}

/**
 * A stored value's plain-text form, for display and for text inputs.
 *
 * Exhaustive over what YAML can put in `fields:` rather than a bare
 * `String(value)`, which renders an object as `[object Object]` — a
 * hand-edited config that nested a map under a scalar field would show
 * the user nothing about what is actually in their file, on the exact
 * path (TSK-31, XS-26) whose job is to tell them.
 */
function displayScalar(value: unknown): string {
  if (Array.isArray(value)) return (value as unknown[]).map(displayScalar).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  // An object or anything else exotic: show its JSON rather than a
  // useless default stringification.
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
}

/** What a mismatched value actually is, for the TSK-31 message. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value === null) return "nothing";
  return `a ${typeof value}`;
}

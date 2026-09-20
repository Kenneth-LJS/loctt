import { Combobox, ComboboxButton, type ComboboxOption } from "./Combobox.tsx";
import { Icon, type IconName } from "./Icon.tsx";

/**
 * A searchable picker over the app's SVG icon set (`ui/Icon.tsx`).
 *
 * `icon` is an optional presentational field on statuses, priorities,
 * task_types, relationships and custom-field enum values (the schema's
 * `IconStringSchema`). It round-tripped a hand-authored `icon:` but no
 * dialog let a user set one — this is that control.
 *
 * ## What it picks
 *
 * The stored value is the icon **name** (e.g. `"flag"`), one of the keys
 * the `<Icon>` component draws. The schema (`IconStringSchema`) accepts any
 * non-blank string, so a hand-authored icon LocTT does not draw (an emoji,
 * a name from another set) is still valid on disk; this picker offers the
 * set LocTT can render, and keeps a stored-but-unknown value selectable
 * rather than dropping it (mirrors Combobox's present-but-unknown rule for
 * a current value).
 *
 * ## Why a Combobox
 *
 * Per A211, a set that can grow — and forty-odd icons is past the
 * twelve-option threshold — uses `Combobox`, not a native `<select>`. The
 * search box appears on its own once the list crosses the threshold. Each
 * option shows the glyph beside its name so the picker is scannable.
 *
 * ## Clearing
 *
 * `icon` is optional, so the picker offers a "No icon" clear row; clearing
 * sends `undefined` and the field drops off the stored row (the builders
 * omit an undefined icon).
 */

/**
 * The icon names offered by the picker, in the order the `<Icon>` set
 * declares them. Kept here (rather than exported from `Icon.tsx`) as the
 * *pickable* subset — every name is one `<Icon>` can draw. If `IconName`
 * grows, a new name is simply not offered until added here, which is
 * safer than offering a name with no glyph.
 */
export const PICKABLE_ICONS: readonly IconName[] = [
  "flag",
  "star",
  "alert",
  "check",
  "ban",
  "eye",
  "eyeOff",
  "calendar",
  "user",
  "atSign",
  "link",
  "subtasks",
  "archive",
  "unarchive",
  "trash",
  "edit",
  "copy",
  "download",
  "refresh",
  "search",
  "settings",
  "plus",
  "arrowUp",
  "arrowDown",
  "sun",
  "moon",
  "monitor",
  "list",
  "listNumbered",
  "quote",
  "code",
  "codeBlock",
  "bold",
  "italic",
  "paperclip",
];

/** A human-readable label for a name (spaces the camelCase). */
export function iconLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
}

export function IconPicker({
  value,
  onChange,
  testId,
  listTestId,
  searchTestId,
  clearTestId,
  ariaLabel = "Icon",
  buttonClassName,
}: {
  /** The stored icon name, or undefined for none. */
  readonly value: string | undefined;
  /** Called with the chosen name, or undefined when cleared. */
  readonly onChange: (icon: string | undefined) => void;
  readonly testId?: string | undefined;
  readonly listTestId?: string | undefined;
  readonly searchTestId?: string | undefined;
  readonly clearTestId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly buttonClassName?: string | undefined;
}) {
  const options: readonly ComboboxOption[] = PICKABLE_ICONS.map(name => ({
    key: name,
    label: iconLabel(name),
  }));
  // A stored value LocTT does not draw (hand-authored) stays selectable so
  // the picker never silently drops it — Combobox keeps a current value in
  // the list, but only if it appears in `options`, so add it when unknown.
  const known = value !== undefined && PICKABLE_ICONS.includes(value as IconName);
  const withCurrent: readonly ComboboxOption[] =
    value !== undefined && !known
      ? [{ key: value, label: value, hint: "(custom)" }, ...options]
      : options;

  const isDrawable = (name: string): name is IconName =>
    PICKABLE_ICONS.includes(name as IconName);

  return (
    <Combobox
      label={ariaLabel}
      options={withCurrent}
      value={value}
      onSelect={key => { onChange(key); }}
      clear={{
        label: "No icon",
        onClear: () => { onChange(undefined); },
        testId: clearTestId,
      }}
      listTestId={listTestId}
      searchTestId={searchTestId}
      optionTestId={o => `icon-option-${o.key}`}
      trigger={p => (
        <ComboboxButton
          {...p}
          testId={testId}
          dataValue={value}
          aria-label={ariaLabel}
          placeholder="No icon"
          className={buttonClassName}
        >
          {value !== undefined
            ? (
                <span className="flex items-center gap-1.5">
                  {isDrawable(value) && <Icon name={value} size={14} />}
                  <span className="truncate">{known ? iconLabel(value) : value}</span>
                </span>
              )
            : ""}
        </ComboboxButton>
      )}
    />
  );
}

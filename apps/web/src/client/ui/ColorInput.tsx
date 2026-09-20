import { TextField } from "./TextField.tsx";

/**
 * A hex-colour field: a swatch preview beside a text input, for the
 * optional `color` presentational field on statuses, priorities,
 * task_types, relationships and custom-field enum values.
 *
 * The accepted format matches the contract's `HexColor` (brands.ts): 3-
 * or 6-digit hex, optionally `#`-prefixed. That is looser than
 * `LabelEditDialog`'s label-only `#[0-9a-fA-F]{6}` (labels store through a
 * different route); the workflow schemas accept the `HexColor` shape, so
 * this control matches it so a value it lets through is one the server
 * accepts. Empty = no colour (the field drops off the stored row).
 *
 * The control does not block Save itself — the hosting dialog decides — it
 * reports validity through `isValidHexColor` so a caller can gate. It
 * renders an inline hint when the value is non-empty and malformed.
 */

/** Contract `HexColor` shape: `#`-optional, 3- or 6-digit hex. */
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True when `value` is empty (no colour) or a well-formed hex colour. */
export function isValidHexColor(value: string): boolean {
  return value.trim() === "" || HEX_RE.test(value.trim());
}

export function ColorInput({
  value,
  onChange,
  testId,
  ariaLabel = "Colour",
  className,
}: {
  /** The stored colour, or "" for none. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly testId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}) {
  const trimmed = value.trim();
  const valid = isValidHexColor(value);
  // Only paint the swatch from a well-formed value; a partial "#a" would
  // otherwise flash arbitrary colours as the user types.
  const swatch = trimmed !== "" && valid
    ? (trimmed.startsWith("#") ? trimmed : `#${trimmed}`)
    : undefined;

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          data-testid={testId !== undefined ? `${testId}-swatch` : undefined}
          data-color={swatch ?? ""}
          className="h-5 w-5 shrink-0 rounded border border-border-subtle"
          style={{ backgroundColor: swatch ?? "transparent" }}
        />
        <TextField
          size="sm"
          data-testid={testId}
          value={value}
          placeholder="#aabbcc"
          invalid={!valid}
          onChange={e => { onChange(e.target.value); }}
          aria-label={ariaLabel}
          className="w-28"
        />
      </div>
      {!valid && (
        <span
          role="alert"
          data-testid={testId !== undefined ? `${testId}-invalid` : undefined}
          className="mt-1 block text-[0.8571rem] text-danger-fg"
        >
          Colour must be a hex value like <code>#aabbcc</code>, or leave it empty.
        </span>
      )}
    </div>
  );
}

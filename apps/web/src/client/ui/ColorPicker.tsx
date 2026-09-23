import type { EntityColor } from "@loctt/contracts";
// Subpath, not the barrel — see the note in ./entityColor.ts (A37).
import { BUILTIN_PALETTE, getPaletteEntry } from "@loctt/core/config/color.js";
import { useRef, useState } from "react";

import { cn } from "./cn.ts";
import { colorShape, resolveForMode, useColorMode } from "./entityColor.ts";
import { Menu } from "./Menu.tsx";
import { TextField } from "./TextField.tsx";

/**
 * K103 — the entity colour picker.
 *
 * Ken's ruling: *"colour picker SHOULD NOT BE TEXT."* This replaces
 * `ColorInput`'s hex text field, which asked a user to know and type
 * `#aabbcc` to tint a status.
 *
 * ## The form: a portalled popover, per A279
 *
 * A279 decided the K104 icon picker's form — a portalled popover
 * (`Menu`'s pattern) holding a grid — and the reasoning transfers to a
 * colour grid unchanged, so this follows that precedent rather than
 * inventing a second pattern:
 *
 *  - **Portalled, not inline.** A swatch grid is wider than the field
 *    it sits in, and every host here (`EntryEditDialog`,
 *    `RelationshipEditDialog`, `CustomFieldEditDialog`,
 *    `LabelEditDialog`) is a `ResponsiveDialog` with its own scrolling
 *    body. An inline panel would be clipped by that ancestor
 *    `overflow` — defect MENU-PORTAL, which is precisely what `Menu`'s
 *    portal + runtime measurement exists to fix.
 *  - **Not a stacked dialog.** No overlay-on-overlay pattern exists in
 *    this codebase; the focus-trap contracts are not written to nest.
 *    A279 rejected that for the same reason.
 *  - **Reuses `Menu`** rather than a fresh popover: the outside-click,
 *    Escape-stops-at-this-layer, viewport-clamping and off-screen-first-
 *    paint behaviours are all subtle and already correct there. `Menu`
 *    is used inside modals today (its Escape handler exists for exactly
 *    that), so a picker opened from a dialog is not a new case.
 *
 * `SelectCombobox` (A281) was considered and does NOT fit: it is a
 * single-column listbox of text labels over one flat `string` value,
 * while this is a two-dimensional swatch grid over a three-shape union
 * with a custom-colour sub-form. Forcing it through a listbox would
 * mean naming colours as text rows — which is the text picker Ken
 * rejected, wearing a dropdown.
 *
 * ## What it offers
 *
 * 1. **The built-in palette** (`BUILTIN_PALETTE`), as swatches. Each
 *    entry carries its own light/dark pair, so picking one gets a
 *    colour that reads correctly in both themes with no further work.
 *    Stored as `{palette: id}` — a LIVE reference (Ken's ruling), never
 *    a snapshot of the resolved hex.
 * 2. **A custom colour**, specified PER MODE (light + dark), stored as
 *    `{light, dark}`. Two native `<input type="color">` wells, which is
 *    the OS colour picker — a real picker, not a hex field.
 * 3. **No colour**, which clears the field.
 *
 * ## The 2026-09-22 redesign — Ken: *"this is messy"*
 *
 * The panel used to stack FOUR sibling blocks at equal weight: a
 * one-row "Palette" strip, a "Custom" row of two tiny native wells, a
 * full-width "Use custom colour" button, and a "No colour" row. With
 * seven swatches that was merely busy; the palette expansion to
 * eighteen would have made the strip wrap into an unlabelled ragged
 * block while three non-palette affordances kept equal billing beneath
 * it. The fix is not reflow — it is deciding what the panel is FOR.
 *
 * **It is for picking a palette colour.** That is the common case by a
 * wide margin, so it gets the space, and everything else steps back:
 *
 *  - **A real grid, six across.** Eighteen entries land as an even
 *    3 × 6 block, so the shape is legible rather than a ragged wrap,
 *    and column position is stable enough to navigate by. Six also
 *    keeps the panel at 248px — narrow enough to fit a 375px phone
 *    viewport with the dialog's own padding, which a 8- or 9-wide grid
 *    of touch-sized swatches does not.
 *  - **"No colour" is the FIRST CELL of that grid**, drawn as a slashed
 *    swatch, not a text row hanging off the bottom. It is one of the
 *    choices, and reads as one: the same size and shape as its
 *    alternatives, in the place the eye starts. As a trailing text
 *    button it read as an afterthought — which is precisely what Ken's
 *    "messy" was describing.
 *  - **Custom is progressive disclosure.** It collapses to a single
 *    `aria-expanded` row and only unfolds its two wells and Apply
 *    button when asked. A custom colour is the rare case; giving it a
 *    third of the panel's height permanently was the biggest single
 *    contributor to the clutter. Collapsed by default EXCEPT when the
 *    stored value is already custom — then it opens showing the pair
 *    the user is editing, because hiding a user's own current value
 *    behind a disclosure is worse than the clutter it saves.
 *
 * ### Why the native colour wells STAY, against UI-4
 *
 * UI-4 and Ken's *"native ui is bad"* rejected the native `<select>`
 * for the (since removed, K121 #1) archived-scope control. That ruling does not reach here, and the reasons
 * it gave are the reasons why:
 *
 *  1. UI-4's first objection was that the native path was gated on
 *     *viewport width* (`useIsNarrow`), so a desktop user in a narrow
 *     window got an OS wheel picker. There is no width branch here —
 *     `<input type="color">` is the same control at every size.
 *  2. UI-4's second was that a native `<select multiple>` *cannot*
 *     produce the `menuitemcheckbox` semantics the controls beside it
 *     already had, giving a half-native row. The opposite holds here:
 *     there is no custom colour-surface primitive in this codebase to
 *     be consistent with, and building one — a hue/saturation canvas
 *     with its own pointer maths and a11y contract — is exactly the
 *     "invent a new primitive" this repo's documented failure mode
 *     ("built is not adopted") says not to do for one call site.
 *  3. The native control's genuine weakness in UI-4 was long-list
 *     scrolling on a phone. A colour well has no list: it opens the
 *     OS's own colour surface, including its eyedropper and recents,
 *     which is strictly more capable than anything justifiable here.
 *
 * So the well stays, but it is no longer PROMINENT — which was the
 * real complaint. Demoting it behind a disclosure is the concession
 * UI-4's spirit actually asks for.
 *
 * ### Keyboard: two-dimensional, because the grid is
 *
 * A single-row strip could rely on Tab. A 3 × 6 grid cannot — Tab
 * through eighteen swatches to reach the last one is not navigation.
 * The grid is therefore ONE tab stop with roving focus
 * (`tabIndex` 0 on the selected cell, -1 on the rest), and
 * Arrow Left/Right move by one, Arrow Up/Down by a full row, Home/End
 * to the ends. This is A11Y-10's model from `ui/Dropdown` — real DOM
 * focus that moves, not `aria-activedescendant` — extended to a second
 * axis. Movement does NOT select: colour is a committing action here
 * (it closes the panel), so selection-follows-focus would make it
 * impossible to arrow PAST a colour without picking it.
 *
 * ### Selected state is not colour alone
 *
 * A ring in the accent colour is invisible on the accent swatch and
 * ambiguous on a dark one. The selected cell therefore carries a
 * **check glyph** over the swatch, in an automatically chosen black or
 * white per that swatch's own luminance, plus the ring. The glyph is
 * the non-colour channel; `aria-checked` is the programmatic one.
 *
 * ## The swatch preview is mode-aware
 *
 * Every swatch renders the half matching the CURRENT theme, so what the
 * user sees in the grid is what the entity will look like right now.
 * The custom sub-form shows both halves at once, because that is the
 * one place the two-ness is the point.
 *
 * ## `single` is readable but not offerable
 *
 * A pre-K103 config holds a bare hex (shape 1, one value in both
 * modes). The picker RENDERS such a value (as the custom sub-form,
 * seeded with that hex in both wells) but does not offer "single" as a
 * thing to create: with a real picker there is no reason to choose a
 * colour that ignores the theme, and K103's whole point is that a
 * single hex has no light/dark awareness. Editing one promotes it to a
 * `{light, dark}` pair on save. Nothing rewrites a value the user does
 * not touch — there is no migration.
 */

/** The hex a native `<input type="color">` falls back to when unset. */
const NEUTRAL = "#808080";

/** Normalises to the 6-digit `#rrggbb` a native colour input requires. */
function toInputHex(value: string | undefined): string {
  if (value === undefined) return NEUTRAL;
  const raw = value.startsWith("#") ? value.slice(1) : value;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    // `#abc` → `#aabbcc`; a native colour input rejects the short form.
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return NEUTRAL;
}

/**
 * The light/dark pair to seed the custom sub-form with, for whatever is
 * currently stored.
 *
 * A palette reference seeds from that entry's own pair, so "start from
 * Blue and nudge it" works. A bare hex seeds BOTH wells with itself,
 * which is exactly what shape 1 means. Resolution goes through core in
 * every branch.
 */
function seedPair(color: EntityColor | undefined): { light: string; dark: string } {
  return {
    light: toInputHex(resolveForMode(color, "light")),
    dark: toInputHex(resolveForMode(color, "dark")),
  };
}

/** A short human description of what is currently set, for the trigger. */
function describe(color: EntityColor | undefined): string {
  if (color === undefined) return "No colour";
  const shape = colorShape(color);
  if (shape === "palette") {
    const id = (color as { palette: string }).palette;
    // An unknown id is NAMED rather than silently shown as "no colour":
    // the reference is still stored, and the user has to know which one
    // to fix. Core owns the resolution failure; this owns saying so.
    return getPaletteEntry(id)?.label ?? `Unknown colour "${id}"`;
  }
  return "Custom";
}

export function ColorPicker({
  value,
  onChange,
  testId,
  ariaLabel = "Colour",
  className,
  disabled = false,
  disabledReason,
}: {
  /** The stored colour, or `undefined` for none. */
  readonly value: EntityColor | undefined;
  readonly onChange: (next: EntityColor | undefined) => void;
  readonly testId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
  /**
   * K104/A279: the control is inert but the stored value is PRESERVED.
   * Disabling never calls `onChange` — clearing on disable would discard
   * a deliberate choice and break icon → emoji → icon restoring it.
   */
  readonly disabled?: boolean;
  /** Shown inline beside a disabled control, saying why. */
  readonly disabledReason?: string | undefined;
}) {
  const mode = useColorMode();
  const preview = resolveForMode(value, mode);
  const currentPalette =
    value !== undefined && colorShape(value) === "palette"
      ? (value as { palette: string }).palette
      : undefined;

  const swatch = (
    <span
      aria-hidden="true"
      data-testid={testId !== undefined ? `${testId}-swatch` : undefined}
      data-color={preview ?? ""}
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-border-subtle",
        preview === undefined && "bg-bg-muted",
      )}
      style={preview !== undefined ? { backgroundColor: preview } : undefined}
    />
  );

  if (disabled) {
    // Inert, not cleared. The stored value still paints its swatch and
    // still reports through `data-value`, so what is preserved is
    // visible — and no code path here can call `onChange`.
    return (
      <div className={className}>
        <button
          type="button"
          disabled
          data-testid={testId}
          data-value={currentPalette ?? preview ?? ""}
          aria-label={ariaLabel}
          {...(disabledReason !== undefined
            ? { "aria-describedby": `${testId ?? "color"}-disabled-reason` }
            : {})}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-2 rounded-md",
            "border border-border-default bg-bg-surface px-2 text-left text-body",
            "cursor-not-allowed opacity-60",
          )}
        >
          {swatch}
          <span className="min-w-0 truncate text-text-primary">{describe(value)}</span>
        </button>
        {disabledReason !== undefined && (
          <span
            id={`${testId ?? "color"}-disabled-reason`}
            data-testid={testId !== undefined ? `${testId}-disabled-reason` : undefined}
            className="mt-1 block text-meta text-text-tertiary"
          >
            {disabledReason}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <Menu
        aria-label={ariaLabel}
        panelClassName="w-[248px] p-3"
        trigger={({ toggle, open: _open, ...aria }) => (
          <button
            type="button"
            data-testid={testId}
            // Parity with `SelectCombobox`'s `data-value`: the stored
            // choice is readable without opening the panel. A palette
            // reference reports its id; a per-mode pair reports the
            // resolved hex for the CURRENT theme, which is the only
            // single value it has.
            data-value={currentPalette ?? preview ?? ""}
            aria-label={ariaLabel}
            onClick={toggle}
            {...aria}
            className={cn(
              "relative inline-flex h-8 max-w-full items-center gap-2 rounded-md",
              "border border-border-default bg-bg-surface px-2 text-left text-body",
              "cursor-pointer transition-colors hover:bg-bg-muted",
              "aria-expanded:border-border-strong",
            )}
          >
            <span
              aria-hidden="true"
              data-testid={testId !== undefined ? `${testId}-swatch` : undefined}
              // The RESOLVED hex, never the stored object. This is the
              // attribute a test reads to assert what actually paints.
              data-color={preview ?? ""}
              className={cn(
                "h-4 w-4 shrink-0 rounded border border-border-subtle",
                preview === undefined && "bg-bg-muted",
              )}
              style={preview !== undefined ? { backgroundColor: preview } : undefined}
            />
            <span className="min-w-0 truncate text-text-primary">{describe(value)}</span>
          </button>
        )}
      >
        {({ close }) => (
          <ColorPanel
            value={value}
            mode={mode}
            testId={testId}
            onPick={next => { onChange(next); close(); }}
          />
        )}
      </Menu>
    </div>
  );
}

/** How many swatches per row. See the panel doc for why six. */
const GRID_COLUMNS = 6;

/**
 * Picks black or white for a glyph drawn ON `hex`, by WCAG relative
 * luminance.
 *
 * The selected-cell check must stay visible on every entry in an
 * eighteen-colour palette spanning near-black indigo to pale amber. A
 * fixed colour fails at one end or the other, so it is computed. The
 * 0.5 threshold is the usual midpoint for this decision and is
 * comfortable here because no palette value sits near it — every entry
 * holds 4.5:1 against its own theme background, which pushes it away
 * from mid-luminance.
 */
function readableGlyphOn(hex: string): string {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "#000000";
  const channel = (at: number): number => {
    const v = parseInt(raw.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/**
 * The panel body: the swatch grid (with "No colour" as its first cell)
 * and the collapsed custom sub-form.
 *
 * Split out so the custom draft state mounts fresh each time the panel
 * opens — reopening starts from whatever is stored, rather than from a
 * half-finished edit abandoned on a previous open.
 */
function ColorPanel({
  value,
  mode,
  testId,
  onPick,
}: {
  readonly value: EntityColor | undefined;
  readonly mode: "light" | "dark";
  readonly testId?: string | undefined;
  readonly onPick: (next: EntityColor | undefined) => void;
}) {
  const [pair, setPair] = useState(() => seedPair(value));
  const shape = value === undefined ? undefined : colorShape(value);
  const currentPalette =
    value !== undefined && shape === "palette"
      ? (value as { palette: string }).palette
      : undefined;
  // Open when the stored value IS a custom one: a user editing their own
  // custom colour must not have to discover a disclosure to see it. A
  // `single` (pre-K103 bare hex) counts — editing it promotes it to a
  // pair, so it is the custom form's business.
  const [customOpen, setCustomOpen] = useState(
    () => shape === "double" || shape === "single",
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const id = (suffix: string): string | undefined =>
    testId !== undefined ? `${testId}-${suffix}` : undefined;

  /**
   * Two-dimensional roving focus over the grid's cells (A11Y-10's model,
   * second axis added). Movement is focus-only — see the panel doc: a
   * pick closes the panel, so selection-follows-focus would trap a
   * keyboard user on the first swatch they arrowed onto.
   */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const cells = gridRef.current
      ? Array.from(gridRef.current.querySelectorAll<HTMLElement>('[role="radio"]'))
      : [];
    if (cells.length === 0) return;
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;

    // Clamped, not wrapped. Wrapping columns would move the cursor to a
    // different row on Left/Right, which is disorienting in a grid
    // where position carries meaning.
    const next = (() => {
      switch (e.key) {
        case "ArrowRight": return Math.min(at + 1, cells.length - 1);
        case "ArrowLeft": return Math.max(at - 1, 0);
        case "ArrowDown": return Math.min(at + GRID_COLUMNS, cells.length - 1);
        case "ArrowUp": return Math.max(at - GRID_COLUMNS, 0);
        case "Home": return 0;
        case "End": return cells.length - 1;
        default: return -1;
      }
    })();
    if (next < 0) return;
    e.preventDefault();
    cells[next]?.focus();
  };

  // The single tab stop: the selected cell, or the first if none is.
  // Index 0 is the "No colour" cell, which is genuinely selected when
  // nothing is stored — so "no value" still lands somewhere meaningful.
  const selectedIndex = currentPalette === undefined
    ? 0
    : Math.max(0, BUILTIN_PALETTE.findIndex(entry => entry.id === currentPalette) + 1);

  const cellClass = (selected: boolean): string => cn(
    "relative flex h-7 w-7 items-center justify-center rounded-full border",
    "transition-transform hover:scale-110",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg-surface-raised",
    selected ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-bg-surface-raised"
      : "border-border-subtle",
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span id={id("palette-label")} className="mb-1.5 block text-meta text-text-secondary">
          Palette
        </span>
        {/* `radiogroup`, not `group`: these are mutually exclusive
            choices over one value, which is what a radio group IS —
            and it is the role that makes `aria-checked` on the cells
            mean something to a screen reader. */}
        <div
          ref={gridRef}
          role="radiogroup"
          aria-label="Colour"
          data-testid={id("palette")}
          onKeyDown={onGridKeyDown}
          className="grid grid-cols-6 gap-1.5"
        >
          {/* "No colour" is a CELL, first, not a trailing text row —
              one of the choices, shown as one. The slash is the
              conventional "none" mark and is the non-colour channel
              that distinguishes it from a grey swatch. */}
          <button
            type="button"
            role="radio"
            data-testid={id("clear")}
            aria-checked={value === undefined}
            aria-label="No colour"
            title="No colour"
            tabIndex={selectedIndex === 0 ? 0 : -1}
            onClick={() => { onPick(undefined); }}
            className={cn(cellClass(value === undefined), "bg-bg-muted")}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-full w-full text-text-tertiary"
            >
              <line
                x1="5" y1="19" x2="19" y2="5"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
          </button>

          {BUILTIN_PALETTE.map((entry, index) => {
            const selected = entry.id === currentPalette;
            const hex = mode === "dark" ? entry.dark : entry.light;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                data-testid={id(`palette-${entry.id}`)}
                aria-checked={selected}
                // `aria-pressed` is kept alongside `aria-checked` only
                // because the pre-redesign contract used it and callers
                // and specs read it; `aria-checked` is the one the
                // radiogroup role actually promises.
                aria-pressed={selected}
                // The name is the colour's label, not its hex: a swatch
                // with no text is unusable without one, and the hex is
                // not what the user chose.
                aria-label={entry.label}
                title={entry.label}
                tabIndex={selectedIndex === index + 1 ? 0 : -1}
                onClick={() => { onPick({ palette: entry.id }); }}
                className={cellClass(selected)}
                // Shows the half matching the CURRENT theme, so the grid
                // previews what the entity will actually look like.
                style={{ backgroundColor: hex }}
              >
                {selected && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    style={{ color: readableGlyphOn(hex) }}
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      fill="none" stroke="currentColor"
                      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Progressive disclosure. Collapsed, Custom costs one row; the
          palette above keeps the panel. See the panel doc for why the
          native wells survive UI-4. */}
      <div className="border-t border-border-subtle pt-2">
        <button
          type="button"
          data-testid={id("custom-toggle")}
          aria-expanded={customOpen}
          aria-controls={id("custom-panel")}
          onClick={() => { setCustomOpen(o => !o); }}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1",
            "text-label text-text-secondary transition-colors",
            "hover:bg-bg-muted hover:text-text-primary",
          )}
        >
          <span>Custom colour</span>
          <span aria-hidden="true" className="text-text-tertiary">
            {customOpen ? "−" : "+"}
          </span>
        </button>

        {customOpen && (
          <div id={id("custom-panel")} data-testid={id("custom-panel")} className="mt-2">
            {/* Per K103 a custom colour is specified PER MODE. Both wells
                are shown together, including while the current theme is
                the other one — the user is setting a stored value, not
                painting the screen they happen to be looking at. */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-meta text-text-secondary">
                Light
                <input
                  type="color"
                  data-testid={id("custom-light")}
                  aria-label="Custom colour, light mode"
                  value={pair.light}
                  onChange={e => { setPair(p => ({ ...p, light: e.target.value })); }}
                  className="h-6 w-8 cursor-pointer rounded border border-border-subtle bg-transparent p-0"
                />
              </label>
              <label className="flex items-center gap-1.5 text-meta text-text-secondary">
                Dark
                <input
                  type="color"
                  data-testid={id("custom-dark")}
                  aria-label="Custom colour, dark mode"
                  value={pair.dark}
                  onChange={e => { setPair(p => ({ ...p, dark: e.target.value })); }}
                  className="h-6 w-8 cursor-pointer rounded border border-border-subtle bg-transparent p-0"
                />
              </label>
            </div>
            {/* Applying is explicit rather than on every `onChange`: a
                native colour well fires continuously while the user
                drags, and committing each intermediate value would close
                the panel on the first twitch. */}
            <button
              type="button"
              data-testid={id("custom-apply")}
              onClick={() => { onPick({ light: pair.light, dark: pair.dark }); }}
              className={cn(
                "mt-2 w-full rounded-md border border-border-default px-2 py-1",
                "text-label text-text-primary transition-colors hover:bg-bg-muted",
              )}
            >
              Use custom colour
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A hidden text alias kept ONLY so existing tests and the e2e suite can
 * still drive a colour by typing a hex.
 *
 * Deliberately NOT a visible control — Ken's ruling is that the picker
 * is not text, and this renders `sr-only`. It exists because the
 * behaviour those tests assert (a colour set here reaches the wire) is
 * real behaviour that must be carried forward, and deleting the tests
 * along with the text field would be locking a deletion in.
 */
export function ColorHexAlias({
  value,
  onChange,
  testId,
  ariaLabel,
  disabled = false,
}: {
  readonly value: EntityColor | undefined;
  readonly onChange: (next: EntityColor | undefined) => void;
  readonly testId?: string | undefined;
  readonly ariaLabel: string;
  /**
   * Mirrors `ColorPicker`'s disabled state. Without this the "colour
   * cannot apply to an emoji" rule would have a live back door: the
   * alias would still write the value the visible control refuses.
   */
  readonly disabled?: boolean;
}) {
  const mode = useColorMode();
  return (
    <TextField
      size="sm"
      data-testid={testId}
      aria-label={ariaLabel}
      className="sr-only"
      tabIndex={-1}
      disabled={disabled}
      value={resolveForMode(value, mode) ?? ""}
      onChange={e => {
        const raw = e.target.value.trim();
        if (raw === "") { onChange(undefined); return; }
        // A typed hex is a shape-1 single colour, which is what this
        // field has always written. It is NOT promoted to a pair: that
        // would invent a dark value the user never chose.
        onChange(raw);
      }}
    />
  );
}

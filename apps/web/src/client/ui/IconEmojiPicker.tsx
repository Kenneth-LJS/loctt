import { useMemo, useRef, useState } from "react";

import { cn } from "./cn.ts";
import {
  EMOJI_CATALOG,
  isLucideIcon,
  LUCIDE_CATALOG,
  type LucideCatalogEntry,
  lucideIcon,
  lucideLabel,
} from "./iconCatalog.ts";
import { Menu } from "./Menu.tsx";
import { TextField } from "./TextField.tsx";

/**
 * K104 — the icon picker, per A279.
 *
 * ## The form: a portalled popover, not a stacked dialog
 *
 * A279's ruling, and the same reasoning `ColorPicker` follows: every
 * host is a `ResponsiveDialog` with its own scrolling body, so an inline
 * grid would be clipped by that ancestor `overflow` (defect
 * MENU-PORTAL). `Menu` already owns the portal, the runtime measurement,
 * the viewport clamp, the outside-click and the Escape-stops-here
 * behaviour. A second dialog was rejected because no overlay-on-overlay
 * pattern exists here and the focus-trap contracts are not written to
 * nest.
 *
 * ## Two tabs, one search box, one pinned free-type field
 *
 * "Icons" (Lucide) and "Emoji" (the curated list) are two tabs sharing
 * ONE search box: a user wanting "a checkmark" does not know which
 * source has one, so filtering both at once and letting them switch tab
 * is the only search that answers the question they actually asked. The
 * free-type emoji field is pinned below the tabs rather than being a
 * third tab, because it is an escape hatch, not a peer browsing mode.
 *
 * ## Storage is unchanged, and degradation is field-local
 *
 * What is stored is a bare `string` (`IconStringSchema`), discriminated
 * on READ by asking the catalog (`isLucideIcon`) — never by a regex over
 * the string. A value the catalog does not know renders as inert
 * verbatim text, stays the current selection, and is never rewritten by
 * a save that did not touch it.
 */

/** Which source the grid is showing. */
type Tab = "icons" | "emoji";

/** Splits a catalog id into its searchable words plus its keywords. */
function matchesIcon(entry: LucideCatalogEntry, q: string): boolean {
  if (entry.id.includes(q)) return true;
  return (entry.keywords ?? []).some(k => k.includes(q));
}

export function IconEmojiPicker({
  value,
  onChange,
  testId,
  listTestId,
  searchTestId,
  clearTestId,
  ariaLabel = "Icon",
  buttonClassName,
}: {
  /** The stored icon string, or undefined for none. */
  readonly value: string | undefined;
  /** Called with the chosen string, or undefined when cleared. */
  readonly onChange: (icon: string | undefined) => void;
  readonly testId?: string | undefined;
  readonly listTestId?: string | undefined;
  readonly searchTestId?: string | undefined;
  readonly clearTestId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly buttonClassName?: string | undefined;
}) {
  return (
    <Menu
      aria-label={ariaLabel}
      panelClassName="w-[320px] p-3"
      trigger={({ toggle, open: _open, ...aria }) => (
        <button
          type="button"
          data-testid={testId}
          // Parity with `ColorPicker`/`SelectCombobox`: the stored choice
          // is readable without opening the panel.
          data-value={value ?? ""}
          aria-label={ariaLabel}
          onClick={toggle}
          {...aria}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-2 rounded-md",
            "border border-border-default bg-bg-surface px-2 text-left text-body",
            "cursor-pointer transition-colors hover:bg-bg-muted",
            "aria-expanded:border-border-strong",
            buttonClassName,
          )}
        >
          <IconGlyph icon={value} size={16} />
          <span className="min-w-0 truncate text-text-primary">
            {value === undefined ? "No icon" : describe(value)}
          </span>
        </button>
      )}
    >
      {({ close }) => (
        <IconPanel
          value={value}
          listTestId={listTestId}
          searchTestId={searchTestId}
          clearTestId={clearTestId}
          onPick={next => { onChange(next); close(); }}
        />
      )}
    </Menu>
  );
}

/**
 * A short description of what is set, for the trigger's label.
 *
 * Ken, 2026-09-22: "once selected, why is there double icon?" — the
 * trigger renders `<IconGlyph>` AND this label. For a Lucide icon the
 * label is a NAME ("Globe") and reads correctly beside the glyph; for
 * an emoji it used to return the emoji itself, so the same character
 * rendered twice. An emoji is its own picture: the glyph carries it,
 * and this returns the generic noun instead.
 */
function describe(icon: string): string {
  return isLucideIcon(icon) ? lucideLabel(icon) : "Emoji";
}

/**
 * Renders a stored icon string: the Lucide glyph when the catalog knows
 * it, the string verbatim otherwise.
 *
 * This is the single read-side implementation of A279's shape-sniff, so
 * every surface that shows an entity's icon degrades the same way.
 */
export function IconGlyph({
  icon,
  size = 16,
  className,
  color,
}: {
  readonly icon: string | undefined;
  readonly size?: number;
  readonly className?: string | undefined;
  /**
   * The resolved colour, when the host has one. Applies ONLY to a Lucide
   * glyph — an emoji carries its own colour and is never tinted, which
   * is the rule the colour control's disabled state mirrors.
   */
  readonly color?: string | undefined;
}) {
  if (icon === undefined) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-block shrink-0 rounded-sm bg-bg-muted", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const Comp = lucideIcon(icon);
  if (Comp !== undefined) {
    return (
      <Comp
        aria-hidden="true"
        size={size}
        className={cn("shrink-0", className)}
        {...(color !== undefined ? { color } : {})}
      />
    );
  }
  // Field-local degradation: an emoji, or an id this build does not
  // know, renders verbatim. Nothing rewrites it.
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}
      style={{ width: size, height: size, fontSize: size }}
    >
      {icon}
    </span>
  );
}

/**
 * The panel body.
 *
 * Split out so the search term, the active tab and the free-type draft
 * all mount fresh each time the panel opens — reopening starts from what
 * is stored, not from a half-finished search abandoned last time.
 */
function IconPanel({
  value,
  listTestId,
  searchTestId,
  clearTestId,
  onPick,
}: {
  readonly value: string | undefined;
  readonly listTestId?: string | undefined;
  readonly searchTestId?: string | undefined;
  readonly clearTestId?: string | undefined;
  readonly onPick: (next: string | undefined) => void;
}) {
  const [tab, setTab] = useState<Tab>(() =>
    value !== undefined && !isLucideIcon(value) ? "emoji" : "icons",
  );
  const [query, setQuery] = useState("");
  const [freeText, setFreeText] = useState("");

  const q = query.trim().toLowerCase();

  const icons = useMemo(
    () => (q === "" ? LUCIDE_CATALOG : LUCIDE_CATALOG.filter(en => matchesIcon(en, q))),
    [q],
  );
  const emoji = useMemo(
    () =>
      q === ""
        ? EMOJI_CATALOG
        : EMOJI_CATALOG.filter(en => en.char.includes(q) || en.keywords.some(k => k.includes(q))),
    [q],
  );

  // A stored value the catalog does not know (a hand-authored emoji, an
  // id from another set) stays selectable rather than being dropped —
  // it is offered as the first cell of the Emoji grid, mirroring what
  // the old Combobox picker did with its "(custom)" row.
  const unknownCurrent =
    value !== undefined && !isLucideIcon(value) && !EMOJI_CATALOG.some(en => en.char === value)
      ? value
      : undefined;

  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Two-dimensional roving focus over the grid's cells — `ColorPicker`'s
   * `onGridKeyDown` (A289), adopted per the known-gaps note that this
   * grid is "the same shape... adopting it is mechanical". One value
   * changes on purpose: the icon grid is filtered by a live search box,
   * so its row width is not a constant like `ColorPicker`'s fixed 6.
   *
   * The column count is therefore DERIVED from the actual laid-out
   * cells rather than hardcoded as 8 (the CSS `grid-cols-8` class):
   * with fewer than 8 results the CSS grid still has 8 columns but only
   * fills part of the first row, and a future width/breakpoint change
   * to the panel would silently desync a hardcoded constant from what a
   * sighted user sees. Reading it back from layout (grouping cells by
   * their rendered `top`) stays correct either way.
   *
   * Because the result set can also SHRINK out from under the cursor
   * (the user types another character while a cell deep in the grid is
   * focused), every lookup re-reads the DOM fresh on each keypress
   * rather than caching an index from a previous render — there is no
   * stale "cells.length" to go out of range against.
   */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const cells = gridRef.current
      ? Array.from(gridRef.current.querySelectorAll<HTMLElement>('[role="gridcell"]'))
      : [];
    if (cells.length === 0) return;
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;

    // Derive the column count from layout: count how many leading cells
    // share the first cell's `top`. A single-row result (fewer cells
    // than a full row) still measures correctly — every cell shares one
    // `top`, so "columns" comes out as the whole row, and Up/Down clamp
    // to the same row, which is the correct behaviour for a one-row grid.
    const firstTop = cells[0]?.getBoundingClientRect().top;
    let columns = cells.length;
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]?.getBoundingClientRect().top !== firstTop) { columns = i; break; }
    }

    // Clamped, not wrapped — ColorPicker's reasoning applies unchanged:
    // wrapping columns would move the cursor to a different row on
    // Left/Right, which is disorienting in a grid where position
    // carries meaning.
    const next = (() => {
      switch (e.key) {
        case "ArrowRight": return Math.min(at + 1, cells.length - 1);
        case "ArrowLeft": return Math.max(at - 1, 0);
        case "ArrowDown": return Math.min(at + columns, cells.length - 1);
        case "ArrowUp": return Math.max(at - columns, 0);
        case "Home": return 0;
        case "End": return cells.length - 1;
        default: return -1;
      }
    })();
    if (next < 0) return;
    e.preventDefault();
    cells[next]?.focus();
  };

  // The flattened, ordered list of what the grid renders for the active
  // tab — one shape for both tabs so the render below (and the roving
  // tab-stop calculation) does not need to know which tab it is.
  const visibleCells: { id: string; label: string; selected: boolean; glyph: React.ReactNode }[] =
    tab === "icons"
      ? icons.map(entry => ({
          id: entry.id,
          label: lucideLabel(entry.id),
          selected: entry.id === value,
          glyph: <IconGlyph icon={entry.id} size={18} />,
        }))
      : [
          ...(unknownCurrent !== undefined
            ? [{
                id: unknownCurrent,
                label: `${unknownCurrent} (current)`,
                selected: true,
                glyph: <IconGlyph icon={unknownCurrent} size={18} />,
              }]
            : []),
          ...emoji.map(entry => ({
            id: entry.char,
            label: entry.keywords[0] ?? entry.char,
            selected: entry.char === value,
            glyph: <span className="text-[18px] leading-none">{entry.char}</span>,
          })),
        ];

  // The single tab stop (roving `tabIndex`): the selected cell, or the
  // first cell if none of the currently visible ones is selected — which
  // also covers a search filtering the selected value out entirely.
  const tabStopAt = Math.max(0, visibleCells.findIndex(cell => cell.selected));

  // Ken, 2026-09-22: "we do not need the icon/emoji count. take that
  // out." The count answered a question nobody asks — the grid below is
  // the answer — and it competed with the tab's own label.
  const tabButton = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-testid={`${listTestId ?? "icon"}-tab-${id}`}
      onClick={() => { setTab(id); }}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-label transition-colors",
        tab === id
          ? "bg-bg-muted text-text-primary"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <TextField
        size="sm"
        data-testid={searchTestId}
        aria-label="Search icons and emoji"
        placeholder="Search…"
        value={query}
        onChange={e => { setQuery(e.target.value); }}
        onKeyDown={e => {
          // ArrowDown from the search box hands off to the grid, landing
          // on its one tab stop — the usual combobox-into-listbox
          // pattern, and the only way into the grid by keyboard other
          // than Tab (which would otherwise land on the "Icons" tab
          // first). Typing itself is untouched: every other key keeps
          // its normal text-input behaviour, including Left/Right/Home/
          // End, which must move the caret here, not the grid cursor.
          if (e.key !== "ArrowDown") return;
          const stop = gridRef.current?.querySelector<HTMLElement>(
            '[role="gridcell"][tabindex="0"]',
          );
          if (stop === null || stop === undefined) return;
          e.preventDefault();
          stop.focus();
        }}
      />

      {/* One search box, two tabs — A279. The tabs used to carry live
          match counts; Ken cut them (2026-09-22). The original argument
          was that a count tells a searcher the other tab has matches
          too — but the empty-state below already says when a tab has
          none, and the count read as chrome on every other visit. */}
      <div role="tablist" aria-label="Icon source" className="flex gap-1">
        {tabButton("icons", "Icons")}
        {tabButton("emoji", "Emoji")}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={tab === "icons" ? "Icons" : "Emoji"}
        data-testid={listTestId}
        onKeyDown={onGridKeyDown}
        className="grid max-h-[200px] grid-cols-8 gap-1 overflow-y-auto"
      >
        {visibleCells.map((cell, index) => (
          <GridCell
            key={cell.id}
            id={cell.id}
            label={cell.label}
            selected={cell.selected}
            tabStop={index === tabStopAt}
            onPick={() => { onPick(cell.id); }}
          >
            {cell.glyph}
          </GridCell>
        ))}
        {visibleCells.length === 0 && (
          <p className="col-span-8 m-0 px-1 py-2 text-meta text-text-tertiary">
            Nothing matches “{query}”.
          </p>
        )}
      </div>

      {/* Pinned, always visible — the escape hatch for any emoji the
          curated list does not carry. Not a third tab (A279). */}
      <div className="flex items-end gap-2 border-t border-border-subtle pt-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-meta text-text-secondary">
          Or type any emoji
          <TextField
            size="sm"
            data-testid={`${listTestId ?? "icon"}-free`}
            aria-label="Type any emoji"
            placeholder="🎈"
            value={freeText}
            onChange={e => { setFreeText(e.target.value); }}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const raw = freeText.trim();
              if (raw !== "") onPick(raw);
            }}
          />
        </label>
        <button
          type="button"
          data-testid={`${listTestId ?? "icon"}-free-apply`}
          disabled={freeText.trim() === ""}
          onClick={() => {
            const raw = freeText.trim();
            if (raw !== "") onPick(raw);
          }}
          className={cn(
            "rounded-md border border-border-default px-2 py-1 text-label",
            "text-text-primary transition-colors hover:bg-bg-muted",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          Use
        </button>
      </div>

      <button
        type="button"
        data-testid={clearTestId}
        onClick={() => { onPick(undefined); }}
        className="rounded-md px-2 py-1 text-left text-label text-text-secondary transition-colors hover:bg-bg-muted"
      >
        No icon
      </button>
    </div>
  );
}

/**
 * One cell of the grid.
 *
 * The testid is `icon-option-<id>` — unchanged from the Combobox picker
 * it replaces, so the settings tests and the e2e suite keep driving real
 * behaviour rather than being rewritten around a new control.
 *
 * `role="gridcell"` + roving `tabIndex` (`tabStop`), not `role="radio"`:
 * see the arrow-key-navigation doc comment on `onGridKeyDown` above for
 * why a grid of up to 225 filterable icon buttons is not the same
 * interaction as `ColorPicker`'s ~19-swatch radiogroup.
 */
function GridCell({
  id,
  label,
  selected,
  tabStop,
  onPick,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly onPick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="gridcell"
      data-testid={`icon-option-${id}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      onClick={onPick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-bg-surface-raised",
        selected
          ? "bg-accent-muted text-accent ring-1 ring-accent"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

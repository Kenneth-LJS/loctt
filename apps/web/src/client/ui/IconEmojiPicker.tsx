import { useMemo, useState } from "react";

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

/** A short description of what is set, for the trigger's label. */
function describe(icon: string): string {
  return isLucideIcon(icon) ? lucideLabel(icon) : icon;
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

  const tabButton = (id: Tab, label: string, count: number) => (
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
      <span className="ml-1 text-meta text-text-tertiary">{count}</span>
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
      />

      {/* One search box, two tabs — A279. The counts are live against
          the current query, so a user searching "check" can see at a
          glance that the other tab has matches too. */}
      <div role="tablist" aria-label="Icon source" className="flex gap-1">
        {tabButton("icons", "Icons", icons.length)}
        {tabButton("emoji", "Emoji", emoji.length + (unknownCurrent !== undefined ? 1 : 0))}
      </div>

      <div
        role="group"
        aria-label={tab === "icons" ? "Icons" : "Emoji"}
        data-testid={listTestId}
        className="grid max-h-[200px] grid-cols-8 gap-1 overflow-y-auto"
      >
        {tab === "icons"
          ? icons.map(entry => (
              <GridCell
                key={entry.id}
                id={entry.id}
                label={lucideLabel(entry.id)}
                selected={entry.id === value}
                onPick={() => { onPick(entry.id); }}
              >
                <IconGlyph icon={entry.id} size={18} />
              </GridCell>
            ))
          : (
              <>
                {unknownCurrent !== undefined && (
                  <GridCell
                    id={unknownCurrent}
                    label={`${unknownCurrent} (current)`}
                    selected
                    onPick={() => { onPick(unknownCurrent); }}
                  >
                    <IconGlyph icon={unknownCurrent} size={18} />
                  </GridCell>
                )}
                {emoji.map(entry => (
                  <GridCell
                    key={entry.char}
                    id={entry.char}
                    label={entry.keywords[0] ?? entry.char}
                    selected={entry.char === value}
                    onPick={() => { onPick(entry.char); }}
                  >
                    <span className="text-[18px] leading-none">{entry.char}</span>
                  </GridCell>
                ))}
              </>
            )}
        {(tab === "icons" ? icons.length : emoji.length + (unknownCurrent !== undefined ? 1 : 0)) === 0 && (
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
 */
function GridCell({
  id,
  label,
  selected,
  onPick,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onPick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={`icon-option-${id}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onPick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        selected
          ? "bg-accent-muted text-accent ring-1 ring-accent"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

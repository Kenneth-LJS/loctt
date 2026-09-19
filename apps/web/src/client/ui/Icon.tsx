import type { ReactElement, SVGProps } from "react";

/**
 * Inline-SVG icon set. Replaces the ad-hoc Unicode glyphs (`▾ ✕ ⋯ ↑ ↓`)
 * that were being used as interactive affordances — carets on collapsible
 * sections, close buttons, kebab menus, reorder controls — which read as
 * gross ASCII on a real UI (Ken's report).
 *
 * Hand-rolled inline SVG rather than an icon font or a dependency: the
 * icons are text-coloured (`currentColor`), tree-shaken to only what is
 * imported, and carry no font-loading FOUT. Each is a 16-unit viewBox on a
 * 1.5 stroke, so they sit consistently beside the app's 14px text.
 *
 * `ICON` (ui/icons.ts) keeps the few glyphs that are legitimately TEXT
 * (the ★ saved-filter marker Ken wants kept, keyboard-key labels) or a
 * status marker (⚠). This component is for affordances that should be
 * drawn, not typed.
 *
 * Accessibility: decorative by default (`aria-hidden`). When an icon is
 * the ONLY content of a control, the control itself carries the
 * `aria-label` — the icon stays hidden so the label is not read twice.
 */

export type IconName =
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "close"
  | "more"
  | "arrowUp"
  | "arrowDown"
  | "link"
  | "edit"
  | "trash"
  | "archive"
  | "unarchive"
  | "plus"
  | "download"
  | "refresh"
  | "check"
  | "search"
  | "star"
  | "settings"
  | "drag";

/** Path/element content per icon, drawn in a shared 16x16 stroked frame. */
const PATHS: Record<IconName, ReactElement> = {
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  chevronUp: <path d="M4 10l4-4 4 4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  more: <><circle cx="4" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12" cy="8" r="1" /></>,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  arrowDown: <path d="M8 3v10M4 9l4 4 4-4" />,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1" /><path d="M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" /></>,
  edit: <><path d="M8.5 3.5l4 4L6 14H2v-4z" /><path d="M11 5l-1.5-1.5" /></>,
  trash: <><path d="M3 4.5h10" /><path d="M5.5 4.5V3h5v1.5" /><path d="M4.5 4.5l.5 8.5h6l.5-8.5" /></>,
  archive: <><rect x="2.5" y="3" width="11" height="3" rx="0.5" /><path d="M3.5 6v6.5h9V6" /><path d="M6.5 8.5h3" /></>,
  unarchive: <><rect x="2.5" y="3" width="11" height="3" rx="0.5" /><path d="M3.5 6v6.5h9V6" /><path d="M8 11.5V7.5M6 9l2-2 2 2" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  download: <><path d="M8 3v7M5 7.5l3 3 3-3" /><path d="M3.5 12.5h9" /></>,
  refresh: <><path d="M12.5 8a4.5 4.5 0 10-1.3 3.2" /><path d="M12.5 4.5V8H9" /></>,
  check: <path d="M3.5 8.5l3 3 6-6.5" />,
  search: <><circle cx="7" cy="7" r="3.5" /><path d="M10 10l3 3" /></>,
  star: <path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.6 4.6 13.5l.7-3.8L2.5 7l3.8-.5z" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></>,
  drag: <><circle cx="6" cy="4" r="1" /><circle cx="10" cy="4" r="1" /><circle cx="6" cy="8" r="1" /><circle cx="10" cy="8" r="1" /><circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" /></>,
};

/** Icons drawn as filled shapes rather than strokes (dots, star). */
const FILLED = new Set<IconName>(["more", "star", "drag"]);

export function Icon({
  name,
  size = 16,
  className,
  ...rest
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      {...(filled
        ? { fill: "currentColor", stroke: "none" }
        : { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

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
  | "copy"
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
  | "drag"
  | "sun"
  | "moon"
  | "monitor"
  | "eye"
  | "eyeOff"
  | "ban"
  | "flag"
  | "user"
  | "atSign"
  | "calendar"
  | "alert"
  | "subtasks"
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "codeBlock"
  | "list"
  | "listNumbered"
  | "quote"
  | "superscript"
  | "subscript"
  | "undo"
  | "redo"
  | "sourceCode";

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
  copy: <><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" /><path d="M10.5 5.5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" /></>,
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
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></>,
  moon: <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />,
  monitor: <><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M6 13.5h4M8 11v2.5" /></>,
  eye: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  eyeOff: <><path d="M6.2 4.1A6 6 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-1.8 2.3" /><path d="M4.3 5.3A11 11 0 001.5 8s2.5 4.5 6.5 4.5a6 6 0 002.3-.45" /><path d="M6.6 6.6a2 2 0 002.8 2.8" /><path d="M2.5 2.5l11 11" /></>,
  ban: <><circle cx="8" cy="8" r="5.5" /><path d="M4.1 4.1l7.8 7.8" /></>,
  flag: <><path d="M4 14V2.5" /><path d="M4 3h7.5l-1.5 2.5L11.5 8H4" /></>,
  user: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13a4.5 4.5 0 019 0" /></>,
  atSign: <><circle cx="8" cy="8" r="2.5" /><path d="M10.5 8v1.25a1.75 1.75 0 003.5 0V8A6 6 0 108 14a5.9 5.9 0 002.5-.55" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  alert: <><path d="M8 2.5l6 11H2z" /><path d="M8 6.5v3.5M8 11.8v.2" /></>,
  subtasks: <><path d="M4 2.5v8a2 2 0 002 2h2" /><rect x="8" y="4" width="5" height="3" rx="0.5" /><rect x="8" y="10" width="5" height="3" rx="0.5" /></>,
  // Formatting-toolbar glyphs (Phase-0 editor polish). Drawn in the
  // same stroked 16-unit frame as the rest so they sit beside the app's
  // text at the toolbar's icon size.
  bold: <path d="M5 3h4a2.5 2.5 0 010 5H5zM5 8h4.5a2.5 2.5 0 010 5H5z" />,
  italic: <path d="M10.5 3h-3M8.5 13h-3M9.5 3L6.5 13" />,
  strikethrough: <><path d="M3 8h10" /><path d="M11 5a3 3 0 00-3-1.5C6 3.5 5 4.4 5 5.6c0 1 .7 1.6 2 2M5 10.5c.4 1.3 1.6 2 3 2 1.8 0 3-.9 3-2.2" /></>,
  code: <path d="M6 5L3 8l3 3M10 5l3 3-3 3" />,
  codeBlock: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M6.5 6.5L5 8l1.5 1.5M9.5 6.5L11 8l-1.5 1.5" /></>,
  list: <><path d="M6 4.5h7M6 8h7M6 11.5h7" /><circle cx="3.3" cy="4.5" r="0.6" /><circle cx="3.3" cy="8" r="0.6" /><circle cx="3.3" cy="11.5" r="0.6" /></>,
  listNumbered: <><path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5" /><path d="M2.6 3.2h.8v2.6M2.4 11h1.4M2.4 11c.9 0 1.4-1.3 0-1.6" /></>,
  quote: <><path d="M4 4.5h3.5v3.5A3 3 0 014 11" /><path d="M9 4.5h3.5v3.5A3 3 0 019 11" /></>,
  superscript: <><path d="M3 5l5 6M8 5l-5 6" /><path d="M11 3.5c1.5-.8 2.5 0 2.5.8 0 .9-1.2 1.2-2.5 2.2h2.7" /></>,
  subscript: <><path d="M3 4l5 6M8 4l-5 6" /><path d="M11 10.5c1.5-.8 2.5 0 2.5.8 0 .9-1.2 1.2-2.5 2.2h2.7" /></>,
  undo: <><path d="M4 8h6.5a3 3 0 010 6H7" /><path d="M6 5.5L3.5 8 6 10.5" /></>,
  redo: <><path d="M12 8H5.5a3 3 0 000 6H9" /><path d="M10 5.5L12.5 8 10 10.5" /></>,
  sourceCode: <path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12" />,
};

/** Icons drawn as filled shapes rather than strokes (dots, star). */
const FILLED = new Set<IconName>(["more", "star", "drag", "bold"]);

export function Icon({
  name,
  size = 16,
  className,
  ...rest
}: {
  readonly name: IconName;
  readonly size?: number;
  // `string | undefined` (not just optional) so callers can pass a
  // conditional `cond ? "cls" : undefined` inline under
  // exactOptionalPropertyTypes.
  readonly className?: string | undefined;
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

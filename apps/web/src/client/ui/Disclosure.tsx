import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import { Icon } from "./Icon.tsx";

/**
 * The one collapsible-detail primitive: a real `<details>`/`<summary>`
 * with the browser's own marker suppressed and our `<Icon>` caret drawn
 * in its place.
 *
 * ## Why this exists
 *
 * Ken hit an error page reading a literal `▸ Show details`. Nothing in
 * this repo types that glyph — it is the browser's NATIVE `<details>`
 * marker, which three separate call sites were rendering unsuppressed
 * (`error/RegionErrorBoundary.tsx`, `settings/ReconcilePanel.tsx`,
 * `settings/GitSyncPanel.tsx`). That is the same class of defect
 * `ui/Icon.tsx` was built for — an affordance that should be *drawn*
 * showing up as a typed glyph — except here the glyph came from the user
 * agent, so no amount of grepping our own source finds it.
 *
 * His ruling, verbatim:
 *
 * > "we can use summary HTML elements BUT we should use it through a
 * > common summary component that uses the native elements. this allows
 * > us to restyle with a consistent aesthetic across the board"
 *
 * So: keep the native element, wrap it once.
 *
 * ## Why native `<details>`, not buttons + state
 *
 * The three prior call sites each independently commented that native
 * `<details>` is "keyboard-operable for free", and they were right — it
 * also brings find-in-page (the browser expands a collapsed `<details>`
 * to reveal a match), the `open` attribute as the single source of
 * truth, and correct AT semantics without an `aria-expanded` we would
 * have to keep in sync. Reimplementing that with a `<button>` and a
 * `useState` would trade all of it for a caret we can style — and we can
 * style the caret anyway. This component stays UNCONTROLLED: it holds no
 * React state, and the DOM's `open` attribute remains the truth.
 *
 * ## Why the marker suppression needs TWO rules
 *
 * `list-style: none` on the summary is the standards-track way, and it
 * is what Chrome and Firefox honour. WebKit (Safari) draws the marker
 * through a `::-webkit-details-marker` pseudo-element that `list-style`
 * does not reach, so it needs `::-webkit-details-marker { display: none }`
 * as well. Missing the second rule is *exactly* the bug being fixed, on
 * exactly the browser Ken uses. Tailwind's `marker:` variant compiles to
 * `::marker` only and cannot express the `-webkit-` pseudo-element, so
 * both rules live together in `styles/index.css` as `.loctt-disclosure`
 * rather than as utilities here — and `styles/disclosureMarker.test.ts`
 * pins them in the stylesheet source, because jsdom does not load the
 * stylesheet and so cannot observe them at render time.
 *
 * ## Why the caret rotates in CSS rather than swapping icons
 *
 * A `chevronRight`/`chevronDown` swap would need to know whether the
 * element is open, which means React state, which means giving up the
 * uncontrolled design above (and re-syncing on every native toggle,
 * including the ones find-in-page triggers without a click). Instead one
 * `chevronRight` rotates 90° under `details[open]` — pure CSS, no state,
 * and it animates. The caret is decorative: `Icon` already defaults to
 * `aria-hidden="true"`, and the summary's own text is the accessible
 * name, so nothing is announced twice.
 *
 * ## The canonical summary aesthetic
 *
 * The three migrated sites disagreed three ways:
 *   - RegionErrorBoundary: `text-[0.8571rem] text-text-tertiary`,
 *     `cursor-pointer select-none`
 *   - ReconcilePanel: `text-text-tertiary` (size inherited),
 *     `cursor-pointer select-none`
 *   - GitSyncPanel: `text-[0.8571rem] text-accent`, `cursor-pointer`
 *
 * Canonical here is **`text-[0.8571rem] text-text-tertiary` with
 * `cursor-pointer select-none`** — the majority spelling, and the
 * neutral one. GitSyncPanel's `text-accent` is the outlier and loses its
 * accent colour in this migration, deliberately: accent is this app's
 * *interactive-link* colour, and a disclosure summary is a local
 * expand-in-place control, not a navigation. Making one of three
 * disclosures read as a link is the inconsistency this component exists
 * to remove. `select-none` is universal because a summary is a click
 * target, and double-clicking one to expand it should not leave a
 * selection highlight behind.
 *
 * There is deliberately **no `tone` prop**. No migrated site needs one
 * once the accent outlier is resolved, and adding a variant axis
 * speculatively is how the three-way drift started.
 */

export interface DisclosureProps {
  /** The always-visible label. Rendered inside the `<summary>`. */
  readonly summary: ReactNode;
  /** The revealed body. Rendered as the `<details>`' remaining children. */
  readonly children: ReactNode;
  /**
   * Escape hatch on the `<details>` wrapper: layout/spacing only
   * (`mt-1`, `mb-1`). The summary's own typography is not the caller's
   * to set — that is the whole point of the component.
   */
  readonly className?: string | undefined;
  /**
   * Passed through to the `<details>` element, so the migrated sites keep
   * the testids their existing tests (`git-sync-details`,
   * `git-rekey-ulids`) already query.
   */
  readonly "data-testid"?: string | undefined;
}

/**
 * `.loctt-disclosure` (styles/index.css) carries the two marker-kill
 * rules and the `[open]` caret rotation; the Tailwind classes carry the
 * canonical typography. Both are needed — see the docstring.
 */
const SUMMARY_CLASS =
  "flex items-center gap-1 cursor-pointer select-none "
  + "text-[0.8571rem] text-text-tertiary";

export function Disclosure({
  summary,
  children,
  className,
  "data-testid": testId,
}: DisclosureProps) {
  return (
    <details
      className={cn("loctt-disclosure", className)}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      <summary className={SUMMARY_CLASS}>
        <Icon
          name="chevronRight"
          size={12}
          className="loctt-disclosure-caret shrink-0"
          data-testid="disclosure-caret"
        />
        {summary}
      </summary>
      {children}
    </details>
  );
}

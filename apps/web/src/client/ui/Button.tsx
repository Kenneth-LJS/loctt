import { type ButtonHTMLAttributes, forwardRef } from "react";

import { LogoSpinner } from "./brand/LogoSpinner.tsx";
import { cn } from "./cn.ts";

/**
 * The one button. Resolves the ~25 hand-rolled spellings the
 * consistency review found, bakes in `--accent-contrast` (killing the
 * `text-white` defect §3a), and gives every button the
 * hover/active/focus/disabled states that were missing.
 *
 * Renders a real `<button type="button">` — never an accidental submit;
 * a caller that wants submit passes `type="submit"`. Forwards `ref`
 * (menus/focus management need it).
 *
 * `className` is allowed as a **narrow escape hatch**, merged AFTER the
 * variant classes via `cn` (spec §1.1 open decision #6). The default is
 * to allow it: banning it outright pushes one-off needs (a `w-full` at a
 * single call site, a `mt-2`) back into forking the whole element, which
 * is worse drift than a merged utility. It is documented as "layout/
 * spacing overrides only — do not re-spell colour or state here"; the
 * B4 migration and the CI guardrail (spec §2.5) keep it honest. Prefer
 * `fullWidth`/a new variant over reaching for it.
 *
 * `testId` is a **declared** prop applied to the inner `<button>`, not
 * spread — same reasoning as `MenuItem`: a caller writing `data-testid=`
 * on a component that renders its own element type-checks and then never
 * reaches the DOM. Integration/e2e/vitest all select by it, so this is
 * load-bearing.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "ghost-danger"
  | "danger"
  | "danger-outline"
  | "warn-outline"
  | "current";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /** Escape hatch: layout/spacing overrides only, merged after variants. */
  readonly className?: string;
  /** `data-testid` on the rendered `<button>` (declared, not spread). */
  readonly testId?: string;
  /**
   * Shows the brand spinner in place of `children` without resizing the
   * button. `children` stays mounted, wrapped in a span that goes
   * `visibility: hidden` (not `display: none`, which would collapse it)
   * and `aria-hidden="true"` — it keeps occupying its box, so the button
   * does not change width when loading starts or stops, and a screen
   * reader does not read a label that is not currently actionable. The
   * spinner itself is centred over it, absolutely positioned within the
   * button (`relative` on the base). `aria-busy="true"` is set on the
   * `<button>` — the `<button>` itself is never `aria-hidden`, since that
   * would drop the whole control from the accessibility tree, not just
   * its stale label.
   *
   * `loading` also disables the button — a `Saving…`-style state exists
   * to keep a duplicate click from firing while a request is in-flight,
   * and a caller could otherwise pass `loading` without `disabled` and
   * get a spinner that still submits twice. Orthogonal `disabled` (e.g.
   * "form invalid") still applies on top: the button is disabled if
   * *either* is true.
   *
   * **Trap: this can make the button nameless.** `ButtonProps` extends
   * `ButtonHTMLAttributes`, so `aria-label` already forwards through
   * (nothing new needed for that) — but for a button whose *only*
   * accessible name is its visible label text, hiding that text from AT
   * while loading removes the name entirely unless the caller supplies
   * an `aria-label`. There is deliberately no `loadingLabel`-style prop
   * to paper over this: Ken's call is that the policy of *whether* and
   * *when* the name changes belongs to the caller, not baked into
   * `Button` as "changes exactly when `loading` flips" — a caller may
   * want the name to stay fixed, change on a different condition, or be
   * covered by a surrounding live region instead. So: **when migrating a
   * button to `loading`, check whether its accessible name was purely
   * its children text, and if so pass `aria-label` explicitly.** This is
   * not asserted at runtime (a dev-time check here would fire for every
   * icon-only button's already-required `aria-label` too, which is
   * already enforced by `IconButton`, not `Button`) — it is a review
   * discipline, written here so the next person does not discover it by
   * shipping a nameless button.
   */
  readonly loading?: boolean;
}

/** One height per size — the thing that makes buttons align in a row. */
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-label gap-1",
  md: "h-8 px-3 text-body gap-1.5",
};

/**
 * `loading` spinner size per button size, in `rem` so it scales with the
 * 87.5%-root text-zoom convention the rest of the type scale uses
 * (`index.css`), not a fixed pixel size.
 *
 * `BUTTON_SIZE` only sets height and *horizontal* padding (`px-*`) — there
 * is no vertical padding to subtract, so the content box is the full
 * button height (`h-7` = 1.75rem, `h-8` = 2rem). A spinner filling that
 * edge-to-edge reads as too large/cramped against the button's rounded
 * corners, so each is inset to roughly 72–75% of the height rather than
 * the full box: `sm` 1.25rem (~71% of 1.75rem), `md` 1.5rem (75% of
 * 2rem). Picked once here so both sizes stay proportional if the ratio
 * is ever retuned.
 */
export const BUTTON_LOADING_SPINNER_SIZE: Record<ButtonSize, string> = {
  sm: "1.25rem",
  md: "1.5rem",
};

/**
 * The variant → token map. Shared with `IconButton` so a ghost icon
 * button and a ghost text button hover identically. `text-accent-contrast`
 * (never `text-white`) on both filled variants — `--accent-contrast` is
 * white in light and near-black in dark, so it stays legible on the
 * accent/danger fill in both themes (6.29:1 / 6.60:1 on accent, 5.53:1 /
 * 8.56:1 on danger — all AA).
 *
 * The `*-outline` variants are the tinted-outline look the alert banners
 * needed (retry/dismiss): a tone-coloured border and text over a
 * transparent surface, with a subtle tone-tinted hover — distinct from
 * `secondary` (neutral border) and `danger` (solid fill). Modelled as
 * named variants rather than a separate `tone` prop so they compose with
 * the existing `Record<ButtonVariant, string>` map exactly like every
 * other variant (and stay one lookup, not a variant×tone matrix). Tokens
 * only: `border-{tone}-fg` at 40% for a soft edge, `text-{tone}-fg`, and
 * a 10% tone wash on hover.
 *
 * `current` is the same tinted-outline shape, for a container whose tone
 * is decided at *render* time rather than baked into the variant name —
 * a banner that can be `warn` or `danger` depending on which of several
 * kinds it is showing (`SchemaBanner`), or one whose tone is fixed but
 * only known one level up (`ServerUnreachableBanner` is always danger,
 * `AdvisoryFsBanner` always warn). Rather than forking `danger-outline`
 * vs. `warn-outline` per call site, it borrows the ambient CSS `color`
 * via `currentColor` — `border-current`, `hover:bg-current/10`,
 * `active:bg-current/20` — inheriting whatever `text-warn-fg`/
 * `text-danger-fg` the parent container already set, the same way the
 * hand-rolled `border-current/30` buttons this variant replaces did. It
 * emits no `text-*`/`bg-*`-at-rest utility of its own, so it never races
 * a class the container or a caller's `className` sets (`cn` does not
 * resolve Tailwind conflicts — see the module docstring).
 */
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-hover",
  secondary:
    "border border-border-default bg-bg-surface text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  ghost:
    "text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  // A ghost look (transparent surface, muted text at rest) whose hover
  // reddens to the danger tone instead of neutral — the row-action Delete
  // pattern (CommentItem) that neither `ghost` (hovers to text-primary)
  // nor `danger`/`danger-outline` (filled/bordered) covers. Tokens only:
  // a 10% danger-tone wash on hover, `text-danger-fg` on hover/active.
  "ghost-danger":
    "text-text-secondary hover:bg-danger-fg/10 hover:text-danger-fg active:bg-danger-fg/20 active:text-danger-fg",
  danger:
    "bg-danger-fg text-accent-contrast hover:opacity-90 active:opacity-90",
  "danger-outline":
    "border border-danger-fg/40 text-danger-fg hover:bg-danger-fg/10 active:bg-danger-fg/20",
  "warn-outline":
    "border border-warn-fg/40 text-warn-fg hover:bg-warn-fg/10 active:bg-warn-fg/20",
  current:
    "border border-current/30 hover:bg-current/10 active:bg-current/20",
};

/**
 * Base classes for every button-shaped control. `cursor-pointer` is here
 * (K-16): a native `<button>` has no pointer cursor and only a handful of
 * sites set it today; baking it into the base is the component-level fix.
 * `disabled:cursor-not-allowed` still wins for the disabled case. Radius
 * is always `rounded-md` (§2.3, bans bare `rounded`). The global
 * `:focus-visible` ring is relied on — no `focus:` classes here.
 */
export const BUTTON_BASE =
  "relative inline-flex items-center justify-center rounded-md font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      fullWidth = false,
      className,
      testId,
      type,
      children,
      loading = false,
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // Default to "button" so a button in a <form> never submits by
        // accident; an explicit type from the caller wins.
        type={type ?? "button"}
        // Either the caller's own `disabled` or `loading` blocks the
        // button — a duplicate submit while a request is in flight is
        // exactly what `loading` exists to prevent.
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        className={cn(
          BUTTON_BASE,
          BUTTON_SIZE[size],
          BUTTON_VARIANT[variant],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {/*
          Wrapping `children` in one span (rather than toggling
          `visibility` per top-level child) is what keeps this correct
          however many children a caller passes — a single ternary
          string today, potentially an icon + label tomorrow. `gap-1`/
          `gap-1.5` from BUTTON_SIZE is a flex gap between this span and
          its siblings (the spinner/status spans below); a caller
          needing spacing *within* its own children composes that itself,
          same as it would with any other single flex child.
        */}
        <span
          aria-hidden={loading || undefined}
          className={cn("inline-flex items-center", loading && "invisible")}
        >
          {children}
        </span>
        {loading && (
          <span
            className="pointer-events-none absolute inset-0 grid place-items-center"
            aria-hidden="true"
          >
            <LogoSpinner size={BUTTON_LOADING_SPINNER_SIZE[size]} />
          </span>
        )}
      </button>
    );
  },
);

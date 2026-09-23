import type { EntityColor } from "@loctt/contracts";

import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { cn } from "./cn.ts";
import { resolveForMode } from "./entityColor.ts";

/**
 * The two-mode colour preview — "what will this look like in both
 * themes", answered without making the user leave the dialog, flip the
 * theme, discover it does not read, and come back to edit again (Ken,
 * 2026-09-23: *"i dont want users to have to pick a colour, exit,
 * toggle, see its not good, then edit again"*).
 *
 * ## It is TWO problems, and CSS only solves one of them
 *
 * **The CSS half is free.** `styles/tokens.css:150` is a bare `.dark`
 * class selector — not `html.dark` — and `styles/index.css:115` scopes
 * the Tailwind variant as `@custom-variant dark (&:where(.dark, .dark *))`,
 * i.e. descendant-matched. So a nested `<div className="dark">` is a
 * complete theme island: every `--bg-*` / `--text-*` / `--border-*`
 * custom property re-resolves inside it by ordinary cascade, every
 * `dark:` utility on a descendant fires, and `color-scheme: dark` rides
 * along (it is already in that scope), which matters for any native
 * control inside.
 *
 * Two consequences that are easy to get wrong:
 *
 * - There is **no `.light` scope** — light is `:root`. A wrapper without
 *   `.dark` therefore does NOT reset the tokens back. So the two halves
 *   must be **siblings**, neither nested in the other, and the light half
 *   must paint `bg-bg-surface` explicitly rather than inheriting whatever
 *   surface it happens to sit on.
 * - This only works because the theme is a class on `<html>`. Had it been
 *   `prefers-color-scheme` or `html[data-theme]`, an island would be
 *   impossible without a media-query hack.
 *
 * **The React half is NOT solved by CSS, and it is the actual trap.**
 * The elements worth previewing resolve their own hex through
 * `useColorMode()` (`ui/entityColor.ts:59`), whose whole body is
 * `return useTheme().resolved` — the **global** theme, read from module
 * state synced to `document.documentElement`. Drop a real `<LabelPill>`
 * inside a `.dark` island and you get **dark chrome painted with the
 * light-mode hex**: half-right, which is worse than obviously wrong,
 * because it looks plausible and the user trusts it.
 *
 * ## How this primitive resolves it: pass the mode, never read it
 *
 * `render` is called **once per mode, with that mode's already-resolved
 * hex**, computed here via `resolveForMode(color, mode)` — the non-hook
 * bridge that takes the mode as an argument. Nothing inside a preview
 * specimen ever calls `useColorMode`, so there is no global state for it
 * to read wrongly.
 *
 * Resolution itself is core's (`resolveEntityColor(color, mode)`,
 * `packages/core/src/config/color.ts:298`), reached through
 * `resolveForMode`. Nothing here inspects a hex or picks a light/dark
 * half itself — re-deriving that is how the surfaces end up disagreeing.
 *
 * ## Why a render FUNCTION and not two nodes
 *
 * Two `ReactNode` props would let a consumer pass two different
 * renderings — and a preview whose halves have drifted from each other
 * is worse than no preview, because it reports a difference the real UI
 * will not show. One function called twice cannot drift: both halves are
 * the same code, and the *only* thing that differs between them is the
 * hex and the surrounding token scope. That is exactly the claim the
 * preview is making.
 *
 * ## Layout: derived from width, not from an enum (Ken, 2026-09-23)
 *
 * *"i guess by width? but we then need a fixed width for the render,
 * then the container box with bg needs x and y padding and it centre
 * aligns everything"*. So: each specimen sits in a fixed-width
 * (`SPECIMEN_W`) box with x/y padding that centres its content, and the
 * two boxes lay out as a row when they fit and a column when they do
 * not. No `layout` prop — see `NARROW_PX` for why the breakpoint is a
 * width fact rather than a caller's choice.
 */

/**
 * The fixed width of one specimen box.
 *
 * Both halves must be the SAME width or the two renderings are not
 * comparable — a pill that wraps in one box and not the other reports a
 * difference that is about the box, not the colour.
 *
 * 148px: two of these plus the `gap-2` (8px) between them is 304px,
 * which fits the 343px of content the mobile `Sheet` has at a 375px
 * viewport (375 − `p-4` × 2 = 343) and the 416px the desktop `Modal`
 * has (`max-w-md` 448 − `p-4` × 2 = 416). Note the host is the DIALOG
 * BODY, not the 248px `ColorPicker` popover panel — the preview
 * deliberately does not live in the popover (see `IconColorFields`).
 */
export const SPECIMEN_W = 148;

/**
 * Below this the two boxes stack.
 *
 * 640px is the app's single mobile breakpoint — the `useIsNarrow`
 * default (Tailwind `sm`), and the one `ResponsiveDialog` itself uses to
 * swap its centered `Dialog` for a bottom `Sheet` (A273). Matching it
 * means the preview flips at exactly the moment its host does, rather
 * than at some second breakpoint of its own invention.
 *
 * This is NOT a caller's choice and so is not a prop: 2 × 148 + 8 = 304
 * fits every host above the breakpoint and the row is always correct
 * there; below it the host is a sheet and the column is always correct.
 * An enum with two values, only one of which ever fits at a given width,
 * is an enum spent on a width fact.
 */
export const NARROW_PX = 640;

export function ThemePreview({
  color,
  render,
  testId,
  ariaLabel = "Colour preview",
  className,
}: {
  /** The stored colour. Resolved per mode here, never by the specimen. */
  readonly color: EntityColor | undefined;
  /**
   * Renders one specimen. Called ONCE PER MODE with that mode's
   * resolved hex (`undefined` when there is no colour, or when a
   * palette reference does not resolve — the same neutral-fallback
   * signal every other call site understands).
   *
   * Must not call `useColorMode` or any hook that reads the global
   * theme: that is the exact bug this primitive exists to prevent.
   */
  readonly render: (hex: string | undefined, mode: "light" | "dark") => React.ReactNode;
  readonly testId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}) {
  const narrow = useIsNarrow(NARROW_PX);

  // Resolved HERE, per mode, and handed down — so a specimen never has a
  // global theme to read. Both calls go through core's resolver.
  const lightHex = resolveForMode(color, "light");
  const darkHex = resolveForMode(color, "dark");

  return (
    // The specimens are decorative: the chosen colour is already
    // announced by the picker trigger, which says `describe(value)`.
    // One label on the container, `aria-hidden` on the specimens, so a
    // screen reader is not read two copies of the same pill.
    <div
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn("flex gap-2", narrow ? "flex-col" : "flex-row", className)}
    >
      <PreviewCell
        mode="light"
        caption="Light"
        {...(testId !== undefined ? { testId: `${testId}-light` } : {})}
      >
        {render(lightHex, "light")}
      </PreviewCell>
      <PreviewCell
        mode="dark"
        caption="Dark"
        {...(testId !== undefined ? { testId: `${testId}-dark` } : {})}
      >
        {render(darkHex, "dark")}
      </PreviewCell>
    </div>
  );
}

/**
 * One half of the island.
 *
 * The dark cell carries `className="dark"`, which re-scopes every token
 * inside it (`tokens.css:150`). The light cell carries NO class — light
 * is `:root` and there is no `.light` scope to opt into — which is
 * precisely why both cells must paint `bg-bg-surface` explicitly and why
 * they are siblings: a light cell nested inside the dark one would still
 * be dark.
 *
 * `bg-bg-surface` (rather than `--bg-canvas` or `--bg-surface-raised`)
 * is the surface the palette's AA contrast is actually guaranteed
 * against in both modes (`color.ts:103-105`), so the preview is making
 * the same promise the palette makes.
 */
function PreviewCell({
  mode,
  caption,
  children,
  testId,
}: {
  readonly mode: "light" | "dark";
  readonly caption: string;
  readonly children: React.ReactNode;
  readonly testId?: string | undefined;
}) {
  return (
    <div
      data-testid={testId}
      data-preview-mode={mode}
      // `dark` is the island. `bg-bg-surface` + `text-text-primary` are
      // the explicit paints that stop either half inheriting the other's
      // scope or the dialog's own surface.
      className={cn(
        mode === "dark" && "dark",
        "flex flex-col items-center justify-center gap-1.5 rounded-md",
        "border border-border-subtle bg-bg-surface px-3 py-2.5",
      )}
      style={{ width: SPECIMEN_W }}
    >
      <div aria-hidden="true" className="flex items-center justify-center">
        {children}
      </div>
      <span className="text-[0.7857rem] text-text-tertiary">{caption}</span>
    </div>
  );
}

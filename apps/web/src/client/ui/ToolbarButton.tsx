import { forwardRef } from "react";

import { Button, type ButtonProps } from "./Button.tsx";
import { cn } from "./cn.ts";

/**
 * The list-toolbar pill (Ken's "no rhyme or reason" flag). One pill spec
 * every toolbar control shares, plus the `active`/selected look the
 * facets use.
 *
 * A **thin preset over `Button`**, not a re-spelling, so there is one
 * button implementation. It fixes `variant="secondary" size="md"` and
 * adds the `active` facet state — verbatim the existing active look at
 * `list/FilterDropdown.tsx:80` (`border-accent bg-accent-muted
 * text-accent`), applied via the `className` escape hatch so it layers
 * over the secondary variant.
 *
 * Scope: the *button primitive* only. The toolbar re-grouping / IA
 * proposal (moving Advanced out of the facet row) is a separate ticket
 * and NOT here. When B4 migrates the six toolbar controls onto this,
 * the toolbar review §4a locators (`advanced-query-toggle`, `Filter
 * <Label>` names, `Refresh`/`Export` aria-labels + Export menu
 * semantics, `/Save as view/`) must be carried across unchanged.
 */
export interface ToolbarButtonProps extends Omit<ButtonProps, "variant"> {
  /** The facet is applied / the mode is on. Sets the selected look. */
  readonly active?: boolean;
}

/**
 * The active/selected facet look, verbatim from FilterDropdown.tsx:80.
 * Overrides the secondary variant's border/bg/text so a selected facet
 * reads as accent-tinted.
 */
export const TOOLBAR_ACTIVE =
  "border-accent bg-accent-muted text-accent hover:bg-accent-muted hover:text-accent";

/**
 * The secondary-variant utilities the active look must REPLACE. `cn`
 * (deliberately) does not resolve Tailwind conflicts — it concatenates —
 * so emitting both `bg-bg-surface`/`text-text-secondary` (from the
 * `secondary` variant) AND `bg-accent-muted`/`text-accent` (from
 * `TOOLBAR_ACTIVE`) leaves the winner to CSS source order, which drops
 * the active tint entirely (the Theme picker showed all three pills flat).
 *
 * `overrideActive` renders the button as `ghost` when active — the ghost
 * variant has no bg/border/text-at-rest utilities to conflict with — so
 * `TOOLBAR_ACTIVE` is the ONLY bg/border/text on the element and always
 * wins. Inactive keeps `secondary` (the neutral bordered pill).
 */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ active = false, className, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        // Active → ghost (no rest-state bg/border/text to fight the
        // accent look); inactive → secondary (the neutral pill).
        variant={active ? "ghost" : "secondary"}
        size="md"
        className={cn(active && "border " + TOOLBAR_ACTIVE, className)}
        {...rest}
      />
    );
  },
);

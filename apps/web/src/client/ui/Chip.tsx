import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * The plain pill/count/label object — kills the ~11 re-implementations
 * (Sidebar counts, Sprints/Milestones meta pills, Board count, Labels).
 *
 * NOT for the status/priority/label *cell* renderers in
 * `list/cells.tsx`: those carry def-resolution and degradation logic and
 * are the reuse model, not a migration target. `Chip` is for the plain
 * count/label pills with no def logic.
 *
 * K-6 / K-15: one height and one border treatment so a chip and an
 * add-chip line up, and so the chip reads correctly against a row-hover
 * background (it uses `bg-bg-muted`, not a translucent tint that would
 * shift under hover).
 *
 * Radius is `rounded-md` (§2.3). A `rounded-full` count badge is offered
 * as a `shape` variant rather than pre-deciding it away — spec §1.4 open
 * decision #2 flags the Sidebar's round count badge as the one place
 * `rounded-full` may read intentionally; `shape` lets the migration keep
 * it if Ken wants, default `square`.
 */
export type ChipVariant = "neutral" | "accent" | "count";
export type ChipShape = "square" | "pill";

export interface ChipProps {
  readonly variant?: ChipVariant;
  readonly shape?: ChipShape;
  readonly children: ReactNode;
  readonly title?: string;
  /** `data-testid` on the rendered `<span>` (declared, not spread). */
  readonly testId?: string;
}

const CHIP_BASE =
  "inline-flex items-center px-1.5 py-0.5 text-meta font-medium";

const CHIP_VARIANT: Record<ChipVariant, string> = {
  neutral: "bg-bg-muted text-text-secondary",
  accent: "bg-accent-muted text-accent",
  count: "bg-bg-muted text-text-secondary tabular-nums",
};

const CHIP_SHAPE: Record<ChipShape, string> = {
  square: "rounded-md",
  pill: "rounded-full",
};

export function Chip({
  variant = "neutral",
  shape = "square",
  children,
  title,
  testId,
}: ChipProps) {
  return (
    <span
      {...(title !== undefined ? { title } : {})}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      className={cn(CHIP_BASE, CHIP_SHAPE[shape], CHIP_VARIANT[variant])}
    >
      {children}
    </span>
  );
}

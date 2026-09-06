import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * The anchored, persistent error/warn/info/success block — kills the
 * repeated `rounded-md border border-danger-fg/30 bg-danger-fg/5 …`
 * block (~5× in TimelineView, CustomFields, EnumCollection).
 *
 * Distinct from `Toast` (transient, success-only, floating): a Callout is
 * an **anchored** message, the app's default failure surface (see
 * Toast.tsx's own note on why most errors anchor).
 *
 * `tone` has no default — the tone IS the point. `role` lets the caller
 * choose urgency ("alert" interrupts a screen reader, "status" is
 * polite); default "status". The feedback tokens are already dual-theme
 * and verified legible (responsive-theme T3).
 *
 * `data-testid` passes through to the wrapper.
 */
export type CalloutTone = "danger" | "warn" | "success" | "info";

export interface CalloutProps {
  readonly tone: CalloutTone;
  readonly children: ReactNode;
  readonly role?: "status" | "alert";
  readonly testId?: string;
  /** Escape hatch: layout/spacing only. */
  readonly className?: string;
}

const CALLOUT_BASE =
  "flex items-start gap-2 rounded-md border px-3 py-2 text-label";

const CALLOUT_TONE: Record<CalloutTone, string> = {
  danger: "border-danger-fg/30 bg-danger-bg text-danger-fg",
  warn: "border-warn-fg/30 bg-warn-bg text-warn-fg",
  success: "border-success-fg/30 bg-success-bg text-success-fg",
  info: "border-border-default bg-bg-muted text-text-secondary",
};

export function Callout({
  tone,
  children,
  role = "status",
  testId,
  className,
}: CalloutProps) {
  return (
    <div
      role={role}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      className={cn(CALLOUT_BASE, CALLOUT_TONE[tone], className)}
    >
      {children}
    </div>
  );
}

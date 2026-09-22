import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * The title row a list-like main view puts at the top of its `p-4`
 * shell (K-layout): a title (+ optional subtitle) on the left, a
 * right-aligned actions slot on the right, one consistent typography
 * and one consistent flex.
 *
 * Before this, each view rolled its own — `items-baseline` here,
 * `items-center` there, `gap-2`/`gap-3` mixed — so the title sat at a
 * different height as you moved between views. This standardizes on
 * `flex flex-wrap items-center justify-between gap-3`, and on the
 * title size the titled views already shared
 * (`text-[1.0714rem] font-semibold text-text-primary`).
 *
 * Scope, deliberately: this is the *plain* title row only. It is NOT a
 * bordered/card header (TaskDetail and MilestoneDetail keep those — a
 * border variant would be a different component with different padding
 * and background), and it is NOT a toolbar. A view whose top row has no
 * title (Board's chips row, Sprints' manage-link + checkbox, the
 * Timeline toolbar) has nothing to converge here and keeps its own row.
 *
 * `subtitle` and `actions` are nodes so callers can pass links, counts,
 * checkboxes, buttons — whatever the view needs — without this
 * primitive knowing about them. `as` picks the heading level for pages
 * nested under an outer `<h1>`; it defaults to `h1`.
 *
 * `data-testid` passes through to the wrapping `<header>`.
 */
export interface PageHeaderProps {
  /** The page title. A string is wrapped in the shared title element;
   *  a node is rendered as-is (for a title that carries its own markup). */
  readonly title: ReactNode;
  /** Optional line under the title — copy, a count, a manage link. */
  readonly subtitle?: ReactNode;
  /** Right-aligned slot: buttons, a checkbox, a menu. */
  readonly actions?: ReactNode;
  /** Heading level for the title. Defaults to `h1`. */
  readonly as?: "h1" | "h2";
  readonly testId?: string;
  /** Escape hatch: layout/spacing only. */
  readonly className?: string;
}

const TITLE_CLASS = "text-[1.0714rem] font-semibold text-text-primary";

export function PageHeader({
  title,
  subtitle,
  actions,
  as: Heading = "h1",
  testId,
  className,
}: PageHeaderProps) {
  return (
    <header
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* A string title gets the shared heading element; a node is
            already the caller's own heading and renders as passed. */}
        {typeof title === "string"
          ? <Heading className={TITLE_CLASS}>{title}</Heading>
          : title}
        {subtitle}
      </div>
      {/* A falsy `actions` (e.g. `cond && <…>`) renders nothing rather
          than an empty flex slot. */}
      {actions !== undefined && actions !== false && actions !== null && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";

import { cn } from "./cn.ts";

/**
 * A labelled form field with an optional secondary hint rendered as a
 * proper subtitle BELOW the label — smaller, `text-text-tertiary`, its own
 * line — rather than an em-dash run-on jammed onto the label (U9, Ken:
 * "an actual subtitle component with different font size/colour to create
 * visual hierarchy").
 *
 * The hint is associated with the control via `aria-describedby`: when the
 * child is a single element, `Field` clones it and injects the id, so a
 * screen reader reads the label and then the hint as the field's
 * description. Pass the control (a `TextField`, etc.) as the only child.
 *
 * Renders a real `<label>` wrapping the label text and control (native
 * label association), with the hint as a `<span>` between them so the
 * visual order is label → hint → control.
 */
export interface FieldProps {
  readonly label: ReactNode;
  /** Secondary help text shown as a subtitle below the label. */
  readonly hint?: ReactNode;
  /**
   * The form control. When it is a single element, it receives
   * `aria-describedby` pointing at the hint.
   */
  readonly children: ReactNode;
  /** Escape hatch for the outer wrapper: layout only. */
  readonly className?: string;
}

export function Field({ label, hint, children, className }: FieldProps) {
  const hintId = useId();
  const describe = hint !== undefined && hint !== null && hint !== "";

  // Associate the hint with the control when there is exactly one child
  // element, so `aria-describedby` lands on the real input.
  let control = children;
  if (describe && isValidElement(children)) {
    const element = children as ReactElement<{ "aria-describedby"?: string }>;
    const existing = element.props["aria-describedby"];
    control = cloneElement(element, {
      "aria-describedby":
        existing !== undefined && existing !== "" ? `${existing} ${hintId}` : hintId,
    });
  }

  return (
    <label className={cn("grid gap-1", className)}>
      <span className="text-body text-text-secondary">{label}</span>
      {describe ? (
        <span id={hintId} className="text-label text-text-tertiary">
          {hint}
        </span>
      ) : null}
      {control}
    </label>
  );
}

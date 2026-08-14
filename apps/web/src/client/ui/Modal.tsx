import { type ReactNode, useEffect } from "react";

/**
 * A minimal centered modal: a dimmed backdrop over the app and a
 * focusable panel. Closes on Escape or a backdrop click. Full focus
 * trapping + a11y polish lands in M4; this covers the M1.3 save-view
 * dialog's needs (a labelled dialog that can be dismissed).
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <h2 className="mb-3 text-[15px] font-semibold text-text-primary">{title}</h2>
        {children}
      </div>
    </div>
  );
}

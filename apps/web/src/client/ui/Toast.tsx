import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Transient success notices, stacked bottom-right.
 *
 * ## Why this exists at all, and why only for creation
 *
 * Almost every other failure and confirmation in this app renders *at
 * the control that caused it* — P4 and ERR-14, and the reason
 * `FieldFailureNotice`, `SaveIndicator` and the board's move-error
 * region are all anchored rather than floating. A toast is the wrong
 * shape for those: a two-second message that vanishes while the user
 * is still looking at the field is not an explanation.
 *
 * Creation is the exception NEW-12 names, and it is a narrow one. The
 * modal closes on success, so there is no control left to anchor to,
 * and the created task may not be visible in the view behind (NEW-13's
 * third bullet: a task that does not match the active filter must not
 * be spliced in). Something has to say the write landed and give a way
 * to reach it — that is the toast's whole job, and the "Open" link is
 * the escape hatch for exactly the non-matching case.
 *
 * This is deliberately **not** a general notification channel. It
 * takes no error variant, because an error that can point at its own
 * cause should.
 */

export interface Toast {
  readonly id: number;
  readonly message: string;
  /** Optional navigation action, rendered as a link-styled button. */
  readonly action?: { readonly label: string; readonly onAct: () => void } | undefined;
}

interface ToastApi {
  readonly toasts: readonly Toast[];
  /** Returns the new toast's id, so a caller can dismiss it early. */
  show: (message: string, action?: Toast["action"]) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

/**
 * How long a toast lives before dismissing itself.
 *
 * Exported so the test asserts the same constant the component is
 * built with rather than sleeping on a guess.
 */
export const TOAST_TIMEOUT_MS = 6_000;

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message: string, action?: Toast["action"]) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, action }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === undefined) {
    throw new Error("useToasts must be used inside a ToastProvider");
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      // `status`, not `alert`: a successful create is not an
      // interruption, and `alert` would cut off whatever a screen
      // reader was already saying.
      role="status"
      aria-live="polite"
      data-testid="toast-region"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly onDismiss: (id: number) => void;
}) {
  const { id } = toast;
  useEffect(() => {
    const timer = setTimeout(() => { onDismiss(id); }, TOAST_TIMEOUT_MS);
    return () => { clearTimeout(timer); };
  }, [id, onDismiss]);

  return (
    <div
      data-testid="toast"
      className="pointer-events-auto flex items-start gap-3 rounded-md border border-border-default bg-bg-surface-raised px-3 py-2.5 text-[13px] text-text-primary shadow-overlay"
    >
      {/* `min-w-0` + `truncate` is what makes NEW-22's long title
          truncate *for display only*. The stored title is untouched;
          this is the one place a shortened form is correct. */}
      <span className="min-w-0 flex-1 truncate" title={toast.message}>
        {toast.message}
      </span>
      {toast.action !== undefined && (
        <button
          type="button"
          data-testid="toast-action"
          onClick={() => {
            toast.action?.onAct();
            onDismiss(id);
          }}
          className="shrink-0 font-medium text-accent-fg underline underline-offset-2 hover:text-text-primary"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        data-testid="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => { onDismiss(id); }}
        className="shrink-0 text-text-tertiary hover:text-text-primary"
      >
        {"×"}
      </button>
    </div>
  );
}

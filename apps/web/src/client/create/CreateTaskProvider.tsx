import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { isTypingTarget } from "../shell/typingTarget.ts";
import { CreateTaskModal } from "./CreateTaskModal.tsx";

/**
 * Owns the create-task modal for the whole app.
 *
 * ## Why a provider rather than a modal per entry point
 *
 * NEW-1 requires the header `+`, a board column's "+ Add task" and the
 * `n` shortcut to open **the same** modal — "nothing is present in one
 * entry point and absent in another". Three call sites each rendering
 * their own `<CreateTaskModal>` would satisfy that only for as long as
 * nobody edited one of them. Here there is one instance and one piece
 * of state, so the three entry points cannot drift apart: they differ
 * only in the argument they pass.
 *
 * It also settles NEW-31 structurally. A single `open` flag cannot
 * produce two competing create modals, and the `n` handler refuses
 * while any dialog is already open, so the keyboard is never caught
 * between two focus traps.
 */

interface CreateTaskApi {
  /** Opens the modal, optionally pre-filling the status (NEW-3). */
  open: (opts?: { status?: string }) => void;
  readonly isOpen: boolean;
}

const CreateTaskContext = createContext<CreateTaskApi | undefined>(undefined);

export function useCreateTask(): CreateTaskApi {
  const ctx = useContext(CreateTaskContext);
  if (ctx === undefined) {
    throw new Error("useCreateTask must be used inside a CreateTaskProvider");
  }
  return ctx;
}

export function CreateTaskProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<{ status?: string } | null>(null);
  // NEW-4 / NEW-28: focus returns to whatever opened the modal. It is
  // captured at open time — once the dialog mounts and takes focus,
  // the trigger is no longer `document.activeElement`.
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((opts?: { status?: string }) => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
    setState(opts ?? {});
  }, []);

  const close = useCallback(() => { setState(null); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      // NEW-4's third bullet: inside a text input, `n` types the
      // letter. The guard is a shared helper with its own unit test —
      // see `typingTarget.ts` for why testing it through the modal
      // proves nothing.
      if (isTypingTarget(e.target)) return;
      // NEW-31: while any dialog owns focus, `n` is ignored rather
      // than stacking a second trap on top of the first.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return;
      e.preventDefault();
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
      setState({});
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);

  const api = useMemo(() => ({ open, isOpen: state !== null }), [open, state]);

  return (
    <CreateTaskContext.Provider value={api}>
      {children}
      {state !== null && (
        <CreateTaskModal
          {...(state.status !== undefined ? { initialStatus: state.status } : {})}
          onClose={close}
          returnFocusTo={opener.current}
        />
      )}
    </CreateTaskContext.Provider>
  );
}

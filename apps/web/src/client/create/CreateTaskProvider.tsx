import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

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

  // `n` is bound by the global shortcut registry
  // (`shell/shortcuts.ts`), which calls `open()` above. It used to be
  // a local listener here; moving it means the typing guard, the
  // dialog guard (NEW-31) and the modifier guard are applied by the
  // same code that applies them to every other global key, and the
  // binding is the same table the `?` reference renders from
  // (A11Y-4). `open` captures the opener itself, so focus still
  // returns to the trigger (NEW-28).
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

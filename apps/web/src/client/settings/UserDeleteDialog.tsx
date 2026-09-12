import type { UserProfile } from "@loctt/contracts";
import type { UseMutationResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client.ts";
import type {
  DeleteUserResult,
  DeleteUserVars,
} from "../api/hooks/useUserMutations.ts";
import { useUserReferences } from "../api/hooks/useUserMutations.ts";
import { DELETE_CONFIRM_WORD } from "../list/DeleteConfirmDialog.tsx";
import { Modal } from "../ui/Modal.tsx";

/**
 * PRU-42: deleting a user who is still referenced on tasks.
 *
 * The dialog shows the reference count split by role — assignee on N,
 * reporter on M — read *before* the user commits (`useUserReferences`),
 * because the delete guard's count only surfaces as an error. It states
 * plainly that delete is permanent and offers **archive** as the
 * reversible alternative in the same dialog, and it requires the same
 * typed-word confirmation used for permanent task deletes
 * (`DELETE_CONFIRM_WORD`), never a single OK.
 *
 * `deleteUser` refuses to leave a dangling reference (K21), so when the
 * user is referenced the confirm requires an explicit resolution —
 * remap those references onto another user, or unassign them — with no
 * default that silently orphans anything. A user with no references
 * skips that choice.
 */
export function UserDeleteDialog({
  user,
  others,
  mutation,
  onArchive,
  onClose,
}: {
  readonly user: UserProfile;
  /** Live users this one's references could be remapped onto. */
  readonly others: readonly UserProfile[];
  readonly mutation: UseMutationResult<DeleteUserResult, Error, DeleteUserVars>;
  /** Switch to the reversible path — archive instead of delete. */
  readonly onArchive: () => void;
  readonly onClose: () => void;
}) {
  const usage = useUserReferences(user.id);
  const assigneeCount = usage.data?.assignee ?? 0;
  const reporterCount = usage.data?.reporter ?? 0;
  const referenced = assigneeCount + reporterCount > 0;

  // "remap" (to a chosen user) or "unassign" (clear the field). No
  // default: a referenced user cannot be deleted until one is picked,
  // so nothing is silently orphaned.
  const [resolution, setResolution] = useState<
    { kind: "remap"; to: string } | { kind: "unassign" } | null
  >(null);

  const [typed, setTyped] = useState("");
  const confirmed = typed === DELETE_CONFIRM_WORD;

  // The delete succeeded — the row is already being invalidated away;
  // dismiss the dialog. On error it stays open to show the message.
  const { isSuccess } = mutation;
  useEffect(() => {
    if (isSuccess) onClose();
  }, [isSuccess, onClose]);

  // Block until the count has loaded (so we never delete a referenced
  // user while still believing they have none), until a resolution is
  // chosen for a referenced user, and until the word is typed.
  const blocked =
    mutation.isPending ||
    usage.isLoading ||
    (referenced && resolution === null) ||
    !confirmed;

  const envelope = mutation.error instanceof ApiError ? mutation.error.envelope : undefined;

  const submit = (): void => {
    if (blocked) return;
    mutation.mutate({
      id: user.id,
      ...(resolution?.kind === "remap" ? { remapTo: resolution.to } : {}),
      ...(resolution?.kind === "unassign" ? { unassign: true } : {}),
    });
  };

  return (
    <Modal title={`Delete user "${user.name}"?`} onClose={onClose}>
      <div className="grid gap-3" data-testid="user-delete-dialog">
        {/* The reference count, split by role where they differ. */}
        <p data-testid="user-delete-refcount" className="text-[0.9286rem] text-text-secondary">
          {usage.isLoading ? (
            "Counting task references…"
          ) : usage.isError ? (
            "Could not count task references."
          ) : referenced ? (
            <>
              <strong className="font-medium text-text-primary">{user.name}</strong> is
              the assignee on{" "}
              <strong className="font-medium text-text-primary">
                {assigneeCount} task{assigneeCount === 1 ? "" : "s"}
              </strong>{" "}
              and the reporter on{" "}
              <strong className="font-medium text-text-primary">
                {reporterCount} task{reporterCount === 1 ? "" : "s"}
              </strong>
              .
            </>
          ) : (
            <>
              <strong className="font-medium text-text-primary">{user.name}</strong> is
              not referenced on any task.
            </>
          )}
        </p>

        {referenced && (
          <fieldset className="border-0 p-0" data-testid="user-delete-resolution">
            <legend className="mb-1 text-[0.9286rem] text-text-secondary">
              What should happen to those references?
            </legend>
            {others.map(o => (
              <label key={o.id} className="flex items-center gap-2 py-0.5 text-[0.9286rem]">
                <input
                  type="radio"
                  name="user-delete-resolution"
                  data-testid={`user-delete-remap-${o.id}`}
                  checked={resolution?.kind === "remap" && resolution.to === o.id}
                  onChange={() => { setResolution({ kind: "remap", to: o.id }); }}
                />
                <span>
                  Reassign them to <strong className="font-medium">{o.name}</strong>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 py-0.5 text-[0.9286rem]">
              <input
                type="radio"
                name="user-delete-resolution"
                data-testid="user-delete-unassign"
                checked={resolution?.kind === "unassign"}
                onChange={() => { setResolution({ kind: "unassign" }); }}
              />
              <span>Clear the assignee/reporter on those tasks</span>
            </label>
          </fieldset>
        )}

        {/* Permanent, and archive is the reversible alternative — stated
            in the same dialog (PRU-42). */}
        <p className="text-[0.8571rem] text-text-tertiary">
          Deleting a user is <strong className="font-medium text-text-secondary">permanent</strong> and
          removes their profile from disk.{" "}
          <button
            type="button"
            data-testid="user-delete-archive-instead"
            onClick={onArchive}
            className="underline underline-offset-2 hover:text-text-secondary"
          >
            Archive instead
          </button>{" "}
          to hide them reversibly while keeping their task references intact.
        </p>

        <label className="grid gap-1 text-[0.8571rem] font-medium text-text-secondary">
          <span>
            Type <code className="font-mono text-text-primary">{DELETE_CONFIRM_WORD}</code> to confirm
          </span>
          <input
            type="text"
            data-testid="user-delete-confirm-input"
            value={typed}
            onChange={e => { setTyped(e.target.value); }}
            aria-label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
            className="w-full rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-1.5 font-mono text-[0.9286rem] text-text-primary"
          />
        </label>

        {mutation.isError && (
          <div role="alert" data-testid="user-delete-error" className="text-[0.8571rem] text-danger-fg">
            <p>{envelope?.message ?? mutation.error.message}</p>
            <p className="mt-1 text-text-secondary">The user has not been deleted.</p>
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            data-testid="user-delete-cancel"
            onClick={onClose}
            className="h-8 rounded-md px-3 text-[0.9286rem] text-text-secondary hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="user-delete-confirm"
            disabled={blocked}
            onClick={submit}
            className="h-8 rounded-md bg-danger-fg px-3 text-[0.9286rem] font-medium text-accent-contrast disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

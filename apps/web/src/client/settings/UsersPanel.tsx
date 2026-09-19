import type { UserProfile } from "@loctt/contracts";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useUsers } from "../api/hooks/sidebarData.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import {
  useArchiveUser,
  useCreateUser,
  useDeleteUser,
  useRemoveAvatar,
  useUpdateUser,
  useUploadAvatar,
} from "../api/hooks/useUserMutations.ts";
import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import { UserAvatar } from "../ui/UserAvatar.tsx";
import { AvatarCropper } from "./AvatarCropper.tsx";
import { AvatarRejected, type DecodedImage, decodeImageFile } from "./prepareAvatar.ts";
import { UserDeleteDialog } from "./UserDeleteDialog.tsx";
import { supportedTimezones } from "./workflowEdits.ts";

/**
 * Settings → Users (PRU-11, PRU-12, PRU-13, PRU-23, PRU-26, PRU-27,
 * PRU-38, PRU-39, PRU-40, PRU-42).
 */

/**
 * B2 bug 1: a light client-side email gate. The server is the
 * authority (it runs the contract's `z.email()` and returns a 400 with
 * `field: "email"`), but a bad value must never even reach it silently
 * — a blocked Save with a named reason is a better first line than a
 * round-trip. Deliberately permissive: it only catches the obvious
 * "no @ / no dot / has spaces" shapes so it never blocks an address the
 * server would accept. An empty string is not invalid here — blank
 * clears the email.
 */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** PRU-23: qualify duplicate display names so picking is not a coin flip. */
export function qualifier(
  user: UserProfile,
  all: readonly UserProfile[],
): string | undefined {
  const sameName = all.filter(u => u.name === user.name);
  if (sameName.length < 2) return undefined;
  const emails = new Set(sameName.map(u => u.email ?? ""));
  if (emails.size === sameName.length && (user.email ?? "").length > 0) {
    return user.email;
  }
  return user.id.slice(-6);
}

function AvatarCell({ user }: { readonly user: UserProfile }) {
  // The shared chip, with per-branch test ids because these specs
  // (PRU-31/38) assert on *which* branch shows.
  return (
    <UserAvatar
      user={user}
      sizeClass="h-8 w-8 text-[0.7857rem]"
      className="font-medium"
      imageTestId={`user-avatar-${user.id}`}
      initialsTestId={`user-initials-${user.id}`}
    />
  );
}

function AvatarUpload({ user }: { readonly user: UserProfile }) {
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // The blob-URL preview of what was actually cropped and posted
  // (PRU-13: the preview renders from the crop, not the raw file).
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [prepared, setPrepared] = useState<File | undefined>(undefined);
  // The decoded source while the cropper is open (its `animated` flag
  // lives on the decoded image, not duplicated here).
  const [cropping, setCropping] = useState<
    { decoded: DecodedImage; fileName: string } | undefined
  >(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke any live object URL on unmount: the preview blob and the
  // decoded source (a full-resolution bitmap) both leak otherwise if
  // the row unmounts with the cropper or a preview still open. Refs so
  // the cleanup sees the latest values without re-subscribing.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const croppingRef = useRef(cropping);
  croppingRef.current = cropping;
  useEffect(() => () => {
    if (previewRef.current !== undefined) URL.revokeObjectURL(previewRef.current);
    croppingRef.current?.decoded.revoke();
  }, []);

  const hasAvatar = typeof user.avatar === "string" && user.avatar.length > 0;

  const pick = async (file: File) => {
    setProblem(undefined);
    upload.reset();
    try {
      // Validate + decode BEFORE opening the cropper. PRU-38/30 (type),
      // PRU-39 (corrupt decode) reject here with no POST and no cropper.
      const decoded = await decodeImageFile(file);
      setCropping({ decoded, fileName: file.name });
    } catch (err) {
      if (err instanceof AvatarRejected) {
        setProblem(err.message);
        return;
      }
      throw err;
    }
  };

  const post = (file: File) => {
    setPrepared(file);
    if (preview !== undefined) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    upload.mutate({ id: user.id, file });
  };

  const closeCropper = () => {
    cropping?.decoded.revoke();
    setCropping(undefined);
    // Reset the input so re-picking the same file fires onChange again.
    if (inputRef.current) inputRef.current.value = "";
  };

  const serverMessage = upload.error instanceof ApiError
    ? upload.error.envelope?.message ?? upload.error.message
    : upload.error?.message;

  return (
    <div className="grid gap-1">
      {/* PRU-47: the avatar is set through a proper control — a Button
          that triggers a visually-hidden file input — not a raw
          `<input type="file">`. The input keeps its testid and the
          upload/remove endpoints are unchanged. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        data-testid={`user-avatar-input-${user.id}`}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
        }}
        className="sr-only"
      />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          testId={`user-avatar-change-${user.id}`}
          onClick={() => { inputRef.current?.click(); }}
        >
          {hasAvatar ? "Change avatar" : "Add avatar"}
        </Button>
        {hasAvatar && (
          <Button
            size="sm"
            variant="ghost"
            testId={`user-avatar-remove-${user.id}`}
            disabled={remove.isPending}
            onClick={() => {
              setProblem(undefined);
              if (preview !== undefined) { URL.revokeObjectURL(preview); setPreview(undefined); }
              remove.mutate({ id: user.id });
            }}
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
      {preview !== undefined && (
        <img
          src={preview}
          alt=""
          data-testid={`user-avatar-preview-${user.id}`}
          className="h-12 w-12 rounded-full object-cover"
        />
      )}
      {problem !== undefined && (
        <p role="alert" data-testid={`user-avatar-problem-${user.id}`} className="text-[0.7857rem] text-danger-fg">
          {problem}
        </p>
      )}
      {upload.isError && (
        <div role="alert" data-testid={`user-avatar-error-${user.id}`} className="text-[0.7857rem] text-danger-fg">
          {/* PRU-40: prepared but not saved; the previous avatar stands. */}
          <p>
            The image was prepared but not saved: {serverMessage}. Your previous
            avatar is still in effect.
          </p>
          <button
            type="button"
            data-testid={`user-avatar-retry-${user.id}`}
            onClick={() => {
              // PRU-40: re-post the already-cropped file, no re-pick.
              if (prepared) upload.mutate({ id: user.id, file: prepared });
            }}
            className="mt-1 h-7 rounded-md border border-border-default px-2 text-[0.8571rem] text-text-primary"
          >
            Retry
          </button>
        </div>
      )}
      {cropping !== undefined && (
        <AvatarCropper
          decoded={cropping.decoded}
          fileName={cropping.fileName}
          animated={cropping.decoded.animated}
          testIdSuffix={user.id}
          onConfirm={result => {
            post(result.file);
            closeCropper();
          }}
          onCancel={closeCropper}
        />
      )}
    </div>
  );
}

/**
 * PRU-47 / SET-51: edit an existing user's name, email and timezone in a
 * modal dialog wired to `PUT /api/users/:id` (`useUpdateUser`). The row
 * is read-only by default; all editing happens here. A failed Save keeps
 * the dialog open with an anchored `Callout` error and the value
 * un-committed; Cancel discards.
 */
function EditUserDialog({
  user,
  onClose,
}: {
  readonly user: UserProfile;
  readonly onClose: () => void;
}) {
  const update = useUpdateUser();
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [timezone, setTimezone] = useState(user.timezone ?? "");

  // The current value must be selectable even if it is not in the
  // runtime's zone list (a hand-edited or renamed zone); offer it first.
  const zones = supportedTimezones();
  const zoneOptions = timezone.length > 0 && !zones.includes(timezone)
    ? [timezone, ...zones]
    : zones;

  const emailOk = looksLikeEmail(email);
  // B2 bug 2: timezone is effectively required. Core's write path
  // (`updateUser`) has no "clear" signal — it does `timezone ??
  // existing`, so an empty value keeps the old zone rather than clearing
  // it. Offering a "(none)" option therefore lied: it reported success
  // and kept the old zone. Rather than thread a clear through core (and
  // its CLI/MCP twins), the option is removed; a user whose zone is
  // somehow blank must pick a real one before Save (A-decision).
  const tzOk = timezone.trim().length > 0;
  const blocked = name.trim().length === 0 || !emailOk || !tzOk || update.isPending;

  const serverMessage = update.error instanceof ApiError
    ? update.error.envelope?.message ?? update.error.message
    : update.error?.message;

  const save = () => {
    update.mutate(
      {
        id: user.id,
        name: name.trim(),
        // Empty clears the email (server accepts null); a value sets it.
        email: email.trim().length > 0 ? email.trim() : null,
        ...(timezone.trim().length > 0 ? { timezone: timezone.trim() } : {}),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title="Edit user"
      onClose={onClose}
      testId={`user-edit-dialog-${user.id}`}
      actions={
        <DialogActions>
          <Button variant="ghost" testId={`user-edit-cancel-${user.id}`} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={`user-edit-save-${user.id}`}
            disabled={blocked}
            onClick={save}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-[0.9286rem]">
          <span className="text-text-secondary">Display name</span>
          <TextField
            data-testid={`user-edit-name-${user.id}`}
            value={name}
            onChange={e => { setName(e.target.value); }}
          />
        </label>
        <label className="grid gap-1 text-[0.9286rem]">
          <span className="text-text-secondary">Email</span>
          <TextField
            data-testid={`user-edit-email-${user.id}`}
            value={email}
            invalid={!emailOk}
            onChange={e => { setEmail(e.target.value); }}
          />
          {!emailOk && (
            <p role="alert" data-testid={`user-edit-email-problem-${user.id}`} className="text-[0.7857rem] text-danger-fg">
              Enter a valid email address, or leave it blank.
            </p>
          )}
        </label>
        <label className="grid gap-1 text-[0.9286rem]">
          <span className="text-text-secondary">Timezone</span>
          <Select
            data-testid={`user-edit-timezone-${user.id}`}
            value={timezone}
            aria-invalid={!tzOk}
            onChange={e => { setTimezone(e.target.value); }}
          >
            {/* B2 bug 2: no "(none)" option. It cannot clear the zone
                (core keeps the old one), so offering it reported a save
                that never happened. A blank-zone user sees a disabled
                placeholder and must pick a real zone. */}
            {!tzOk && (
              <option value="" disabled>Select a timezone…</option>
            )}
            {zoneOptions.map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </Select>
          {!tzOk && (
            <p role="alert" data-testid={`user-edit-timezone-problem-${user.id}`} className="text-[0.7857rem] text-danger-fg">
              Pick a timezone.
            </p>
          )}
        </label>
        {update.isError && (
          <Callout
            tone="danger"
            role="alert"
            testId={`user-edit-error-${user.id}`}
          >
            {/* SET-51: anchored, the dialog stays open, the value is
                un-committed, and the next action is named. */}
            The changes were not saved: {serverMessage}. Fix the values and
            try again, or Cancel to discard.
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

function CreateUserForm({ onDone }: { readonly onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const create = useCreateUser();

  const emailOk = looksLikeEmail(email);
  const blocked = name.trim().length === 0 || !emailOk || create.isPending;

  return (
    <div className="grid gap-3">
      {/* PRU-11: name, email, timezone — and no ID field. */}
      <label className="grid gap-1 text-[0.9286rem]">
        <span className="text-text-secondary">Display name</span>
        <input
          data-testid="user-create-name"
          value={name}
          onChange={e => { setName(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[0.9286rem]"
        />
      </label>
      <label className="grid gap-1 text-[0.9286rem]">
        <span className="text-text-secondary">Email</span>
        <input
          data-testid="user-create-email"
          value={email}
          onChange={e => { setEmail(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[0.9286rem]"
        />
        {!emailOk && (
          <p role="alert" data-testid="user-create-email-problem" className="text-[0.7857rem] text-danger-fg">
            Enter a valid email address, or leave it blank.
          </p>
        )}
      </label>
      <label className="grid gap-1 text-[0.9286rem]">
        <span className="text-text-secondary">Timezone</span>
        <input
          data-testid="user-create-timezone"
          value={timezone}
          onChange={e => { setTimezone(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[0.9286rem]"
        />
      </label>
      {create.isError && (
        <p role="alert" data-testid="user-create-error" className="text-[0.8571rem] text-danger-fg">
          {create.error instanceof ApiError
            ? create.error.envelope?.message ?? create.error.message
            : create.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-3 text-[0.9286rem] text-text-secondary">
          Cancel
        </button>
        <button
          type="button"
          data-testid="user-create-submit"
          disabled={blocked}
          onClick={() => {
            create.mutate(
              {
                name: name.trim(),
                ...(email.trim().length > 0 ? { email: email.trim() } : {}),
                ...(timezone.trim().length > 0 ? { timezone: timezone.trim() } : {}),
              },
              { onSuccess: onDone },
            );
          }}
          className="h-8 rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create user"}
        </button>
      </div>
    </div>
  );
}

/**
 * The Edit / Archive / Delete action group for one user row, shared by the
 * table (>= sm) and the mobile card (< sm). The three buttons live in a
 * flex row with `whitespace-nowrap` so they stay together on one line and
 * never wrap mid-word or stack raggedly (Ken's report). The self-user note
 * sits below, width-capped, so it wraps to a tidy block instead of a tall
 * single-word column.
 */
function UserRowActions({
  user,
  isSelf,
  align = "end",
  onEdit,
  onArchive,
  onDelete,
}: {
  readonly user: UserProfile;
  readonly isSelf: boolean;
  /** Table right-aligns the actions; the card left-aligns them. */
  readonly align?: "start" | "end";
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className={align === "end" ? "text-right" : "text-left"}>
      <div className={[
        "flex items-center gap-1 whitespace-nowrap",
        align === "end" ? "justify-end" : "justify-start",
      ].join(" ")}>
        {/* PRU-47: the row is read-only; identity fields are edited in a
            per-row Edit dialog. */}
        <button
          type="button"
          data-testid={`user-edit-${user.id}`}
          onClick={onEdit}
          className="h-8 rounded-md px-2 text-[0.9286rem] text-text-secondary hover:bg-bg-muted"
        >
          Edit
        </button>
        {/* PRU-26: archiving yourself is disabled, not error-on-click, and
            the reason is on the control. */}
        <button
          type="button"
          data-testid={`user-archive-${user.id}`}
          disabled={isSelf}
          title={isSelf
            ? "You cannot archive the user you are acting as. Switch to another user first."
            : undefined}
          onClick={onArchive}
          className="h-8 rounded-md px-2 text-[0.9286rem] text-text-secondary hover:bg-bg-muted disabled:opacity-50"
        >
          {user.archived === true ? "Unarchive" : "Archive"}
        </button>
        {/* PRU-42: delete is the permanent path, offered beside archive.
            Disabled for the active user for the same reason archive is —
            core refuses to delete whoever you are acting as. */}
        <button
          type="button"
          data-testid={`user-delete-${user.id}`}
          disabled={isSelf}
          title={isSelf
            ? "You cannot delete the user you are acting as. Switch to another user first."
            : undefined}
          onClick={onDelete}
          className="h-8 rounded-md px-2 text-[0.9286rem] text-danger-fg hover:bg-bg-muted disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {isSelf && (
        <p
          data-testid={`user-archive-blocked-${user.id}`}
          className={[
            "mt-1 max-w-[16rem] text-[0.7857rem] text-text-tertiary",
            align === "end" ? "ml-auto" : "",
          ].join(" ")}
        >
          You cannot archive the user you are acting as. Switch users first.
        </p>
      )}
    </div>
  );
}

export function UsersPanel() {
  const users = useUsers();
  const current = useCurrentUser();
  const archive = useArchiveUser();
  const del = useDeleteUser();
  // Below `sm` the four-column table (avatar/name/email/3 actions) does not
  // fit — the actions wrapped raggedly and detached from their row (Ken's
  // report). Render a stacked card per user instead.
  const isNarrow = useIsNarrow();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState<UserProfile | null>(null);

  if (users.isError) {
    return (
      <div className="p-8">
        <ErrorState
          error={users.error}
          onRetry={() => { void users.refetch(); }}
          context="the users list"
        />
      </div>
    );
  }
  if (users.isLoading) {
    return <LoadingState>Loading users…</LoadingState>;
  }

  const items = users.data?.items ?? [];
  const currentId = current.data?.id;

  return (
    <div className="p-8" data-testid="settings-users">
      <h1 className="mb-1 text-lg font-semibold">Users</h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Identities that can be assigned work and attributed activity.
      </p>

      {!isNarrow && (
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
            <th className="py-1 pr-3 font-medium">Avatar</th>
            <th className="py-1 pr-3 font-medium">Name</th>
            <th className="py-1 pr-3 font-medium">Email</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map(u => {
            const isSelf = u.id === currentId;
            const qual = qualifier(u, items);
            return (
              <tr
                key={u.id}
                data-testid={`user-row-${u.id}`}
                data-archived={u.archived === true ? "true" : "false"}
                data-self={isSelf ? "true" : "false"}
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <AvatarCell user={u} />
                    <AvatarUpload user={u} />
                  </div>
                </td>
                <td className="py-2 pr-3 text-[0.9286rem]">
                  {u.name}
                  {u.archived === true && (
                    <span data-testid={`user-archived-marker-${u.id}`} className="ml-1 text-text-tertiary">
                      (archived)
                    </span>
                  )}
                  {qual !== undefined && (
                    <span data-testid={`user-qualifier-${u.id}`} className="ml-1 text-[0.7857rem] text-text-tertiary">
                      {qual}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-[0.9286rem] text-text-secondary">{u.email ?? ""}</td>
                <td className="py-2 align-top">
                  <UserRowActions
                    user={u}
                    isSelf={isSelf}
                    onEdit={() => { setEditing(u); }}
                    onArchive={() => { archive.mutate({ id: u.id, archived: u.archived !== true }); }}
                    onDelete={() => { del.reset(); setDeleting(u); }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      {/* Mobile (< sm): a stacked card per user. The table's four columns
          did not fit and the actions wrapped raggedly, detaching from
          their row (Ken's report). Same data + the shared UserRowActions,
          only the layout differs. */}
      {isNarrow && (
        <ul className="flex flex-col gap-2" data-testid="user-cards">
          {items.map(u => {
            const isSelf = u.id === currentId;
            const qual = qualifier(u, items);
            return (
              <li
                key={u.id}
                data-testid={`user-card-${u.id}`}
                data-self={isSelf ? "true" : "false"}
                className="rounded-lg border border-border-default p-3"
              >
                <div className="flex items-center gap-2">
                  <AvatarCell user={u} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.9286rem] text-text-primary">
                      {u.name}
                      {u.archived === true && (
                        <span className="ml-1 text-text-tertiary">(archived)</span>
                      )}
                      {qual !== undefined && (
                        <span className="ml-1 text-[0.7857rem] text-text-tertiary">{qual}</span>
                      )}
                    </div>
                    {u.email !== undefined && u.email !== "" && (
                      <div className="truncate text-[0.8571rem] text-text-secondary">{u.email}</div>
                    )}
                  </div>
                  <AvatarUpload user={u} />
                </div>
                <div className="mt-2 border-t border-border-subtle pt-2">
                  <UserRowActions
                    user={u}
                    isSelf={isSelf}
                    align="start"
                    onEdit={() => { setEditing(u); }}
                    onArchive={() => { archive.mutate({ id: u.id, archived: u.archived !== true }); }}
                    onDelete={() => { del.reset(); setDeleting(u); }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <button
          type="button"
          data-testid="user-create-open"
          onClick={() => { setCreating(true); }}
          className="h-8 rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast"
        >
          New user
        </button>
      </div>

      {creating && (
        <Modal title="New user" onClose={() => { setCreating(false); }}>
          <CreateUserForm onDone={() => { setCreating(false); }} />
        </Modal>
      )}

      {editing !== null && (
        <EditUserDialog
          user={editing}
          onClose={() => { setEditing(null); }}
        />
      )}

      {deleting !== null && (
        <UserDeleteDialog
          user={deleting}
          others={items.filter(u => u.id !== deleting.id && u.archived !== true)}
          mutation={del}
          onArchive={() => {
            archive.mutate({ id: deleting.id, archived: true });
            setDeleting(null);
          }}
          onClose={() => { setDeleting(null); }}
        />
      )}
    </div>
  );
}

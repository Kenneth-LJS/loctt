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
  useUploadAvatar,
} from "../api/hooks/useUserMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { UserAvatar } from "../ui/UserAvatar.tsx";
import { AvatarCropper } from "./AvatarCropper.tsx";
import { AvatarRejected, type DecodedImage, decodeImageFile } from "./prepareAvatar.ts";
import { UserDeleteDialog } from "./UserDeleteDialog.tsx";

/**
 * Settings → Users (PRU-11, PRU-12, PRU-13, PRU-23, PRU-26, PRU-27,
 * PRU-38, PRU-39, PRU-40, PRU-42).
 */

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
      sizeClass="h-8 w-8 text-[11px]"
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        data-testid={`user-avatar-input-${user.id}`}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
        }}
        className="text-[12px]"
      />
      {hasAvatar && (
        <button
          type="button"
          data-testid={`user-avatar-remove-${user.id}`}
          disabled={remove.isPending}
          onClick={() => {
            setProblem(undefined);
            if (preview !== undefined) { URL.revokeObjectURL(preview); setPreview(undefined); }
            remove.mutate({ id: user.id });
          }}
          className="h-7 justify-self-start rounded-md border border-border-default px-2 text-[12px] text-text-secondary disabled:opacity-50"
        >
          {remove.isPending ? "Removing…" : "Remove"}
        </button>
      )}
      {preview !== undefined && (
        <img
          src={preview}
          alt=""
          data-testid={`user-avatar-preview-${user.id}`}
          className="h-12 w-12 rounded-full object-cover"
        />
      )}
      {problem !== undefined && (
        <p role="alert" data-testid={`user-avatar-problem-${user.id}`} className="text-[11px] text-danger-fg">
          {problem}
        </p>
      )}
      {upload.isError && (
        <div role="alert" data-testid={`user-avatar-error-${user.id}`} className="text-[11px] text-danger-fg">
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
            className="mt-1 h-7 rounded-md border border-border-default px-2 text-[12px] text-text-primary"
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

function CreateUserForm({ onDone }: { readonly onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const create = useCreateUser();

  const blocked = name.trim().length === 0 || create.isPending;

  return (
    <div className="grid gap-3">
      {/* PRU-11: name, email, timezone — and no ID field. */}
      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">Display name</span>
        <input
          data-testid="user-create-name"
          value={name}
          onChange={e => { setName(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
        />
      </label>
      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">Email</span>
        <input
          data-testid="user-create-email"
          value={email}
          onChange={e => { setEmail(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
        />
      </label>
      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">Timezone</span>
        <input
          data-testid="user-create-timezone"
          value={timezone}
          onChange={e => { setTimezone(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 font-mono text-[13px]"
        />
      </label>
      {create.isError && (
        <p role="alert" data-testid="user-create-error" className="text-[12px] text-danger-fg">
          {create.error instanceof ApiError
            ? create.error.envelope?.message ?? create.error.message
            : create.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-3 text-[13px] text-text-secondary">
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
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create user"}
        </button>
      </div>
    </div>
  );
}

export function UsersPanel() {
  const users = useUsers();
  const current = useCurrentUser();
  const archive = useArchiveUser();
  const del = useDeleteUser();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserProfile | null>(null);

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
    return <div className="p-8 text-[13px] text-text-tertiary">Loading users…</div>;
  }

  const items = users.data?.items ?? [];
  const currentId = current.data?.id;

  return (
    <div className="p-8" data-testid="settings-users">
      <h1 className="mb-1 text-lg font-semibold">Users</h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Identities that can be assigned work and attributed activity.
      </p>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-tertiary">
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
                <td className="py-2 pr-3 text-[13px]">
                  {u.name}
                  {u.archived === true && (
                    <span data-testid={`user-archived-marker-${u.id}`} className="ml-1 text-text-tertiary">
                      (archived)
                    </span>
                  )}
                  {qual !== undefined && (
                    <span data-testid={`user-qualifier-${u.id}`} className="ml-1 text-[11px] text-text-tertiary">
                      {qual}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-[13px] text-text-secondary">{u.email ?? ""}</td>
                <td className="py-2 text-right">
                  {/* PRU-26: archiving yourself is disabled, not
                      error-on-click, and the reason is on the control. */}
                  <button
                    type="button"
                    data-testid={`user-archive-${u.id}`}
                    disabled={isSelf}
                    title={isSelf
                      ? "You cannot archive the user you are acting as. Switch to another user first."
                      : undefined}
                    onClick={() => {
                      archive.mutate({ id: u.id, archived: u.archived !== true });
                    }}
                    className="h-8 rounded-md px-2 text-[13px] text-text-secondary hover:bg-bg-muted disabled:opacity-50"
                  >
                    {u.archived === true ? "Unarchive" : "Archive"}
                  </button>
                  {/* PRU-42: delete is the permanent path, offered
                      beside archive. Disabled for the active user for
                      the same reason archive is — core refuses to
                      delete whoever you are acting as. */}
                  <button
                    type="button"
                    data-testid={`user-delete-${u.id}`}
                    disabled={isSelf}
                    title={isSelf
                      ? "You cannot delete the user you are acting as. Switch to another user first."
                      : undefined}
                    onClick={() => {
                      del.reset();
                      setDeleting(u);
                    }}
                    className="ml-1 h-8 rounded-md px-2 text-[13px] text-danger-fg hover:bg-bg-muted disabled:opacity-50"
                  >
                    Delete
                  </button>
                  {isSelf && (
                    <p
                      data-testid={`user-archive-blocked-${u.id}`}
                      className="text-[11px] text-text-tertiary"
                    >
                      You cannot archive the user you are acting as. Switch
                      users first.
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4">
        <button
          type="button"
          data-testid="user-create-open"
          onClick={() => { setCreating(true); }}
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast"
        >
          New user
        </button>
      </div>

      {creating && (
        <Modal title="New user" onClose={() => { setCreating(false); }}>
          <CreateUserForm onDone={() => { setCreating(false); }} />
        </Modal>
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

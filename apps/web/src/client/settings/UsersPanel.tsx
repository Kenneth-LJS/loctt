import type { UserProfile } from "@loctt/contracts";
import { useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useUsers } from "../api/hooks/sidebarData.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import {
  useArchiveUser,
  useCreateUser,
  useUploadAvatar,
} from "../api/hooks/useUserMutations.ts";
import { avatarPalette, initials } from "../ui/avatar.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { AvatarRejected, compressImage } from "./compressImage.ts";

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
  const hasAvatar = typeof user.avatar === "string" && user.avatar.length > 0;
  if (hasAvatar) {
    return (
      <img
        src={`/api/users/${encodeURIComponent(user.id)}/avatar`}
        alt=""
        data-testid={`user-avatar-${user.id}`}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      data-testid={`user-initials-${user.id}`}
      className={`grid h-8 w-8 place-items-center rounded-full text-[11px] font-medium ${avatarPalette(user.id)}`}
    >
      {initials(user.name)}
    </span>
  );
}

function AvatarUpload({ user }: { readonly user: UserProfile }) {
  const upload = useUploadAvatar();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [prepared, setPrepared] = useState<File | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File) => {
    setProblem(undefined);
    try {
      const result = await compressImage(file);
      setPrepared(result.file);
      // PRU-13: the preview renders from the compressed result, not
      // the original file.
      setPreview(URL.createObjectURL(result.file));
      upload.mutate({ id: user.id, file: result.file });
    } catch (err) {
      if (err instanceof AvatarRejected) {
        // PRU-38/PRU-39: rejected client-side; no POST was made and the
        // existing avatar is untouched.
        setProblem(err.message);
        return;
      }
      throw err;
    }
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
              if (prepared) upload.mutate({ id: user.id, file: prepared });
            }}
            className="mt-1 h-7 rounded-md border border-border-default px-2 text-[12px] text-text-primary"
          >
            Retry
          </button>
        </div>
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
  const [creating, setCreating] = useState(false);

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
    </div>
  );
}

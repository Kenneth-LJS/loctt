import type { AttachmentResponse } from "@loctt/contracts";
import { useCallback, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  oversizeMessage,
  useDeleteAttachment,
  useUploadAttachment,
} from "../api/hooks/useAttachments.ts";
import { displayMime, familyForMime, glyphFor } from "./icon.ts";

/**
 * The task detail page's Attachments section (M2.5b — REL-35..41).
 *
 * ## Everything renders from the file, nothing from an intent
 *
 * The tiles come from `GET /api/tasks/:ref`'s `attachments`, which the
 * server builds by reading the directory. No optimistic tile: the
 * server decides the stored name (it takes the basename — REL-36),
 * whether the write collided (REL-39) and whether the file was legal.
 * A tile drawn before the answer would carry the wrong name as often
 * as the right one.
 *
 * The **queue** is a different thing and is deliberately local: a row
 * per file in a drop, each showing its own outcome. It is visibly not
 * the grid, and a queued row never claims to be an attachment.
 *
 * ## Per-file outcome, one request each (REL-40)
 *
 * A twenty-file drop becomes twenty sequential POSTs. Each row settles
 * on its own, and a failure in the middle is recorded on its own row
 * while the loop carries on — "one failure does not abort the
 * remaining uploads" is a property of this loop, so the `catch` is
 * inside it and there is no early return anywhere in the body.
 *
 * ## The size cap is checked here first (REL-35)
 *
 * The browser knows the name and the byte count before it sends
 * anything, so an oversized file is refused locally, naming the file,
 * its size and the cap in the user's units — which the server's
 * `52428800 bytes` envelope does not. Nothing is sent, which satisfies
 * the "rejected before any bytes are written" bullet more strongly
 * than a server refusal can. The server check stays as the guard
 * against a client that skips this one.
 *
 * ## A collision asks, it does not decide (REL-39)
 *
 * The server answers 409 rather than overwriting. The panel turns that
 * into two explicit choices on the row — Replace, which re-sends with
 * `?force=true`, and Cancel, which drops the row and leaves the file
 * on disk untouched. Neither happens without a click.
 */
export function AttachmentsPanel({
  taskRef,
  attachments,
  attachmentsError,
  onRetry,
}: {
  readonly taskRef: string;
  readonly attachments: readonly AttachmentResponse[];
  /**
   * Set when the attachments directory could not be read (REL-49).
   * The list is empty in that case for the same reason it is empty
   * when there are none — so without this the section renders "No
   * attachments on this task yet.", which is a claim about the disk
   * that nothing verified. `show.ts` degrades rather than throwing so
   * the rest of the task still renders; the price is that the caller
   * must tell the two apart.
   */
  readonly attachmentsError?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}): React.JSX.Element {
  const upload = useUploadAttachment(taskRef);
  const del = useDeleteAttachment(taskRef);

  const [queue, setQueue] = useState<readonly QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  /** Per-attachment removal failure, keyed by name (P4: at the tile). */
  const [removeError, setRemoveError] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Monotonic row ids. Two files in one drop can share a name (from
   * different directories), so the name is not a key.
   */
  const nextId = useRef(0);

  const patch = useCallback((id: number, next: Partial<QueueItem>): void => {
    setQueue(prev => prev.map(q => (q.id === id ? { ...q, ...next } : q)));
  }, []);

  /**
   * One upload attempt. Never throws: REL-40's "one failure does not
   * abort the remaining uploads" is exactly this — the caller's loop
   * must not see an exception.
   */
  const attempt = useCallback(
    async (id: number, file: File, force: boolean): Promise<void> => {
      patch(id, { state: "pending", message: undefined });
      try {
        const result = await upload.mutateAsync({ file, force });
        patch(id, {
          state: "done",
          // The name the server stored, which is not always the name
          // sent — REL-36 sanitises `a/b.txt` to `b.txt`, and saying
          // so is the honest thing.
          name: result.name,
          size: result.size,
          message: result.overwritten
            ? `Replaced the existing ${result.name}.`
            : undefined,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // REL-39. Not a failure yet — a question, with two answers.
          patch(id, { state: "conflict", message: err.message, file });
          return;
        }
        // REL-47: a dropped connection mid-upload reaches here. `postFile`
        // frames that as a `not_saved` failure with a `retry` recovery —
        // the upload route is atomic, so nothing partial is on disk and
        // re-sending cannot duplicate. Keep `file` so the failed row can
        // offer Retry, and phrase the message to name the file and say
        // the upload did not complete rather than surfacing a bare
        // "Failed to fetch". A server-side rejection (a 400 with its own
        // envelope) keeps its message and its file for retry too.
        // REL-47 vs REL-36: the generic "did not finish" phrasing is
        // ONLY for a network drop, which postFile throws as an ApiError
        // with status 0 and no server body. A server 400 (a dotfile
        // rejection, a bad name) also carries recovery:retry in its
        // envelope, so keying off recovery alone swallowed its specific
        // message — the dotfile reason became "did not finish uploading".
        // Key off status 0 instead: the drop has no server message to
        // show, a 400 does and must keep it.
        const droppedMidUpload = err instanceof ApiError && err.status === 0;
        const message = droppedMidUpload
          ? `${file.name} did not finish uploading — it was not attached. You can retry.`
          : err instanceof Error ? err.message : String(err);
        patch(id, { state: "failed", message, file });
      }
    },
    [patch, upload],
  );

  /**
   * Uploads a list of files, one request each, in order.
   *
   * Every file gets a row before the first request leaves, so a
   * twenty-file drop shows twenty rows immediately rather than
   * growing one at a time — REL-40's "each file gets its own tile or
   * its own failure line" is about the drop, not about the pace.
   */
  const send = useCallback(async (files: readonly File[]): Promise<void> => {
    const rows: QueueItem[] = files.map(file => {
      const id = nextId.current;
      nextId.current += 1;
      return file.size > MAX_ATTACHMENT_BYTES
        // REL-35. Refused here, so nothing is sent for this one — and
        // the rest of the drop is unaffected, which is its last bullet.
        ? { id, name: file.name, size: file.size, state: "failed" as const,
            message: oversizeMessage(file.name, file.size) }
        : { id, name: file.name, size: file.size, state: "pending" as const, file };
    });
    setQueue(prev => [...prev, ...rows]);

    for (const row of rows) {
      if (row.file === undefined) continue;
      // Sequential on purpose: each write takes the tracker lock, and
      // the panel wants each outcome as it lands.
      await attempt(row.id, row.file, false);
    }
  }, [attempt]);

  const onFiles = (list: FileList | null): void => {
    if (list === null || list.length === 0) return;
    void send([...list]);
  };

  const done = queue.filter(q => q.state === "done").length;
  const failed = queue.filter(q => q.state === "failed").length;
  const unresolved = queue.filter(q => q.state === "conflict").length;
  const pending = queue.filter(q => q.state === "pending").length;

  return (
    <div data-testid="attachments-panel">
      {/*
        The drop target *is* the empty state when there is nothing
        attached (REL-41): one designed region that says there are
        none and names both ways to add. When there are tiles it sits
        below them as an ordinary affordance.
      */}
      <div
        data-testid="attachment-dropzone"
        data-dragover={dragOver ? "true" : "false"}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => { setDragOver(false); }}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        className={
          "rounded-md border border-dashed px-3 py-4 text-center "
          + (dragOver
            ? "border-accent bg-bg-muted"
            : "border-border-subtle")
        }
      >
        {attachmentsError !== undefined ? (
          <div data-testid="attachments-error" className="mb-2 text-[0.9286rem]">
            <p className="text-danger-fg">
              Attachments could not be read — {attachmentsError}
            </p>
            {onRetry !== undefined && (
              <button
                type="button"
                data-testid="attachments-retry"
                onClick={onRetry}
                className="mt-1 rounded border border-border-subtle px-1.5 py-0.5 text-[0.8571rem] text-text-secondary underline hover:bg-bg-muted"
              >
                Retry
              </button>
            )}
          </div>
        ) : attachments.length === 0 ? (
          <p data-testid="attachments-empty" className="mb-2 text-[0.9286rem] text-text-secondary">
            No attachments on this task yet.
          </p>
        ) : null}
        <p className="text-[0.8571rem] text-text-tertiary">
          Drag files here, or{" "}
          <button
            type="button"
            data-testid="attachment-upload"
            onClick={() => { inputRef.current?.click(); }}
            className="rounded border border-border-subtle px-1.5 py-0.5 text-[0.8571rem] text-text-secondary underline hover:bg-bg-muted"
          >
            Upload
          </button>
          . Up to {formatBytes(MAX_ATTACHMENT_BYTES)} per file.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          data-testid="attachment-input"
          className="hidden"
          onChange={e => {
            onFiles(e.target.files);
            // Clearing lets the same file be chosen twice in a row —
            // which is how a user retries after a refusal.
            e.target.value = "";
          }}
        />
      </div>

      {attachments.length > 0 && (
        <>
          {/*
            REL-37. `grid-cols-[repeat(auto-fill,minmax(...))]` with a
            fixed column width, plus `min-w-0` + `truncate` on the name,
            is what keeps a 255-character filename from widening its
            own column and reflowing its neighbours. A grid track sized
            from content would do exactly that.
          */}
          <ul
            data-testid="attachment-grid"
            className="mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0"
          >
            {attachments.map(a => (
              <AttachmentTile
                key={a.name}
                taskRef={taskRef}
                attachment={a}
                removing={del.isPending}
                error={removeError[a.name]}
                onDismissError={() => {
                  setRemoveError(prev => {
                    const next = { ...prev };
                    delete next[a.name];
                    return next;
                  });
                }}
                onRemove={() => {
                  setRemoveError(prev => {
                    const next = { ...prev };
                    delete next[a.name];
                    return next;
                  });
                  del.mutate(
                    { name: a.name },
                    {
                      onError: (err: Error) => {
                        setRemoveError(prev => ({
                          ...prev,
                          [a.name]: `${a.name} was not removed: ${err.message}`,
                        }));
                      },
                    },
                  );
                }}
              />
            ))}
          </ul>
          <p data-testid="attachments-count" className="mt-2 text-[0.8571rem] text-text-tertiary">
            {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
          </p>
        </>
      )}

      {queue.length > 0 && (
        <div className="mt-3" data-testid="attachment-queue">
          {/*
            REL-40's second bullet: succeeded and failed counted
            separately, never one blended total. Unresolved collisions
            are their own number because they are neither yet.
          */}
          <p
            role="status"
            data-testid="attachment-summary"
            data-uploaded={String(done)}
            data-failed={String(failed)}
            className="mb-1 text-[0.8571rem] text-text-secondary"
          >
            {done} uploaded, {failed} failed
            {unresolved > 0 && `, ${String(unresolved)} needing a decision`}
            {pending > 0 && `, ${String(pending)} in progress`}
            {" · "}
            <button
              type="button"
              data-testid="attachment-queue-clear"
              onClick={() => {
                // Only the settled rows; clearing a pending one would
                // hide an upload that is still running.
                setQueue(prev => prev.filter(q => q.state === "pending" || q.state === "conflict"));
              }}
              className="underline"
            >
              Clear finished
            </button>
          </p>
          <ul className="list-none space-y-1 p-0">
            {queue.map(item => (
              <li
                key={item.id}
                data-testid="attachment-queue-item"
                data-name={item.name}
                data-state={item.state}
                className="flex flex-wrap items-center gap-2 text-[0.8571rem]"
              >
                <span className="font-mono">{item.name}</span>
                {item.state === "pending" && (
                  <span className="text-text-tertiary">Uploading…</span>
                )}
                {item.state === "done" && (
                  <span className="text-text-tertiary">
                    Uploaded{item.message === undefined ? "" : ` — ${item.message}`}
                  </span>
                )}
                {item.state === "failed" && (
                  <>
                    <span
                      role="alert"
                      data-testid="attachment-queue-error"
                      className="text-danger-fg"
                    >
                      {item.message}
                    </span>
                    {/*
                      REL-47: a failed upload offers retry. Only when the
                      original File is still in hand (a dropped connection
                      or a server-side rejection keeps it; an oversize
                      refusal, caught before anything is sent, does not —
                      there is nothing to resend it against). Retry re-runs
                      the same attempt; the route is atomic, so a retry
                      after an incomplete transfer cannot duplicate.
                    */}
                    {item.file !== undefined && (
                      <button
                        type="button"
                        data-testid="attachment-retry-upload"
                        onClick={() => {
                          const f = item.file;
                          if (f !== undefined) void attempt(item.id, f, false);
                        }}
                        className="rounded border border-border-subtle px-1.5 py-0.5 hover:bg-bg-muted"
                      >
                        Retry
                      </button>
                    )}
                  </>
                )}
                {item.state === "conflict" && (
                  <>
                    {/*
                      REL-39. The user is told the name is taken, and
                      the two choices are spelled out rather than
                      implied by an X and an OK.
                    */}
                    <span
                      role="alert"
                      data-testid="attachment-conflict"
                      className="text-warn-fg"
                    >
                      A file called {item.name} is already attached to this task.
                    </span>
                    <button
                      type="button"
                      data-testid="attachment-replace"
                      onClick={() => {
                        const f = item.file;
                        if (f !== undefined) void attempt(item.id, f, true);
                      }}
                      className="rounded border border-border-subtle px-1.5 py-0.5 hover:bg-bg-muted"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      data-testid="attachment-cancel"
                      onClick={() => {
                        // Cancel is a no-op against disk, deliberately:
                        // the 409 means nothing was written, so there
                        // is nothing to undo. The row goes.
                        setQueue(prev => prev.filter(q => q.id !== item.id));
                      }}
                      className="rounded border border-border-subtle px-1.5 py-0.5 hover:bg-bg-muted"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface QueueItem {
  readonly id: number;
  /** The name as sent, replaced by the stored name once known. */
  readonly name: string;
  readonly size: number;
  readonly state: "pending" | "done" | "failed" | "conflict";
  readonly message?: string | undefined;
  /** Kept for a retry-as-replace; absent once the row is settled. */
  readonly file?: File | undefined;
}

/**
 * One tile.
 *
 * REL-37: the name is truncated to the tile's width, with the full
 * string on `title` (hover) and, for assistive tech, as the link's
 * accessible name — `aria-label` rather than relying on the truncated
 * text node, because CSS truncation leaves the text intact in the
 * accessibility tree only for `text-overflow: ellipsis`, and a name
 * that wraps to three lines would still be read in full but would have
 * changed the tile's height. Fixed height plus `truncate` keeps both
 * properties.
 */
function AttachmentTile({
  taskRef,
  attachment,
  removing,
  error,
  onRemove,
  onDismissError,
}: {
  readonly taskRef: string;
  readonly attachment: AttachmentResponse;
  readonly removing: boolean;
  readonly error: string | undefined;
  readonly onRemove: () => void;
  readonly onDismissError: () => void;
}): React.JSX.Element {
  const family = familyForMime(attachment.mime);
  const href =
    `/api/tasks/${encodeURIComponent(taskRef)}/attachments/`
    + encodeURIComponent(attachment.name);

  return (
    <li
      data-testid="attachment-tile"
      data-name={attachment.name}
      data-family={family}
      data-mime={displayMime(attachment.mime)}
      className="flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border border-border-subtle p-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {/*
          REL-38: a generic glyph, and no thumbnail. Nothing here
          fetches the bytes to preview them — an image/svg+xml or
          text/html upload rendered inline is a script-execution path,
          which is why the download endpoint serves octet-stream +
          nosniff in the first place.
        */}
        <span
          aria-hidden="true"
          data-testid="attachment-icon"
          className="shrink-0 text-[1.1429rem]"
        >
          {glyphFor(family)}
        </span>
        <a
          href={href}
          download={attachment.name}
          data-testid="attachment-name"
          title={attachment.name}
          aria-label={`Download ${attachment.name}`}
          className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary no-underline hover:underline"
        >
          {attachment.name}
        </a>
      </div>
      <p className="text-[0.7857rem] text-text-tertiary">
        {formatBytes(attachment.size)} · {displayMime(attachment.mime)}
      </p>
      <button
        type="button"
        data-testid="attachment-remove"
        disabled={removing}
        onClick={onRemove}
        className="self-start rounded border border-border-subtle px-1.5 py-0.5 text-[0.7857rem] text-text-secondary hover:bg-bg-muted disabled:opacity-50"
      >
        Remove
      </button>
      {error !== undefined && (
        <p
          role="alert"
          data-testid="attachment-remove-error"
          className="text-[0.7857rem] text-danger-fg"
        >
          {error}{" "}
          <button type="button" onClick={onDismissError} className="underline">
            Dismiss
          </button>
        </p>
      )}
    </li>
  );
}

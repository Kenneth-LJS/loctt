import type { UserProfile } from "@loctt/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useUploadAttachment } from "../api/hooks/useAttachments.ts";
import {
  useComments,
  useDeleteComment,
  useEditComment,
  usePostComment,
} from "../api/hooks/useComments.ts";
import { useAnnouncer } from "../ui/Announcer.tsx";
import { Button } from "../ui/Button.tsx";
import { uploadAsEmbeds } from "./commentAttachments.ts";
import { CommentComposer } from "./CommentComposer.tsx";
import { CommentItem } from "./CommentItem.tsx";
import { DeleteCommentDialog } from "./DeleteCommentDialog.tsx";
import { buildUserIndex } from "./users.ts";

/**
 * The task detail page's Comments section (M2.4a — CMT-1..12).
 *
 * ## Ordering
 *
 * The list is rendered in the order the API returns, which is the
 * order of `_comments.yaml`, which is creation order. CMT-1's first
 * bullet wants oldest-first — "the opposite ordering of the activity
 * feed, deliberately" — and its third makes the file the authority. So
 * there is no sort here at all: a sort could agree with the file by
 * coincidence while the server's order changed underneath it, and the
 * test could not tell.
 *
 * ## Author and mention ids are joined here
 *
 * `author` and every mention's `userId` are raw ULIDs. `GET /api/users`
 * is already loaded for the sidebar, and the join lives in
 * `buildUserIndex` so both use the same lookup and the same fallback
 * — the LST-33 shape (a ULID reaching UI content because a lookup fell
 * through) has one place to go wrong rather than two.
 */
export function CommentsPanel({
  taskRef,
  users,
}: {
  readonly taskRef: string;
  readonly users: readonly UserProfile[];
}): React.JSX.Element {
  const comments = useComments(taskRef);
  const navigate = useNavigate();
  const { announce } = useAnnouncer();

  // K76: copy a deep link to a comment. The URL carries `?tab=comments`
  // so the comment is mounted (the panel is tabbed) and `#comment-<id>`
  // so `useScrollToHash` scrolls it into view on open. Built from the
  // live origin so it is shareable within this instance; announced so a
  // screen-reader user knows the copy happened.
  const copyCommentLink = (commentId: string): void => {
    const url = `${window.location.origin}/tasks/${encodeURIComponent(taskRef)}`
      + `?tab=comments#comment-${commentId}`;
    void navigator.clipboard?.writeText(url).then(
      () => { announce("Link to comment copied"); },
      () => { announce("Could not copy the link"); },
    );
  };

  // CMT-20: the thread scrolls within its own box (below), so the
  // composer stays reachable without scrolling past 80 comments. When a
  // new comment lands, scroll it into view so the user sees it went
  // through rather than being left mid-thread. Keyed on the count: a
  // *post* grows it (scroll), an edit does not (leave the scroll alone).
  const listRef = useRef<HTMLUListElement>(null);
  const prevCount = useRef<number>(0);
  useEffect(() => {
    const count = comments.data?.length ?? 0;
    if (count > prevCount.current && prevCount.current > 0) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevCount.current = count;
  }, [comments.data]);

  const post = usePostComment(taskRef);
  const edit = useEditComment(taskRef);
  const del = useDeleteComment(taskRef);
  // The SAME upload verb the Attachments panel uses (GOAL 2) — a comment's
  // embedded file is just a ticket attachment, so it goes to the ticket's
  // store and shows up in the Attachments list.
  const uploadAttachment = useUploadAttachment(taskRef);

  /**
   * The composer's inline embed-inserter, published via `onEmbedReady`.
   * Held in a ref so the attach handler (below) can splice an uploaded
   * file into the body after the upload settles without re-rendering.
   */
  const insertEmbedRef = useRef<((markdown: string) => void) | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Bumped after a successful post; clears and refocuses the composer. */
  const [resetToken, setResetToken] = useState(0);

  const index = useMemo(() => buildUserIndex(users), [users]);

  /**
   * Frozen per render pass rather than read inside each row: a hundred
   * `Date.now()` calls in one paint can straddle a second boundary and
   * give two comments posted together different relative times.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, 30_000);
    return () => { clearInterval(t); };
  }, []);

  if (comments.isPending) {
    return (
      <p aria-busy="true" className="text-[0.9286rem] text-text-tertiary">
        Loading comments…
      </p>
    );
  }

  if (comments.isError) {
    /**
     * A thread that could not be read.
     *
     * **Not claimed as CMT-36**, which belongs to M2.4b and is not in
     * this ticket's owed set. A panel that fetches needs *some* error
     * branch, and this is that branch built in the shape CMT-36 will
     * want — but it has no spec here and is untested, so M2.4b owes
     * the verification rather than inheriting a claim.
     *
     * The
     * server's envelope already names the full path and the parse
     * problem, so it is shown rather than replaced with prose of our
     * own — and **the composer is not rendered at all**. Posting into
     * an unreadable file is the one thing that must not happen here:
     * core refuses the write (P-11), but offering a control that
     * cannot succeed is its own failure.
     */
    const message = comments.error instanceof ApiError
      ? comments.error.message
      : "The comments for this task could not be read.";
    return (
      <div data-testid="comments-error" className="space-y-2">
        <p role="alert" className="text-[0.9286rem] text-danger-fg">
          {message}
        </p>
        <p data-testid="composer-disabled-reason" className="text-[0.9286rem] text-text-tertiary">
          You cannot add a comment until this file is readable — posting
          now would overwrite it and lose the comments already there.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => { void comments.refetch(); }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const list = comments.data;
  const deleting = list.find(c => c.id === deletingId);

  return (
    <div className="space-y-3">
      {list.length === 0
        ? (
            <p data-testid="comments-empty" className="text-[0.9286rem] text-text-tertiary">
              No comments yet.
            </p>
          )
        : (
            <ul
              ref={listRef}
              data-testid="comments-list"
              // CMT-20: a bounded, scrollable thread. A long list scrolls
              // *inside* this box rather than pushing the composer below
              // it off the screen; the composer that follows stays
              // reachable. `max-h` in rem so it scales with text-zoom.
              className="m-0 max-h-[30rem] list-none overflow-y-auto p-0"
            >
              {list.map(comment => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  users={index}
                  now={now}
                  mentionCandidates={index.mentionable}
                  editing={editingId === comment.id}
                  editError={editingId === comment.id ? editError ?? undefined : undefined}
                  editPending={editingId === comment.id && edit.isPending}
                  resolveMention={index.mention}
                  /**
                   * CMT-9's third bullet: activating a chip does
                   * something useful, predictable, and *the same thing
                   * every time* — it filters the list to that user's
                   * tasks. One callback for every chip on the page, so
                   * "the same thing every time" is structural.
                   */
                  onMentionActivate={userId => {
                    void navigate({ to: "/list", search: { assignee: [userId] } });
                  }}
                  onCopyLink={() => { copyCommentLink(comment.id); }}
                  onStartEdit={() => {
                    setEditError(null);
                    setEditingId(comment.id);
                  }}
                  onCancelEdit={() => {
                    // CMT-5: cancelling discards changes and leaves
                    // the stored body untouched. Nothing was sent, so
                    // there is nothing to undo — dropping the composer
                    // is the whole operation.
                    setEditingId(null);
                    setEditError(null);
                  }}
                  onSaveEdit={body => {
                    setEditError(null);
                    edit.mutate(
                      { id: comment.id, body },
                      {
                        onSuccess: () => { setEditingId(null); },
                        // The composer stays open holding the typed
                        // text, so a failed save is retryable rather
                        // than retypeable (ERR-12).
                        onError: (err: Error) => { setEditError(err.message); },
                      },
                    );
                  }}
                  onDelete={() => {
                    setDeleteError(null);
                    setDeletingId(comment.id);
                  }}
                />
              ))}
            </ul>
          )}

      {/* Below the list and always rendered — CMT-2's first bullet
          ("always visible without hunting"). Not inside a disclosure,
          not behind an "Add comment" button. */}
      {attachError !== null && (
        <p role="alert" data-testid="comment-composer-attach-error" className="text-[0.8571rem] text-danger-fg">
          {attachError}
        </p>
      )}
      <CommentComposer
        initial=""
        mentionCandidates={index.mentionable}
        submitLabel="Comment"
        ariaLabel="Add a comment"
        pending={post.isPending}
        error={postError ?? undefined}
        testId="comment-composer"
        resetToken={resetToken}
        attachPending={uploadAttachment.isPending}
        onEmbedReady={insert => { insertEmbedRef.current = insert; }}
        onAttachFiles={files => {
          setAttachError(null);
          void uploadAsEmbeds(uploadAttachment, taskRef, files).then(({ embeds, failures }) => {
            for (const embed of embeds) insertEmbedRef.current?.(embed);
            if (failures > 0) {
              setAttachError(
                failures === 1
                  ? "A file could not be attached. It was not added to the comment."
                  : `${String(failures)} files could not be attached. They were not added to the comment.`,
              );
            }
          });
        }}
        onSubmit={body => {
          setPostError(null);
          post.mutate(
            { body },
            {
              onSuccess: () => { setResetToken(t => t + 1); },
              // The typed text stays on screen. ERR-12: a rejected
              // write must not also cost the user their words.
              onError: (err: Error) => { setPostError(err.message); },
            },
          );
        }}
      />

      {deleting !== undefined && (
        <DeleteCommentDialog
          preview={preview(deleting.body)}
          timestamp={deleting.created_at}
          pending={del.isPending}
          error={deleteError ?? undefined}
          onCancel={() => {
            setDeletingId(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            setDeleteError(null);
            del.mutate(
              { id: deleting.id },
              {
                onSuccess: () => { setDeletingId(null); },
                // The dialog stays up on failure: closing it would
                // read as a successful delete for a comment still in
                // the file.
                onError: (err: Error) => { setDeleteError(err.message); },
              },
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Enough of a body to identify which comment is about to go (CMT-6).
 *
 * The *raw markdown*, truncated — not the rendered body. A dialog is
 * an identification, and showing a formatted excerpt would make the
 * preview and the list row look different from each other for the same
 * comment.
 */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

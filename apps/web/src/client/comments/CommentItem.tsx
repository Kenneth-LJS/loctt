import type { CommentResponse } from "@loctt/contracts";

import type { MentionCandidate } from "../editor/MentionMenu.tsx";
import { relativeTime } from "../list/format.ts";
import { avatarPalette, initials } from "../ui/avatar.ts";
import { CommentComposer } from "./CommentComposer.tsx";
import { formatCommentEditors } from "./editors.ts";
import type { MentionResolver } from "./renderMarkdown.tsx";
import { renderCommentBody } from "./renderMarkdown.tsx";
import type { UserIndex } from "./users.ts";
import { authorTitle } from "./users.ts";

/**
 * One comment: header, rendered body, and the edit/delete controls.
 *
 * ## Edit and delete are on every comment
 *
 * CMT-4, which "previously asserted the opposite". LocTT has no roles
 * or permissions (Q25), users switch identity from a menu, and
 * `comments.ts` stores an `editors` provenance array — a field that
 * only means anything if someone other than the author can edit. An
 * ownership check here would be the product's only permission rule,
 * guarding a door with no walls beside it.
 *
 * ## The author is a ULID until this component joins it
 *
 * `comment.author` is a raw user id. LST-33 shipped one of those into
 * UI content because a lookup fell through, and a test asserting a row
 * "appears" could not see it. So the name comes from `UserIndex`,
 * which answers "Unknown user" rather than the id — and the tests
 * assert the *name*.
 */
export function CommentItem({
  comment,
  users,
  now,
  mentionCandidates,
  editing,
  editError,
  editPending,
  resolveMention,
  onMentionActivate,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  readonly comment: CommentResponse;
  readonly users: UserIndex;
  readonly now: number;
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly editing: boolean;
  readonly editError: string | undefined;
  readonly editPending: boolean;
  readonly resolveMention: MentionResolver;
  readonly onMentionActivate: (userId: string) => void;
  readonly onStartEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: (body: string) => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const name = users.name(comment.author);
  const title = authorTitle(users, comment.author);

  /**
   * CMT-5's third bullet, and CMT-35's rendering split. A self-edit
   * renders the bare "Edited" marker; an edit by someone else renders
   * the author primarily with "Edited by <editor>" secondary. Core's
   * `formatCommentEditors` decides which, from the same `editors`
   * array the file stores — so the two renderings cannot disagree with
   * what is on disk.
   */
  const editedMarker = formatCommentEditors(
    { ...(comment.edited === true ? { edited: true as const } : {}),
      ...(comment.editors !== undefined ? { editors: [...comment.editors] } : {}) },
    id => (users.known(id) ? users.name(id) : undefined),
  );

  return (
    <li
      data-testid="comment"
      data-comment-id={comment.id}
      className="flex gap-3 border-b border-border-subtle py-3 last:border-b-0"
    >
      <span
        aria-hidden="true"
        data-testid="comment-avatar"
        className={
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.7857rem] font-semibold "
          + avatarPalette(comment.author)
        }
      >
        {initials(name)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            data-testid="comment-author"
            {...(title !== undefined ? { title } : {})}
            className={
              "text-[0.9286rem] font-medium "
              + (users.known(comment.author) ? "text-text-primary" : "text-text-tertiary italic")
            }
          >
            {name}
          </span>
          {/* Relative, with the absolute time on hover — CMT-1's second
              bullet asks for both, and a `title` is where the app
              already puts the absolute one (MetaPanel's footer). */}
          <time
            data-testid="comment-time"
            dateTime={comment.created_at}
            title={comment.created_at}
            className="text-[0.8571rem] text-text-tertiary"
          >
            {relativeTime(comment.created_at, now)}
          </time>
          {editedMarker !== undefined && (
            <span
              data-testid="comment-edited"
              // The edit time, available without occupying the line.
              {...(comment.updated_at !== undefined ? { title: comment.updated_at } : {})}
              className="text-[0.8571rem] text-text-tertiary"
            >
              ({editedMarker})
            </span>
          )}

          <span className="ml-auto flex gap-1">
            <button
              type="button"
              data-testid="comment-edit"
              onClick={onStartEdit}
              className="rounded px-1.5 py-0.5 text-[0.8571rem] text-text-tertiary hover:bg-bg-muted hover:text-text-primary"
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="comment-delete"
              onClick={onDelete}
              className="rounded px-1.5 py-0.5 text-[0.8571rem] text-text-tertiary hover:bg-bg-muted hover:text-danger-fg"
            >
              Delete
            </button>
          </span>
        </div>

        {editing
          ? (
              <CommentComposer
                // The *stored* markdown, not the rendered body —
                // CMT-3's second bullet.
                initial={comment.body}
                mentionCandidates={mentionCandidates}
                submitLabel="Save"
                ariaLabel="Edit comment"
                pending={editPending}
                error={editError}
                onSubmit={onSaveEdit}
                onCancel={onCancelEdit}
                testId="comment-edit-composer"
                // CMT-3: reopening for edit shows the *source* the
                // user typed, not the rendered HTML.
                initialMode="raw"
              />
            )
          : renderCommentBody(comment.body, {
              resolveMention,
              onMentionActivate,
            })}
      </div>
    </li>
  );
}

import type { CommentResponse } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The comments thread and its three write verbs (M2.4a).
 *
 * `GET /api/tasks/:ref/comments` returns the thread **in file order**,
 * which is creation order, which is what CMT-1 asks the list to render:
 * oldest at the top. No client-side sort — CMT-1's third bullet is
 * "the order matches the order in the underlying comments file", and a
 * sort here could agree with the file by accident while the server's
 * order silently changed.
 *
 * ## Not optimistic, deliberately
 *
 * The meta panel's field writes are optimistic (TSK-13 wants the panel
 * to move before the network settles). A comment is not that: CMT-2
 * requires the posted comment to survive a reload, and the id and
 * `created_at` are both server-stamped, so an optimistically appended
 * comment would have to be a placeholder that the settling refetch
 * replaces. The write is one small file append and the round trip is
 * local; showing the real comment when the server has it is both
 * simpler and honest about what is on disk.
 *
 * Every mutation invalidates the thread, and `activity` with it: a
 * comment writes a `comment_added` history entry, so the activity feed
 * beside it is stale the moment a comment lands (M2.4b renders it;
 * invalidating now means it never has to know about this file).
 */

/** How long a comment write may hang before the UI stops claiming to know (ERR-4). */
const COMMENT_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_COMMENT_TIMEOUT_MS__?: unknown })
    .__LOCTT_COMMENT_TIMEOUT_MS__ ?? 15_000,
);

export function commentsQueryKey(ref: string): readonly unknown[] {
  return ["comments", ref];
}

export function useComments(ref: string) {
  return useQuery<readonly CommentResponse[]>({
    queryKey: commentsQueryKey(ref),
    queryFn: ({ signal }) =>
      apiClient.get<readonly CommentResponse[]>(
        `/api/tasks/${encodeURIComponent(ref)}/comments`,
        { signal },
      ),
  });
}

/** Invalidates everything a comment write makes stale. */
function useCommentInvalidation(ref: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: commentsQueryKey(ref) });
    void qc.invalidateQueries({ queryKey: ["activity", ref] });
  };
}

export function usePostComment(ref: string) {
  const invalidate = useCommentInvalidation(ref);
  return useMutation<CommentResponse, Error, { body: string }>({
    mutationKey: ["post-comment", ref],
    mutationFn: vars =>
      apiClient.post<CommentResponse>(
        `/api/tasks/${encodeURIComponent(ref)}/comments`,
        { body: vars.body },
        { timeoutMs: COMMENT_TIMEOUT_MS },
      ),
    onSuccess: invalidate,
  });
}

export function useEditComment(ref: string) {
  const invalidate = useCommentInvalidation(ref);
  return useMutation<CommentResponse, Error, { id: string; body: string }>({
    mutationKey: ["edit-comment", ref],
    mutationFn: vars =>
      apiClient.put<CommentResponse>(
        `/api/tasks/${encodeURIComponent(ref)}/comments/${encodeURIComponent(vars.id)}`,
        { body: vars.body },
        { timeoutMs: COMMENT_TIMEOUT_MS },
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteComment(ref: string) {
  const invalidate = useCommentInvalidation(ref);
  return useMutation<{ deleted: string }, Error, { id: string }>({
    mutationKey: ["delete-comment", ref],
    mutationFn: vars =>
      apiClient.delete<{ deleted: string }>(
        `/api/tasks/${encodeURIComponent(ref)}/comments/${encodeURIComponent(vars.id)}`,
        { timeoutMs: COMMENT_TIMEOUT_MS },
      ),
    onSuccess: invalidate,
  });
}

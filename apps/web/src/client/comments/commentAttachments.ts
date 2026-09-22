/**
 * Embedding an attachment from the comment composer (GOAL 2, Ken:
 * "comment editor should allow embedded attachments too, and those
 * attachment files get added onto the ticket's attachments").
 *
 * ## No new store, no new endpoint
 *
 * A comment's attachment IS a ticket attachment. So this reuses the
 * task-attachment upload flow verbatim — the same
 * `POST /api/tasks/:ref/attachments` route the Attachments panel posts to
 * (via `useUploadAttachment`). The file therefore appears in the ticket's
 * Attachments list (that list is a field of `GET /api/tasks/:ref`, which
 * the upload's `onSettled` invalidates) exactly as a panel upload would,
 * and the comment body just references it. There is deliberately no
 * parallel comment-attachment store and no comment-attachment API.
 *
 * ## The embed reference
 *
 * The body references the file through the existing `attachmentEmbed`
 * node, whose markdown spelling is `![alt](src)`. The `src` is the file's
 * **inline URL** on the same route the Attachments panel's thumbnails use
 * (`/api/tasks/:ref/attachments/:name?inline=1`) — an absolute path, so
 * `isSafeHref` accepts it and both the composer's rich surface and the
 * comment read view load it directly, with no extra resolver. The name is
 * the one the SERVER stored (basename-sanitised, REL-36), not the name
 * sent, so a renamed-on-save file still resolves.
 */

import type { AttachResultResponse } from "@loctt/contracts";

/** A minimal view of the upload mutation, so this is testable without React. */
export interface AttachmentUploader {
  mutateAsync: (vars: { file: File; force?: boolean }) => Promise<AttachResultResponse>;
}

/**
 * The markdown embed for a stored attachment on `taskRef`.
 *
 * `alt` is the stored file name so the reference is legible in source
 * mode and as a fallback when the bytes are not an image. The `src` is
 * the inline URL, URL-encoded per path segment the same way the
 * Attachments panel builds its links.
 */
export function embedMarkdownFor(taskRef: string, name: string): string {
  const src =
    `/api/tasks/${encodeURIComponent(taskRef)}/attachments/`
    + `${encodeURIComponent(name)}?inline=1`;
  return `![${name}](${src})`;
}

/**
 * Uploads `files` to `taskRef`'s attachment store and returns the embed
 * markdown for each that succeeded, in order.
 *
 * Sequential and per-file, mirroring the Attachments panel: each file is
 * one request (the route enforces the size cap, basename sanitisation and
 * collision refusal per file), and one failure does not abort the rest —
 * a rejected upload is skipped (it never becomes an embed) rather than
 * throwing out the whole batch. The caller decides how to surface a
 * partial failure; this returns only what actually landed on disk.
 */
export async function uploadAsEmbeds(
  uploader: AttachmentUploader,
  taskRef: string,
  files: readonly File[],
): Promise<{ readonly embeds: readonly string[]; readonly failures: number }> {
  const embeds: string[] = [];
  let failures = 0;
  for (const file of files) {
    try {
      const result = await uploader.mutateAsync({ file });
      // The name the server stored, which is not always the name sent
      // (REL-36 sanitises `a/b.txt` to `b.txt`).
      embeds.push(embedMarkdownFor(taskRef, result.name));
    } catch {
      failures += 1;
    }
  }
  return { embeds, failures };
}

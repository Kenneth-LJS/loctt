import type { AttachResultResponse } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The Attachments panel's two write verbs (M2.5b).
 *
 * ```
 * POST   /api/tasks/:ref/attachments[?force=true]   multipart, field "file"
 * DELETE /api/tasks/:ref/attachments/:name
 * ```
 *
 * ## One file per request, on purpose
 *
 * REL-40 drops twenty files at once and asks for **per-file outcome**
 * — "each file gets its own tile or its own failure line", "one
 * failure does not abort the remaining uploads". It never asks for one
 * request. Twenty sequential POSTs give exactly that, and the
 * single-file route already enforces every per-file rule its
 * neighbours need: REL-35's size cap, REL-36's basename sanitisation,
 * REL-39's collision refusal. A batch endpoint would have to invent a
 * partial-failure shape and re-derive errors this route already
 * returns.
 *
 * Sequential rather than parallel because each upload takes the
 * tracker lock and appends a history entry; twenty concurrent writers
 * would serialise on the lock anyway, and the panel wants to render
 * each outcome as it lands.
 *
 * ## Nothing here is optimistic
 *
 * Same reasoning as the relationships panel next door. The server
 * decides the stored name (it takes the basename — REL-36), whether
 * the write collided (REL-39), and whether the file was legal at all.
 * A tile drawn before the answer would be drawn under the wrong name
 * as often as the right one. The queue below renders *pending* rows,
 * which is a different thing: they are visibly not attachments yet.
 *
 * ## The size cap lives on the client as well as the server
 *
 * REL-35's second bullet wants the message to name the file, its size
 * and the cap, in the user's units. The server's envelope says
 * `upload exceeds maximum size of 52428800 bytes` — right for a
 * developer reading a response, wrong for the panel. The browser knows
 * the name and the byte count before it sends anything, so the check
 * is made here and nothing leaves. The server check stays as the guard
 * against a client that skips this one; see `MAX_ATTACHMENT_BYTES`.
 */

/**
 * The per-file cap, mirroring `DEFAULT_MAX_ATTACHMENT_BYTES` in core
 * and `multipart.ts`'s default.
 *
 * Duplicated rather than imported: `@loctt/core` is a Node package
 * (it reaches for `node:fs` at module load) and pulling it into the
 * browser bundle for one integer is not a trade worth making. The
 * server remains the authority — this copy only decides what the
 * panel refuses locally, and a drift would show up as a file this
 * rejects and the server would have taken, not the reverse.
 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * A size in the units a person uses, for the REL-35 message.
 *
 * Binary units, matching the cap's own definition (50 MB here is
 * 50 × 1024 × 1024), so "the limit is 50 MB" and the constant agree.
 * A file measured in decimal MB against a binary cap would produce
 * "52.4 MB; the limit is 50 MB" for a file of exactly the cap.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above: "9.4 MB", "200 MB".
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${String(rounded)} ${units[unit] ?? "B"}`;
}

/** The refusal text for an oversized file, naming all three things. */
export function oversizeMessage(name: string, size: number): string {
  return (
    `${name} is ${formatBytes(size)}; the limit is `
    + `${formatBytes(MAX_ATTACHMENT_BYTES)}. It was not uploaded.`
  );
}

export interface UploadVars {
  readonly file: File;
  /** Overwrite an existing attachment of the same name (REL-39). */
  readonly force?: boolean;
}

/**
 * Invalidates what an attachment write made stale.
 *
 * The attachment list is a field of `GET /api/tasks/:ref`, so there is
 * no separate query to invalidate — the task query is the list. The
 * write also appends a history entry and bumps `updated_at`, so the
 * activity feed and the list rows go with it.
 */
function invalidate(qc: ReturnType<typeof useQueryClient>, ref: string): void {
  void qc.invalidateQueries({ queryKey: ["task", ref] });
  void qc.invalidateQueries({ queryKey: ["activity", ref] });
  void qc.invalidateQueries({ queryKey: ["tasks"] });
  void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
}

export function useUploadAttachment(ref: string) {
  const qc = useQueryClient();
  return useMutation<AttachResultResponse, Error, UploadVars>({
    mutationKey: ["attach", ref],
    mutationFn: vars =>
      apiClient.postFile<AttachResultResponse>(
        `/api/tasks/${encodeURIComponent(ref)}/attachments`
        + (vars.force === true ? "?force=true" : ""),
        vars.file,
      ),
    onSettled: () => { invalidate(qc, ref); },
  });
}

export function useDeleteAttachment(ref: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { name: string }>({
    mutationKey: ["detach", ref],
    mutationFn: vars =>
      apiClient.delete<void>(
        `/api/tasks/${encodeURIComponent(ref)}/attachments/`
        + encodeURIComponent(vars.name),
      ),
    onSettled: () => { invalidate(qc, ref); },
  });
}

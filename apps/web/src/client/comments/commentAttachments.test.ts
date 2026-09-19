import type { AttachResultResponse } from "@loctt/contracts";
import { describe, expect, it, vi } from "vitest";

import { embedMarkdownFor, uploadAsEmbeds } from "./commentAttachments.ts";

/**
 * GOAL 2: a file attached from the comment composer is uploaded to the
 * SAME per-ticket attachment store the Attachments panel uses, and the
 * comment body references it via the existing `attachmentEmbed` markdown.
 * These pin the two halves of that: the embed reference points at the
 * ticket's attachment inline URL, and the uploader is driven per-file
 * against the task-attachment mutation (reused, not reinvented).
 */

function result(name: string): AttachResultResponse {
  return { name, size: 3, mime: "image/png", overwritten: false } as AttachResultResponse;
}

describe("embedMarkdownFor", () => {
  it("references the file on the ticket's inline attachment URL", () => {
    // The src must be the task-attachment route (so the file that lands is
    // a ticket attachment, GOAL 2) and an absolute path (so isSafeHref
    // accepts it and the reader renders a real <img>). Red-proof: a bare
    // `attachments/<name>` src — the tempting relative form — would not
    // resolve to the API and the image would 404.
    expect(embedMarkdownFor("T-1", "shot.png"))
      .toBe("![shot.png](/api/tasks/T-1/attachments/shot.png?inline=1)");
  });

  it("url-encodes the ref and the name", () => {
    expect(embedMarkdownFor("A B", "a b.png"))
      .toBe("![a b.png](/api/tasks/A%20B/attachments/a%20b.png?inline=1)");
  });
});

describe("uploadAsEmbeds", () => {
  it("uploads each file to the task-attachment store and embeds the STORED name", async () => {
    // The server may rename on save (basename sanitisation, REL-36), so
    // the embed must use the name the upload returned, not the File's.
    const mutateAsync = vi.fn((vars: { file: File }) =>
      Promise.resolve(result(vars.file.name.replace(/^.*\//, ""))));
    const files = [
      new File(["x"], "a/b.png", { type: "image/png" }),
      new File(["y"], "c.png", { type: "image/png" }),
    ];

    const { embeds, failures } = await uploadAsEmbeds({ mutateAsync }, "T-9", files);

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(failures).toBe(0);
    // The first file's stored name is the basename `b.png`, not `a/b.png`.
    expect(embeds).toEqual([
      "![b.png](/api/tasks/T-9/attachments/b.png?inline=1)",
      "![c.png](/api/tasks/T-9/attachments/c.png?inline=1)",
    ]);
  });

  it("skips a failed upload but keeps going — one failure does not abort the batch", async () => {
    const mutateAsync = vi.fn()
      .mockResolvedValueOnce(result("ok1.png"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(result("ok2.png"));
    const files = [
      new File(["1"], "ok1.png"),
      new File(["2"], "bad.png"),
      new File(["3"], "ok2.png"),
    ];

    const { embeds, failures } = await uploadAsEmbeds(
      { mutateAsync: mutateAsync as never }, "T-2", files,
    );

    // Red-proof: an implementation that let the rejection propagate (no
    // per-file catch) would throw here and never return the two that
    // succeeded.
    expect(failures).toBe(1);
    expect(embeds).toEqual([
      "![ok1.png](/api/tasks/T-2/attachments/ok1.png?inline=1)",
      "![ok2.png](/api/tasks/T-2/attachments/ok2.png?inline=1)",
    ]);
  });
});

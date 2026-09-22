// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAsEmbeds } from "./commentAttachments.ts";
import { CommentComposer } from "./CommentComposer.tsx";

/**
 * GOAL 2 end-to-end through the composer: a file attached from the comment
 * composer is uploaded to the ticket's attachment store and its embed is
 * spliced into the comment body, so the posted body carries the reference.
 *
 * The composer does not upload itself — its owner does — so this wires the
 * two together the way `CommentsPanel` does: `onAttachFiles` uploads via
 * `uploadAsEmbeds` and feeds each embed to the composer's published
 * `insertEmbed`. The submitted body is then asserted to contain the embed.
 */

afterEach(cleanup);

async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}

describe("CommentComposer embedded attachments (GOAL 2)", () => {
  it("uploads to the ticket store and embeds the file in the submitted body", async () => {
    const onSubmit = vi.fn();
    // Stand-in for the task-attachment upload mutation — the SAME verb the
    // Attachments panel drives. Its call is what proves the file goes to
    // the ticket's store rather than some parallel comment store.
    const mutateAsync = vi.fn((vars: { file: File }) => Promise.resolve({
      name: vars.file.name, size: 3, overwritten: false, task_key: "T-7",
    }));

    let insert: ((md: string) => void) | null = null;

    render(
      <CommentComposer
        initial=""
        mentionCandidates={[]}
        submitLabel="Comment"
        ariaLabel="Add a comment"
        pending={false}
        error={undefined}
        onSubmit={onSubmit}
        testId="comment-composer"
        onEmbedReady={fn => { insert = fn; }}
        onAttachFiles={files => {
          void uploadAsEmbeds({ mutateAsync }, "T-7", files).then(({ embeds }) => {
            for (const e of embeds) insert?.(e);
          });
        }}
      />,
    );
    await settle();

    // Pick a file through the composer's own Attach input.
    const input = screen.getByTestId<HTMLInputElement>("comment-composer-attach-input");
    const file = new File(["x"], "diagram.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    });

    // The file was uploaded to the ticket's attachment store (GOAL 2).
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0]?.[0]?.file?.name).toBe("diagram.png");

    // And the embed is now in the buffer, so posting carries it. Red-proof:
    // without `insertEmbed` splicing the embed into the buffer, the
    // submitted body would be empty and this assertion would fail.
    await settle();
    fireEvent.click(screen.getByTestId("comment-composer-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]?.[0] as string;
    expect(body).toContain("![diagram.png](/api/tasks/T-7/attachments/diagram.png?inline=1)");
  });
});

/**
 * The task description's READ state (K33, TSK-68/70; A247).
 *
 * K33 (Ken, 2026-09-09) makes the task description read-then-edit,
 * Jira-style: it renders as read-only formatted output by default and
 * only becomes the live `BodyEditor` when the reader enters edit. This
 * component is that default read state.
 *
 * ## A247 — the read view is a content region, not a button
 *
 * The original K33 read view wrapped the rendered markdown in a
 * `<div role="button" tabIndex={0}>` so a click anywhere entered edit
 * (TSK-69). But the rendered markdown itself contains interactive nodes —
 * links (`<a>`) and clickable images — and a `role="button"` wrapping
 * interactive descendants is nested interactive content (WCAG 4.1.2): a
 * screen reader announces one button and cannot reach the links inside
 * it. Ken ruled (A247) the read view is restructured to a plain CONTENT
 * REGION (no `role`/`tabIndex`, links and images reachable and behaving
 * natively) plus an EXPLICIT, keyboard-accessible "Edit" button that
 * enters edit mode. This supersedes TSK-69's "click the text anywhere to
 * edit" — the enter-edit affordance is now the Edit button (and, for an
 * empty body, the placeholder), not the whole text region.
 *
 * ## Reuse of the comment renderer
 *
 * The body markdown is parsed with the SAME parser the rich editor and
 * the comment reader use (`fromMarkdown`) — K33's first bullet ("the
 * same read-only renderer comments use") is about not having a second
 * markdown dialect on the read path. Text runs, marks, links and
 * mentions are rendered by delegating to `renderCommentBody`'s exact
 * building blocks: `isSafeHref` for the link-scheme allowlist (a
 * `javascript:`/`data:` href is refused exactly as in a comment) and
 * the same `target=_blank rel=noreferrer noopener` on the anchors.
 *
 * ## Why this is not literally `renderCommentBody`
 *
 * `renderCommentBody` renders an image embed (`![alt](url)`) as a
 * *text reference*, because in a comment an attachment is an M2.5
 * reference with no URL to trust. A task body's image, though, carries
 * a real `src`, and TSK-70 requires a click on it to open a lightbox —
 * which needs a real `<img>` element to click. So this renderer adds
 * the one node the comment reader deliberately omits: an image embed
 * with a safe `http(s)`/relative `src` becomes a real `<img>`. Every
 * other node is rendered the same way the comment reader renders it.
 * The alternative — a `dangerouslySetInnerHTML` markdown-to-HTML pass —
 * is exactly the injection surface `renderCommentBody` was built to not
 * have, so it is not used here either.
 */

import type { JSONContent } from "@tiptap/core";
import type { JSX } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isSafeHref } from "../comments/renderMarkdown.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { fromMarkdown } from "./markdown.ts";
import type { MentionCandidate } from "./MentionMenu.tsx";

export interface BodyRenderedViewProps {
  readonly body: string;
  /** Placeholder shown when the body is empty (TSK-68). */
  readonly placeholder: string;
  /** Resolves `@user:<id>` to a display name for the read view. */
  readonly mentionCandidates: readonly MentionCandidate[];
  /**
   * Enters edit mode (A247). Called by the explicit "Edit" button and,
   * for an empty body, by clicking the placeholder. No caret coordinates
   * are passed: the read view is no longer a click-to-place-caret target
   * (TSK-69 superseded), so the editor opens with the caret at its
   * default position.
   */
  readonly onEnterEdit: () => void;
}

/**
 * The read state (A247): a plain content region rendering the markdown —
 * links and images are real, reachable, natively-behaving elements — with
 * an explicit, keyboard-accessible "Edit" button that enters edit mode. A
 * click on a link opens its URL and a click on an image opens the
 * lightbox (TSK-70); neither the region nor those elements enter edit.
 */
export function BodyRenderedView({
  body, placeholder, mentionCandidates, onEnterEdit,
}: BodyRenderedViewProps): JSX.Element {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const names = new Map(mentionCandidates.map(c => [c.id, c.name] as const));
  const isEmpty = body.trim() === "";

  return (
    <div data-testid="body-editor">
      {/* The explicit Edit affordance (A247). A real, keyboard-focusable
          button — the enter-edit gesture that used to live on the whole
          text region, now a discrete control that does not swallow the
          links and images inside the description. Mirrors the K100
          header Edit on milestone/sprint detail: a labelled secondary
          Button that flips read → edit. */}
      <div className="mb-1 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          testId="body-edit"
          aria-label="Edit description"
          onClick={onEnterEdit}
        >
          Edit
        </Button>
      </div>

      {/* A247: a CONTENT REGION, not a `role="button"`. No `role`,
          `tabIndex`, or click-to-edit handler wraps the rendered markdown,
          so the `<a>` and `<img>` nodes inside it are reachable and behave
          natively (no nested interactive content — WCAG 4.1.2).
          `-mx-3`/`px-3` still align the body text flush-left with the
          "DESCRIPTION" section label; the transparent border keeps the
          resting frame the edit surface mirrors. */}
      <div
        data-testid="body-rendered"
        aria-label="Description"
        // UI-21 (Ken, 2026-09-22: "why is this description section so
        // big"). `min-h-[8rem]` is 112px at the 87.5% root, and it was
        // reserved unconditionally — so a task with NO description
        // showed a one-line placeholder followed by ~100px of nothing,
        // pushing Related and Attachments off the first screen. That is
        // the common case for a newly created task.
        //
        // The height still earns its place when there IS a body: it
        // keeps the resting frame the edit surface mirrors, so entering
        // edit mode does not jolt the page. With no body there is
        // nothing to mirror and nothing to keep hittable — the
        // placeholder below is its own click target.
        className={cn(
          "prose-body -mx-3 rounded border border-transparent px-3 py-2 text-[0.9286rem] text-text-primary",
          isEmpty ? "" : "min-h-[8rem]",
        )}
      >
        {isEmpty
          ? (
              // The empty state still invites editing: the placeholder is a
              // real button (no interactive descendants to nest, so this is
              // a valid control), so a click or Enter/Space on it enters
              // edit — but the region around real content is never a button.
              <button
                type="button"
                data-testid="body-rendered-placeholder"
                onClick={onEnterEdit}
                className="cursor-text text-left text-text-tertiary"
              >
                {placeholder}
              </button>
            )
          : renderNodes(fromMarkdown(body).content ?? [], names, (src, trigger) => { setLightbox({ src, trigger }); }, "d")}
      </div>

      {lightbox !== null && (
        <ImageLightbox
          src={lightbox.src}
          returnFocusTo={lightbox.trigger}
          onClose={() => { setLightbox(null); }}
        />
      )}
    </div>
  );
}

interface LightboxState {
  readonly src: string;
  /** The image button that opened it; focus goes back here on close. */
  readonly trigger: HTMLElement;
}

type OpenLightbox = (src: string, trigger: HTMLElement) => void;

function renderNodes(
  nodes: readonly JSONContent[],
  names: ReadonlyMap<string, string>,
  openLightbox: OpenLightbox,
  keyPrefix: string,
): JSX.Element[] {
  return nodes.map((node, i) => (
    <Fragment key={`${keyPrefix}-${String(i)}`}>
      {renderNode(node, names, openLightbox, `${keyPrefix}-${String(i)}`)}
    </Fragment>
  ));
}

function renderNode(
  node: JSONContent,
  names: ReadonlyMap<string, string>,
  openLightbox: OpenLightbox,
  key: string,
): React.ReactNode {
  const kids = (): JSX.Element[] => renderNodes(node.content ?? [], names, openLightbox, key);

  switch (node.type) {
    case "paragraph":
      return <p className="my-1.5 whitespace-pre-wrap break-words">{kids()}</p>;

    case "heading": {
      const level = Number(node.attrs?.["level"] ?? 1);
      const Tag = (`h${String(Math.min(6, Math.max(1, level)))}`) as "h1";
      return <Tag className="mb-1 mt-2 font-semibold">{kids()}</Tag>;
    }

    case "bulletList":
      return <ul className="my-1.5 list-disc pl-5">{kids()}</ul>;

    case "orderedList":
      return <ol className="my-1.5 list-decimal pl-5">{kids()}</ol>;

    case "listItem":
      return <li>{kids()}</li>;

    case "blockquote":
      return (
        <blockquote className="my-1.5 border-l-2 border-border-subtle pl-3 text-text-secondary">
          {kids()}
        </blockquote>
      );

    case "codeBlock":
      return (
        <pre className="my-1.5 overflow-x-auto rounded bg-bg-muted p-2 font-mono text-[0.8571rem]">
          <code>{(node.content ?? []).map(c => c.text ?? "").join("")}</code>
        </pre>
      );

    case "horizontalRule":
      return <hr className="my-2 border-border-subtle" />;

    case "attachmentEmbed": {
      /**
       * The one node the comment reader renders as text and this one
       * renders as an element — see the file header. TSK-70 wants a
       * clickable image → lightbox.
       *
       * Any image with a safe `http(s)`/relative `src` — LOCAL or EXTERNAL
       * — becomes a real, clickable `<img>` that loads inline and opens
       * the lightbox on click (Ken's 2026-09-09 ruling, reversing A180;
       * GitHub/Jira load external images inline and users expect it). An
       * unsafe scheme (`javascript:`/`data:`) still falls back to plain
       * reference text rather than becoming an `<img src="javascript:…">`.
       *
       * NOTE the privacy tradeoff Ken accepted: an external `src` is
       * fetched the instant a task is viewed, so a description can carry a
       * tracking pixel / leak the viewer's IP+referrer to an arbitrary
       * host. `referrerPolicy="no-referrer"` is set to withhold the
       * referrer (it does not stop the fetch itself). A future hardening
       * would proxy/cache external images server-side; see the (reopened)
       * A180 note.
       */
      const src = String(node.attrs?.["src"] ?? "");
      const alt = String(node.attrs?.["alt"] ?? "");
      if (src !== "" && isSafeHref(src)) {
        // DR-A1 (K71, A11Y-62): the image sits in a real `<button>`, so
        // the lightbox opens from the keyboard (Tab, then Enter/Space)
        // and not only from a mouse click on a bare `<img>`. The button
        // is also what focus returns to when the lightbox closes, which
        // is why it is handed to `openLightbox` rather than captured
        // from `document.activeElement` (a mouse click does not focus a
        // button in every browser).
        return (
          <button
            type="button"
            data-testid="body-image-open"
            aria-label={alt !== "" ? `View image: ${alt}` : "View image"}
            // `stopPropagation` is harmless now the region is no longer a
            // button (A247) but kept so the image never triggers an
            // ancestor click handler.
            onClick={e => { e.stopPropagation(); openLightbox(src, e.currentTarget); }}
            className="my-1.5 inline-block cursor-zoom-in rounded align-top"
          >
            <img
              data-testid="body-image"
              src={src}
              alt={alt}
              // Withhold the referrer from external hosts. (Does not
              // prevent the load — see the note above.)
              referrerPolicy="no-referrer"
              className="block max-h-64 rounded border border-border-subtle"
            />
          </button>
        );
      }
      return (
        <span className="text-text-tertiary">{alt || src}</span>
      );
    }

    case "mention": {
      const id = String(node.attrs?.["userId"] ?? "");
      const name = names.get(id);
      return name === undefined
        ? <span>@user:{id}</span>
        : (
            <span
              className="mx-px inline-flex items-baseline rounded border border-accent/30 bg-accent-muted px-1 align-baseline text-[0.8571rem] font-medium text-accent"
            >
              @{name}
            </span>
          );
    }

    case "inlineMath":
    case "blockMath":
      return (
        <code className="rounded bg-bg-muted px-1 font-mono text-[0.8571rem]">
          {String(node.attrs?.["expr"] ?? "")}
        </code>
      );

    /**
     * A GFM pipe table (TSK-66). The read view renders the same table
     * node the rich editor produces, so a body with a table reads as a
     * table here too — not as the `null` the `default` branch would give
     * a node with no `.text`, which would make the table silently vanish
     * from the default read state.
     */
    case "table":
      return (
        <table className="my-1.5 w-full border-collapse text-[0.9286rem]">
          <tbody>{kids()}</tbody>
        </table>
      );

    case "tableRow":
      return <tr>{kids()}</tr>;

    case "tableHeader":
      return (
        <th className="border border-border-subtle px-2 py-1 text-left font-semibold">
          {kids()}
        </th>
      );

    case "tableCell":
      return (
        <td className="border border-border-subtle px-2 py-1 align-top">
          {kids()}
        </td>
      );

    case "text":
      return renderText(node);

    default:
      return node.text ?? null;
  }
}

/**
 * A text node with its marks — the same shape the comment reader
 * produces, so a link is `target=_blank rel=noreferrer noopener` and an
 * unsafe scheme is refused visibly (`isSafeHref`, reused).
 */
function renderText(node: JSONContent): React.ReactNode {
  let out: React.ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code className="rounded bg-bg-muted px-1 font-mono text-[0.8571rem]">{out}</code>;
        break;
      case "superscript":
        out = <sup>{out}</sup>;
        break;
      case "subscript":
        out = <sub>{out}</sub>;
        break;
      // K107. `<ins>` carries the browser's default underline; `<mark>`
      // its default highlight. Both are the same elements the on-disk
      // markdown means, so the read view matches what GitHub shows.
      case "underline":
        // No class: `<ins>` is underlined by every browser's UA
        // stylesheet, which is the whole reason this tag was chosen over
        // `<u>`. Styling it here would only risk diverging from what
        // GitHub renders for the same bytes.
        out = <ins>{out}</ins>;
        break;
      case "highlight":
        // `<mark>`'s UA default is a fixed yellow that does not follow
        // the theme (and is unreadable on the dark canvas), so this one
        // DOES need tokens — the warn pair is theme-aware in both modes.
        out = <mark className="rounded-[2px] bg-warn-bg px-0.5 text-text-primary">{out}</mark>;
        break;
      case "link": {
        const href = String(mark.attrs?.["href"] ?? "");
        out = isSafeHref(href)
          ? (
              <a
                href={href}
                rel="noreferrer noopener"
                target="_blank"
                // Opening the link is a read action (TSK-70). The region is
                // no longer a button (A247), so following the link is now
                // the plain native anchor behaviour.
                onClick={e => { e.stopPropagation(); }}
                className="text-accent underline"
              >
                {out}
              </a>
            )
          : (
              <span className="text-text-secondary">
                {out}
                {" ("}
                <span className="text-[0.8571rem]">{href}</span>
                {", link not followed)"}
              </span>
            );
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * A minimal image lightbox (TSK-70).
 *
 * A full-viewport dimmed overlay showing the image larger. Dismisses on
 * a click anywhere, on Escape, and on its Close button. Not the shared
 * `Modal`: that forces a titled, `max-w-md` panel, which is the wrong
 * shape for "show this image bigger". (Recorded in decisions.md §8.)
 *
 * ## It is a modal, so it gets the modal apparatus (DR-A1, K71)
 *
 * It says `aria-modal="true"`, and until A352 that was a claim with
 * nothing behind it: focus never moved in and Tab walked the page
 * behind the overlay. It now uses the same two hooks as every other
 * modal instead of a one-off:
 *
 * - `useFocusTrap` moves focus to the Close button, keeps Tab and
 *   Shift+Tab inside, and returns focus to the image button on close
 *   (A11Y-14, A11Y-15).
 * - `useInertBackground` makes the app chrome `inert`. That hook
 *   refuses to inert a chrome that CONTAINS the dialog (it would disable
 *   the dialog too), and the task description renders inside the
 *   chrome, so the lightbox is portalled to `document.body` to sit
 *   beside the chrome rather than in it.
 *
 * The Close button is there because a trap needs somewhere to put
 * focus, and a keyboard user needs a visible control, not just Escape.
 */
function ImageLightbox({
  src, returnFocusTo, onClose,
}: {
  readonly src: string;
  readonly returnFocusTo: HTMLElement;
  readonly onClose: () => void;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { returnFocusTo });
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      data-testid="body-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
    >
      <IconButton
        variant="secondary"
        aria-label="Close image preview"
        testId="body-image-lightbox-close"
        onClick={onClose}
        className="absolute right-4 top-4"
      >
        <Icon name="close" />
      </IconButton>
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded shadow-overlay"
      />
    </div>,
    document.body,
  );
}

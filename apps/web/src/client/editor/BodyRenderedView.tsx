/**
 * The task description's READ state (K33, TSK-68/69/70).
 *
 * K33 (Ken, 2026-09-09) makes the task description read-then-edit,
 * Jira-style: it renders as read-only formatted output by default and
 * only becomes the live `BodyEditor` when the reader clicks into it.
 * This component is that default read state.
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
import { Fragment, useCallback, useEffect, useState } from "react";

import { isSafeHref } from "../comments/renderMarkdown.tsx";
import { fromMarkdown } from "./markdown.ts";
import type { MentionCandidate } from "./MentionMenu.tsx";

export interface BodyRenderedViewProps {
  readonly body: string;
  /** Placeholder shown when the body is empty (TSK-68). */
  readonly placeholder: string;
  /** Resolves `@user:<id>` to a display name for the read view. */
  readonly mentionCandidates: readonly MentionCandidate[];
  /** Clicking the body text (not a link or image) enters edit (TSK-69). */
  readonly onEnterEdit: () => void;
}

/**
 * The read state. A click anywhere on the text enters edit (TSK-69),
 * except a click on a link (opens its URL) or an image (opens the
 * lightbox) — TSK-70.
 */
export function BodyRenderedView({
  body, placeholder, mentionCandidates, onEnterEdit,
}: BodyRenderedViewProps): JSX.Element {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const names = new Map(mentionCandidates.map(c => [c.id, c.name] as const));
  const isEmpty = body.trim() === "";

  /**
   * TSK-70's click exceptions live here, at the container, rather than
   * on each element: a click whose target is (or is inside) a link or
   * an image must NOT enter edit. Links carry their own `onClick`
   * (open in a new tab) and images open the lightbox; both
   * `stopPropagation`, so a click that reaches this handler is a click
   * on plain text — which enters edit.
   */
  const onContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("a") ?? false) return;
    if (target?.closest("img") ?? false) return;
    onEnterEdit();
  }, [onEnterEdit]);

  return (
    <div data-testid="body-editor">
      <div
        data-testid="body-rendered"
        role="button"
        tabIndex={0}
        aria-label="Description — click to edit"
        onClick={onContainerClick}
        // Keyboard parity with the click exceptions (TSK-70): Enter/Space
        // enters edit — UNLESS the focused element is a link or image, in
        // which case the keypress must activate THAT (follow the link /
        // open the lightbox), not enter edit. Without this guard a keyboard
        // user could never follow a link in the description: Enter on a
        // focused `<a>` was swallowed into edit mode.
        onKeyDown={e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          const target = e.target as HTMLElement | null;
          if ((target?.closest("a") ?? false) || (target?.closest("img") ?? false)) return;
          e.preventDefault();
          onEnterEdit();
        }}
        className="prose-body min-h-[8rem] cursor-text rounded border border-transparent px-3 py-2 text-[13px] text-text-primary hover:border-border-subtle"
      >
        {isEmpty
          ? (
              <p data-testid="body-rendered-placeholder" className="text-text-tertiary">
                {placeholder}
              </p>
            )
          : renderNodes(fromMarkdown(body).content ?? [], names, setLightboxSrc, "d")}
      </div>

      {lightboxSrc !== null && (
        <ImageLightbox src={lightboxSrc} onClose={() => { setLightboxSrc(null); }} />
      )}
    </div>
  );
}

type OpenLightbox = (src: string) => void;

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
        <pre className="my-1.5 overflow-x-auto rounded bg-bg-muted p-2 font-mono text-[12px]">
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
       * But we only AUTO-LOAD a **local** src (relative / same-origin —
       * LocTT's own attachments). An arbitrary EXTERNAL image URL
       * (`http(s)://other-host/…`, or protocol-relative `//host/…`) is
       * NOT turned into an `<img src>`: that would fetch a remote resource
       * the instant the task is viewed, leaking the viewer's IP/referrer
       * to an arbitrary host and serving as a tracking pixel — with no
       * interaction. The comment renderer deliberately shows images as
       * references for the same reason. So an external image renders as a
       * safe click-to-open LINK (opens in a new tab), not an auto-loading
       * `<img>`. An unsafe scheme (`javascript:`/`data:`) falls back to
       * plain reference text. (Agent decision A180 — flagged for Ken as a
       * privacy-vs-inline-render taste call; revert path recorded.)
       */
      const src = String(node.attrs?.["src"] ?? "");
      const alt = String(node.attrs?.["alt"] ?? "");
      // Local = a same-origin path (`/…` but NOT protocol-relative `//…`)
      // or a bare relative path with no scheme. `//host/…` is external.
      const isLocal =
        src !== ""
        && !src.startsWith("//")
        && (src.startsWith("/") || (src.indexOf(":") === -1 && isSafeHref(src)));
      if (isLocal) {
        return (
          <img
            data-testid="body-image"
            src={src}
            alt={alt}
            // The click opens the lightbox and never enters edit
            // (TSK-70). `stopPropagation` keeps it from bubbling to the
            // container's edit handler.
            onClick={e => { e.stopPropagation(); openLightbox(src); }}
            className="my-1.5 max-h-64 cursor-zoom-in rounded border border-border-subtle"
          />
        );
      }
      if (src !== "" && isSafeHref(src)) {
        // External but safe-scheme: a click-to-open link, not auto-loaded.
        return (
          <a
            data-testid="body-image-link"
            href={src}
            target="_blank"
            rel="noreferrer noopener"
            onClick={e => { e.stopPropagation(); }}
            className="text-accent underline"
          >
            {alt || src} (external image)
          </a>
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
              className="mx-px inline-flex items-baseline rounded border border-accent/30 bg-accent-muted px-1 align-baseline text-[12px] font-medium text-accent"
            >
              @{name}
            </span>
          );
    }

    case "inlineMath":
    case "blockMath":
      return (
        <code className="rounded bg-bg-muted px-1 font-mono text-[12px]">
          {String(node.attrs?.["expr"] ?? "")}
        </code>
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
        out = <code className="rounded bg-bg-muted px-1 font-mono text-[12px]">{out}</code>;
        break;
      case "superscript":
        out = <sup>{out}</sup>;
        break;
      case "subscript":
        out = <sub>{out}</sub>;
        break;
      case "link": {
        const href = String(mark.attrs?.["href"] ?? "");
        out = isSafeHref(href)
          ? (
              <a
                href={href}
                rel="noreferrer noopener"
                target="_blank"
                // Opening the link is a read action, never an edit
                // (TSK-70). `stopPropagation` keeps the container's edit
                // handler from also firing.
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
                <span className="font-mono text-[12px]">{href}</span>
                {" — link not followed)"}
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
 * a click anywhere and on Escape — the two gestures a reader expects
 * from a lightbox. Not the shared `Modal`: that forces a titled,
 * `max-w-md` panel, which is the wrong shape for "show this image
 * bigger". (Recorded in decisions.md §8.)
 */
function ImageLightbox({
  src, onClose,
}: {
  readonly src: string;
  readonly onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div
      data-testid="body-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded shadow-overlay"
      />
    </div>
  );
}

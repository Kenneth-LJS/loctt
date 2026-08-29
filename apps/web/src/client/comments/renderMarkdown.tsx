/**
 * Read-only markdown rendering for a comment body (CMT-3, CMT-9,
 * CMT-22).
 *
 * ## Why this reuses `fromMarkdown` rather than a markdown-to-HTML pass
 *
 * Three reasons, and the third is the security one.
 *
 * 1. **One parser, one set of rules.** The composer is `RichEditor`,
 *    which parses with `fromMarkdown`. If the reader used a different
 *    parser, a body could render one way while being edited and another
 *    way once posted — and CMT-3's second bullet ("reopening the
 *    comment for edit shows the source the user typed") would be
 *    comparing two dialects.
 * 2. **Mentions are already a node.** `fromMarkdown` turns
 *    `@user:<id>` into a `mention` node carrying the id and nothing
 *    else. That is exactly the shape CMT-10 needs: the chip's text
 *    comes from the *user list at render time*, so a rename shows the
 *    new name without touching a single stored byte.
 * 3. **Nothing is ever inserted as HTML.** This module builds React
 *    elements. There is no `dangerouslySetInnerHTML` anywhere on the
 *    path, so a body containing `<script>` or `<img onerror=…>` reaches
 *    the DOM as a text node — CMT-22. The neutralisation is structural
 *    rather than a sanitizer's allowlist, which is the difference
 *    between "we filtered the attacks we thought of" and "the injection
 *    point does not exist".
 *
 * `fromMarkdown` has no node for raw HTML, so `<script>alert(1)</script>`
 * matches no inline pattern and falls through to `{type: "text"}` —
 * rendered as `React.createElement`'s children, i.e. escaped.
 */

import type { JSONContent } from "@tiptap/core";
import type { JSX } from "react";
import { Fragment } from "react";

import { fromMarkdown } from "../editor/markdown.ts";

/** What a mention id resolves to, or `undefined` when it resolves to nothing. */
export interface MentionTarget {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

export type MentionResolver = (userId: string) => MentionTarget | undefined;

export interface RenderOptions {
  readonly resolveMention: MentionResolver;
  /**
   * What activating a chip does. CMT-9's third bullet requires this to
   * be "the same thing every time", so it is one callback for the whole
   * render rather than a per-node decision.
   */
  readonly onMentionActivate?: (userId: string) => void;
}

/** Renders a comment body's markdown as React elements. */
export function renderCommentBody(
  markdown: string,
  options: RenderOptions,
): JSX.Element {
  const doc = fromMarkdown(markdown);
  return (
    <div data-testid="comment-body" className="prose-body text-[13px] text-text-primary">
      {renderNodes(doc.content ?? [], options, "b")}
    </div>
  );
}

function renderNodes(
  nodes: readonly JSONContent[],
  options: RenderOptions,
  keyPrefix: string,
): JSX.Element[] {
  return nodes.map((node, i) => (
    <Fragment key={`${keyPrefix}-${String(i)}`}>
      {renderNode(node, options, `${keyPrefix}-${String(i)}`)}
    </Fragment>
  ));
}

function renderNode(
  node: JSONContent,
  options: RenderOptions,
  key: string,
): React.ReactNode {
  const kids = (): JSX.Element[] => renderNodes(node.content ?? [], options, key);

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
      /**
       * The fence's text is a plain `text` child, so it lands as a DOM
       * text node. A body of "```\n<script>…\n```" therefore renders
       * the tag *visibly as source*, which is what a code block is for
       * and what CMT-22 wants to see happen to it.
       */
      return (
        <pre
          data-testid="comment-code-block"
          className="my-1.5 overflow-x-auto rounded bg-bg-muted p-2 font-mono text-[12px]"
        >
          <code>{(node.content ?? []).map(c => c.text ?? "").join("")}</code>
        </pre>
      );

    case "horizontalRule":
      return <hr className="my-2 border-border-subtle" />;

    case "mention":
      return <MentionChip userId={String(node.attrs?.["userId"] ?? "")} options={options} />;

    case "inlineMath":
    case "blockMath":
      // No KaTeX on the read path; the expression is shown as source
      // rather than dropped, which is the same failure mode
      // `fromMarkdown` chose for anything it cannot represent.
      return (
        <code className="rounded bg-bg-muted px-1 font-mono text-[12px]">
          {String(node.attrs?.["expr"] ?? "")}
        </code>
      );

    case "attachmentEmbed":
      // Attachments are M2.5. Showing the reference is honest; guessing
      // a URL for it would render a broken image.
      return (
        <span className="text-text-tertiary">
          {String(node.attrs?.["alt"] ?? "") || String(node.attrs?.["src"] ?? "")}
        </span>
      );

    case "text":
      return renderText(node);

    default:
      // An unknown node still shows whatever text it carries rather
      // than vanishing — the same rule the parser applies.
      return node.text ?? null;
  }
}

/**
 * A text node with its marks applied.
 *
 * `link` is a mark rather than a node, and its `href` is the one place
 * a comment body reaches an *attribute* rather than a text node — so it
 * is the one place CMT-22's injection surface survives the
 * React-elements design. `javascript:` and `data:` URLs are refused
 * here: a `<a href="javascript:…">` built by React executes exactly as
 * one built by innerHTML would.
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
        out = (
          <code
            data-testid="comment-code"
            className="rounded bg-bg-muted px-1 font-mono text-[12px]"
          >
            {out}
          </code>
        );
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
                className="text-accent-fg underline"
              >
                {out}
              </a>
            )
          /**
           * Refused, and refused *visibly*: the link text stays and
           * the URL is shown beside it as ordinary text.
           *
           * The URL is deliberately **not** put in a `title` or any
           * other attribute. A `title` is inert, so it would not
           * execute — but "inert today" is how an attribute sink
           * becomes a live one after a refactor, and the reader who
           * needs to see what the link pointed at is better served by
           * text they can read without hovering.
           */
          : (
              <span data-testid="comment-unsafe-link" className="text-text-secondary">
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
 * Which link schemes may become an `href`.
 *
 * An allowlist rather than a `javascript:` denylist: `\tj\na\tv…` and
 * `JaVaScRiPt:` both defeat a denylist, and the set of schemes a
 * comment legitimately needs is small and closed.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  // A scheme-relative or relative path with no colon before the first
  // slash cannot name a scheme at all.
  const colon = trimmed.indexOf(":");
  if (colon === -1) return true;
  const scheme = trimmed
    .slice(0, colon)
    // Control characters inside a scheme are stripped by the URL
    // parser, so strip them before comparing rather than after.
    .replace(/[\u0000-\u0020]/g, "");
  return scheme === "http" || scheme === "https" || scheme === "mailto";
}

/**
 * One `@user:<id>` reference.
 *
 * **Resolved → a chip.** CMT-9 requires it to be distinguishable from
 * prose "by more than colour", so it carries a background, a border, a
 * leading `@` glyph and a role — a screen reader and a monochrome
 * display both see something a run of text does not have.
 *
 * **Unresolvable → plain text.** CMT-9's last bullet, and CMT-8's
 * third: a token naming nobody is not a broken chip, it is the text the
 * user typed. It renders as the literal `@user:<id>` because that is
 * what is on disk, and inventing a friendlier rendering for a reference
 * to nobody would be claiming knowledge we do not have.
 *
 * **Archived → a chip with an archived treatment.** CMT-8's last
 * bullet: a user archived *after* being mentioned still resolves, so
 * the historical attribution survives. It is only *new* mentions the
 * autocomplete refuses to offer.
 */
function MentionChip({
  userId,
  options,
}: {
  readonly userId: string;
  readonly options: RenderOptions;
}): JSX.Element {
  const target = options.resolveMention(userId);

  if (target === undefined) {
    return (
      <span data-testid="mention-plain" data-mention-unresolved="true">
        @user:{userId}
      </span>
    );
  }

  const activate = options.onMentionActivate;
  const label = `@${target.name}`;

  const className =
    "mx-px inline-flex items-baseline rounded border px-1 align-baseline text-[12px] font-medium "
    + (target.archived
      ? "border-border-subtle bg-bg-muted text-text-tertiary line-through decoration-1"
      : "border-accent-fg/30 bg-accent-muted text-accent-fg");

  if (activate === undefined) {
    return (
      <span
        data-testid="mention-chip"
        data-mention-id={target.id}
        {...(target.archived ? { "data-mention-archived": "true" } : {})}
        className={className}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="mention-chip"
      data-mention-id={target.id}
      {...(target.archived ? { "data-mention-archived": "true" } : {})}
      // CMT-9: "the same thing every time" — every chip, archived or
      // not, filters the list to that user.
      title={
        target.archived
          ? `${target.name} (archived) — show their tasks`
          : `${target.name} — show their tasks`
      }
      onClick={() => { activate(target.id); }}
      className={className}
    >
      {label}
    </button>
  );
}

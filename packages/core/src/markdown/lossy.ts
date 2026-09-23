/**
 * Lossy-content detection for the WYSIWYG body editor (B5).
 *
 * TipTap drops any node its registered schema does not recognise. So
 * opening a body that contains an unregistered construct in visual
 * mode and saving it silently deletes that content — the user sees a
 * successful save and loses a footnote.
 *
 * The guardrail is detect → warn → force source mode. This module is
 * the detection half, and lives in core rather than the editor for two
 * reasons: it is pure text analysis with no DOM, so it is testable
 * without a browser; and the CLI and MCP can warn about the same
 * bodies without importing an editor.
 *
 * **The list is deliberately narrow.** Every LocTT extension that has a
 * custom TipTap node — KaTeX, super/subscript, mentions, attachment
 * embeds — is representable and therefore NOT reported here. Only
 * constructs with no node at all are. A detector that over-reports
 * pushes users into source mode for content the editor handles
 * perfectly well, which trains them to ignore the banner.
 */

/** A construct in a body that the visual editor cannot represent. */
export interface LossyConstruct {
  readonly kind: "footnote" | "raw_html";
  /** 1-based line number where it was found. */
  readonly line: number;
  /** The offending text, trimmed and truncated for display. */
  readonly excerpt: string;
}

/**
 * HTML tags the editor can round-trip because a TipTap node maps to
 * them. Anything else is raw HTML that would be dropped.
 *
 * Kept as an allowlist rather than a blocklist: a new unknown tag must
 * fail closed (force source mode) rather than be silently destroyed.
 */
const ALLOWED_HTML_TAGS: ReadonlySet<string> = new Set([
  "b", "strong", "i", "em", "s", "del", "code", "pre", "br", "hr",
  "p", "blockquote", "ul", "ol", "li", "a", "img",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "sup", "sub",
  // `ins` is underline's on-disk spelling (K107/A251) and `mark` is what
  // the highlight mark renders to. Both have a TipTap mark in
  // `apps/web/src/client/editor/extensions.ts`, so they round-trip and
  // must NOT be reported — without an entry here a single underlined
  // word would banish the whole body to source mode, which is a far
  // larger regression than the mark is a feature.
  //
  // `del` above is likewise earned rather than assumed: StarterKit's
  // `strike` mark parses `s`, `del` AND `strike` (verified against the
  // live schema), so all three have a node behind them.
  "ins", "mark",
]);

/** `[^1]: text` definition, or a `[^1]` reference. */
const FOOTNOTE_DEF_RE = /^\s*\[\^[^\]]+\]:/;
const FOOTNOTE_REF_RE = /\[\^[^\]]+\]/;

/** An HTML tag: captures the tag name from `<tag …>` or `</tag>`. */
const HTML_TAG_RE = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;

/**
 * Returns every construct in `body` that the WYSIWYG editor cannot
 * represent. An empty array means the body is safe to edit visually.
 *
 * Fenced code blocks and inline code are skipped: a `<div>` inside a
 * fence is sample text, not markup the editor would try to parse, and
 * reporting it would force source mode on any body documenting HTML.
 */
export function findLossyConstructs(body: string): readonly LossyConstruct[] {
  const found: LossyConstruct[] = [];
  const lines = body.split("\n");
  let inFence = false;
  let fenceMarker = "";

  for (const [i, raw] of lines.entries()) {
    const line = raw ?? "";
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0] ?? "";
      } else if (marker[0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    // Strip inline code before scanning: `<div>` in a code span is
    // documentation, not markup.
    const scannable = line.replace(/`[^`]*`/g, "");

    if (FOOTNOTE_DEF_RE.test(scannable) || FOOTNOTE_REF_RE.test(scannable)) {
      found.push({ kind: "footnote", line: i + 1, excerpt: excerpt(line) });
      continue;
    }

    for (const m of scannable.matchAll(HTML_TAG_RE)) {
      const tag = (m[1] ?? "").toLowerCase();
      if (ALLOWED_HTML_TAGS.has(tag)) continue;
      found.push({ kind: "raw_html", line: i + 1, excerpt: excerpt(m[0]) });
      break; // one report per line is enough to force source mode
    }
  }

  return found;
}

/** True when the body must be edited in source mode. */
export function requiresSourceMode(body: string): boolean {
  return findLossyConstructs(body).length > 0;
}

function excerpt(text: string): string {
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

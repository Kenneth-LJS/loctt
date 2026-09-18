/**
 * @mention autocomplete.
 *
 * Stores `@user:<id>` — the id is the payload and the display name is
 * resolved at render time, so renaming a user does not require
 * rewriting every body that mentions them. That is the on-disk
 * convention in `docs/dev/markdown-extensions.md`, and core's
 * `extractMentions` is the reader half of the same contract.
 *
 * The trigger rule matches `extractMentions` deliberately: an `@` that
 * follows a word character is not a mention, so `bob@example.com` does
 * not open the menu. A picker that fired there would insert a mention
 * into the middle of an email address.
 */

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";

export interface MentionCandidate {
  readonly id: string;
  readonly name: string;
  /**
   * A secondary line that tells two same-named users apart — CMT-7's
   * third bullet asks for "email, or truncated id". Names are not
   * unique in LocTT (ULIDs disambiguate, per `UserProfileSchema`'s own
   * note), so without this a picker showing two identical rows makes
   * the choice a coin flip.
   *
   * Optional because the body editor's picker (M2.3) predates this and
   * a candidate list built without it still works.
   */
  readonly hint?: string;
}

export interface MentionState {
  readonly open: boolean;
  readonly query: string;
  readonly matches: readonly MentionCandidate[];
  readonly highlighted: number;
  readonly choose: (candidate: MentionCandidate) => void;
}

/** Only fires when `@` starts a word — see the note above. */
export const TRIGGER_RE = /(?:^|[^\w@])@([\w-]*)$/;

/**
 * The query an `@` trigger implies for the text before the caret, or
 * `null` when this is not a mention position.
 *
 * Exported so the trigger rule can be tested against the same cases
 * core's `extractMentions` is tested against, without a browser and
 * without a ProseMirror instance. The rule is a *contract* with core —
 * a picker that fired where `extractMentions` would not read a mention
 * inserts a token nothing downstream recognises.
 */
export function mentionQuery(textBeforeCaret: string): string | null {
  const m = TRIGGER_RE.exec(textBeforeCaret);
  return m ? (m[1] ?? "") : null;
}

/**
 * True when the caret sits inside code — an inline code span (a `code`
 * mark) or a fenced block (a `codeBlock` node).
 *
 * Exported for the same reason `mentionQuery` is: it is half of the
 * trigger rule, and a test that can only reach it through a real
 * ProseMirror view is a test nobody writes.
 */
export function inCodeContext(editor: Editor): boolean {
  if (editor.isActive("code")) return true;
  if (editor.isActive("codeBlock")) return true;
  // `isActive("code")` reads the *stored* marks at an empty selection,
  // which are cleared the moment the caret moves rather than types. So
  // also ask what the character immediately before the caret carries:
  // typing `@` at the end of an existing code span must not open the
  // picker either.
  const { from, empty } = editor.state.selection;
  if (!empty || from === 0) return false;
  const before = editor.state.doc.resolve(from).nodeBefore;
  return before?.marks.some(m => m.type.name === "code") ?? false;
}

export function useMentionState(
  editor: Editor | null,
  candidates: readonly MentionCandidate[],
): MentionState {
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = query === null
    ? []
    : candidates
      .filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);

  const choose = useCallback((candidate: MentionCandidate) => {
    if (!editor || query === null) return;
    const { from } = editor.state.selection;
    // `@` plus what has been typed since — replaced wholesale so the
    // literal text the user typed does not survive alongside the node.
    const start = from - (query.length + 1);
    editor
      .chain()
      .focus()
      .deleteRange({ from: start, to: from })
      .insertContent({ type: "mention", attrs: { userId: candidate.id } })
      .run();
    setQuery(null);
  }, [editor, query]);

  useEffect(() => {
    if (!editor) return undefined;
    const onUpdate = () => {
      const { from, empty } = editor.state.selection;
      if (!empty) { setQuery(null); return; }
      // CMT-7's fourth bullet: no picker inside a code span or a
      // fenced block. Asked of the *document*, not of the text — the
      // caret's marks and its parent node are what ProseMirror
      // actually knows, and a regex over the preceding 40 characters
      // cannot see a fence that opened five lines up.
      //
      // This is the same rule core applies when reading (`codeSpans`
      // in `comments.ts`): an `@user:` token inside code is
      // documentation of the syntax, never a mention. A picker firing
      // there would insert a token core will not read back.
      if (inCodeContext(editor)) { setQuery(null); return; }
      const before = editor.state.doc.textBetween(Math.max(0, from - 40), from, "\n", "\n");
      setQuery(mentionQuery(before));
      setHighlighted(0);
    };
    editor.on("selectionUpdate", onUpdate);
    editor.on("update", onUpdate);
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // Arrow keys and Enter drive the list while it is open. Registered on
  // the document in the capture phase so ProseMirror's own Enter
  // handler does not insert a paragraph before the pick lands.
  useEffect(() => {
    if (query === null || matches.length === 0) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted(h => (h + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted(h => (h - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        const pick = matches[highlighted];
        if (pick) { e.preventDefault(); choose(pick); }
      } else if (e.key === "Escape") {
        setQuery(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); };
  }, [query, matches, highlighted, choose]);

  return { open: query !== null && matches.length > 0, query: query ?? "", matches, highlighted, choose };
}

export function MentionMenu({ state }: { readonly state: MentionState }): React.JSX.Element | null {
  if (!state.open) return null;
  return (
    <ul
      role="listbox"
      aria-label="Mention a user"
      data-testid="mention-menu"
      className="mx-3 mb-2 rounded border border-border-subtle bg-bg-surface text-[0.9286rem]"
    >
      {state.matches.map((c, i) => (
        <li key={c.id}>
          <button
            type="button"
            role="option"
            aria-selected={i === state.highlighted}
            data-testid={`mention-option-${c.id}`}
            onMouseDown={e => { e.preventDefault(); state.choose(c); }}
            className={
              "w-full px-2 py-1 text-left "
              + (i === state.highlighted ? "bg-accent-muted" : "hover:bg-bg-muted")
            }
          >
            <span className="block">{c.name}</span>
            {c.hint !== undefined && (
              <span
                data-testid={`mention-hint-${c.id}`}
                className="block font-mono text-[0.7857rem] text-text-tertiary"
              >
                {c.hint}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

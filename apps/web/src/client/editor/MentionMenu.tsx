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
      className="mx-3 mb-2 rounded border border-border-subtle bg-bg-surface text-[13px]"
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
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

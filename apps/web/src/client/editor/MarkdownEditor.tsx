import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { useEffect, useRef } from "react";

/**
 * Marks a dispatch as originating from the `value` prop rather than the
 * user. Without it the sync effect's own document rewrite would fire
 * `onChange`, and a controlled parent would loop.
 */
const externalSync = Annotation.define<boolean>();

/** Extensions governing editability, grouped so they swap as a unit. */
function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/**
 * CodeMirror's generated theme is a static stylesheet, so colours are
 * expressed as `var(--token)` rather than resolved values. A theme flip
 * toggles one class on <html> and the editor recolours with it — no
 * rebuild, no React re-render, and no second source of truth for the
 * palette.
 */
const loctSyntaxTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: "14px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    caretColor: "var(--text-primary)",
    padding: "8px 0",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-muted)",
    color: "var(--text-tertiary)",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-activeLine": { backgroundColor: "var(--bg-muted)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-muted-hover)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  ".cm-placeholder": { color: "var(--text-tertiary)" },
  // CodeMirror scopes selection styling behind `.cm-focused` with high
  // specificity; matching it here keeps our token colour from losing.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--accent-muted)",
    },
});

export interface MarkdownEditorProps {
  /** Current document text. Treated as the source of truth. */
  value: string;
  /** Called with the full document text after every user edit. */
  onChange: (next: string) => void;
  /** When true the document is not editable, but stays selectable. */
  readOnly?: boolean;
  /** Text shown while the document is empty. */
  placeholder?: string;
  /** Applied to the element CodeMirror mounts into. */
  className?: string;
  /** Accessible name for the editing surface. */
  ariaLabel?: string;
}

/**
 * Raw-markdown editing surface backed by CodeMirror 6.
 *
 * The EditorView lives outside React's render cycle in a ref: React owns
 * mounting and unmounting, CodeMirror owns the document and the cursor.
 * Props are pushed in via effects rather than by rebuilding the view, so
 * a re-render never costs the user their selection or undo history.
 */
export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  ariaLabel,
}: MarkdownEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Per-instance: a shared compartment would let one editor's
  // reconfigure land in another's state.
  const readOnlyCompartmentRef = useRef(new Compartment());

  // `onChange` is read through a ref so a caller passing an inline
  // arrow does not tear down and rebuild the editor on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Only `value` at mount seeds the document; later changes are synced
  // by the effect below. Reading it here via a ref keeps it out of the
  // mount effect's dependencies without lying to the linter.
  const initialValueRef = useRef(value);

  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const ariaLabelRef = useRef(ariaLabel);
  ariaLabelRef.current = ariaLabel;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      loctSyntaxTheme,
      EditorView.updateListener.of((update) => {
        // `docChanged` covers programmatic updates too; the sync effect
        // marks its own dispatches so they don't echo back to onChange.
        if (!update.docChanged) return;
        if (update.transactions.some((tr) => tr.annotation(externalSync) === true)) return;
        onChangeRef.current(update.state.doc.toString());
      }),
      readOnlyCompartmentRef.current.of(readOnlyExtensions(readOnlyRef.current)),
    ];

    const label = ariaLabelRef.current;
    if (label !== undefined) {
      extensions.push(EditorView.contentAttributes.of({ "aria-label": label }));
    }
    const ph = placeholderRef.current;
    if (ph !== undefined) {
      extensions.push(placeholderExt(ph));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: initialValueRef.current, extensions }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Push external `value` changes in as a document replacement. The
  // equality check is belt-and-braces: React already skips this effect
  // when `value` is unchanged, so it only bites when the effect re-runs
  // against an identical document (StrictMode remounts), where a blind
  // rewrite would drop the user's selection.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalSync.of(true),
    });
  }, [value]);

  // Reconfiguring is cheaper than rebuilding, and preserves the
  // document and cursor when a form flips between view and edit.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} className={className} data-testid="markdown-editor" />;
}

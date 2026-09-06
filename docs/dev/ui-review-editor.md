# UI + Functional review — rich-text / markdown body editor

Scope: the TipTap-based task-body / comment editor.
Files: `apps/web/src/client/editor/{RichEditor,Toolbar,markdown,BodyEditor,MarkdownEditor,extensions}.tsx/.ts`.
Method: live repro on http://localhost:7755 against DEMO-4 (description editor) and its comment editor, plus reading source. Live actions driven through the running app (throwaway demo); the editor JS was inspected via the `.editor` handle TipTap exposes on the ProseMirror DOM node.

---

## 1. Heading — the core complaint

### Root cause (one line)

**The heading control is functionally wired and round-trips correctly; the actual defect is that the toolbar hard-codes a single H2 button (`Toolbar.tsx:31-34`) — there is no H1–H6 picker — and applying it to a *whole-paragraph selection* leaves the caret in a freshly-created trailing empty paragraph, so the button does not light up, which reads as "doesn't even work."**

### What I did live and observed

1. Opened DEMO-4. Description body = `The main detail pane. Blocked on the API shape.`, rendered `<p>…</p>` in `[data-testid="rich-editor"]`.
2. Clicked into the paragraph, `Ctrl/Cmd+A`, clicked the **Heading** button (`fmt-heading`).
   - **Observed:** DOM became `<h2>The main detail pane…</h2><p><br></p>`. **The H2 was applied.** So `toggleHeading({level:2})` at `Toolbar.tsx:33` is *not* a no-op.
   - **Observed:** the Heading button's `aria-pressed` was **`false`** immediately after — because select-all + toggleHeading moved the ProseMirror selection into the new trailing empty `<p>`, not into the heading.
3. Clicked directly inside the `<h2>` text. Re-read the button: `aria-pressed="true"`.
   - **Conclusion:** the active-state detection (`ed.isActive("heading", {level:2})`, `Toolbar.tsx:32,59`) is **correct**. It only looked broken in step 2 because the caret was no longer in the heading.
4. Toggled to **Markdown** mode: raw buffer = `## The main detail pane. Blocked on the API shape.` — `toMarkdown` (`markdown.ts:362-365`) serialized the heading correctly.
5. **Reloaded the page.** Rich editor rendered `<h2>…</h2>` again.
   - **Conclusion:** the full chain editor → `toMarkdown` (`##`) → save → `fromMarkdown` (`markdown.ts:168-177`, `/^(#{1,6})\s+/`) → `<h2>` **round-trips end-to-end.** No data loss, no drop.

So none of the four candidate break-points the ticket lists is actually broken for H2: the toolbar action fires, active-state detects, StarterKit levels are configured, and the markdown round-trip is intact.

### Where the chain *does* fall down

| Link in the chain | Status | Evidence |
|---|---|---|
| Toolbar action fires | Works | H2 applied live |
| Active-state detects | Works (but caret-dependent) | `aria-pressed=true` when caret in `<h2>` |
| StarterKit levels config | Works — **all 6 enabled** | `heading` ext `options.levels = [1,2,3,4,5,6]` read live; `StarterKit.configure({link:false})` does not restrict levels (`RichEditor.tsx:48`) |
| `fromMarkdown` / `toMarkdown` | Works for all levels | `##` round-trips through reload; parser accepts `#{1,6}`, serializer clamps 1–6 |
| **UI exposes the levels** | **BROKEN** | only `{level:2}` is offered (`Toolbar.tsx:32-33`) |
| **Caret after applying to a full selection** | **Poor UX** | select-all → toggle drops caret into a new trailing `<p>`; button reads not-pressed |

I applied H1, H3, H4, H6 through the live editor (`setHeading({level:n})`): each produced the correct `<h1>`…`<h6>`. **The levels work; the UI just never offers them.**

### Severity

- No H1–H6 control: **P1** (the reported complaint; only H2 reachable via toolbar).
- Caret/active-state after whole-selection toggle: **P2** (feeds the "doesn't work" perception; the format *is* applied).

### Fix direction

- Replace the single Heading button with a **level control** — a dropdown (`Paragraph, H1…H6`) or a small segmented set — driven by `setHeading({level})` / `setParagraph()`, with active-state read per level via `isActive("heading",{level})`. No new extension, no serializer change: levels are already enabled and already round-trip. This is **UI + wiring only.**
- Optionally, after applying a block type to a selection, collapse the caret back into the transformed block so the control reflects state immediately. (Also note StarterKit's typing input rule — `# ` + space — already makes an H1 while typing; the toolbar is the discoverable path that's missing.)

---

## 2. The other controls (`Toolbar.tsx:24-41`)

Applied each live via the editor (`toggleX().run()` on a selection) and inspected resulting HTML; the marks' serializers in `markdown.ts` are the round-trip path.

| Button | Applies? | Round-trips? | Notes |
|---|---|---|---|
| Bold | Yes → `<strong>` | Yes (`**`, `MARK_WRAPPERS` `markdown.ts:415-422`) | — |
| Italic | Yes → `<em>` | Yes (`*`) | — |
| Code | Yes → `<code>` | Yes (`` ` ``) | — |
| Code block | Yes → `<pre><code>` | Yes (fence, `markdown.ts:366-369`) | — |
| Bulleted list | Yes → `<ul><li>` | Yes | — |
| Quote | Yes → `<blockquote>` | Yes (`markdown.ts:375-381`) | — |
| Link | Yes → `<a>` (prompts for URL; cancel = no-op) | Yes (`[text](url)`) | Sensible empty-href guard (`Toolbar.tsx:120-122`) |

All seven work and round-trip. Two functional gaps:

- **No ordered-list button (P2).** Only `bulletList` is exposed, yet both `fromMarkdown` (`markdown.ts:200-219`) and `toMarkdown` (`markdown.ts:382-397`) fully support ordered lists. A body with `1.` items renders and edits, but a user cannot *create* one from the toolbar. Parity gap: pipeline supports it, UI doesn't (same shape as the heading complaint).
- **No strikethrough / super / subscript / math / mention buttons.** These marks/nodes exist in `extensions.ts` and round-trip, but are only reachable by typing raw syntax or pasting. Acceptable as a scope call, but worth recording — they are silently second-class in rich mode. **P3.**

### Look ("controls look terrible") — P2

Each button is a hand-rolled `<button>` with inline Tailwind (`Toolbar.tsx:74-91`, and `LinkButton` duplicating the same class string at `124-127`). There is **no shared button primitive** in `apps/web/src/client/components` (only `RefreshButton.tsx` exists). This is the same toolbar/consistency drift called out in the other reviews — not re-derived here; it applies. Buttons are 12px text labels (no icons), which reads as cramped and unpolished next to icon toolbars users expect. Fix direction: adopt a shared icon-button primitive and give the toolbar icons + tooltips; fold the level control into it.

---

## 3. General jank

- **No placeholder in the rich editor (P2).** `RichEditor` registers no TipTap `Placeholder` extension. Live: an empty comment rich editor is `<p><br></p>` with **no hint text**. The *raw* CodeMirror editor has a placeholder ("Describe this task…", `BodyEditor.tsx:167`, `MarkdownEditor.tsx:134-136`), so the two modes are inconsistent and the rich empty-state looks broken/blank. Fix: add `@tiptap/extension-placeholder` with the same copy.
- **Markdown paste is not parsed (P2).** Live: pasting `# Heading\n\n- item one\n- item two` into the rich editor produced three literal paragraphs (`<p># Heading</p><p>- item one</p>…`), not a heading + list. `fromMarkdown` runs only on initial `content` (`RichEditor.tsx:64`), never on paste. Users pasting markdown (the common case for this audience) get literal `#`/`-` text. Fix direction: a paste handler that routes `text/plain` through `fromMarkdown` when it looks like markdown.
- **Caret after whole-selection block toggles (P2).** As in §1 — selecting a paragraph and toggling heading/list/quote leaves a trailing empty block and the caret outside the transformed node. Repeated toggles accumulate empty blocks (observed `<h3>…</h3><h3><br></h3><p><br></p>` after successive applies over a growing selection). Cosmetic + confusing, no data loss.
- **Rich↔raw toggle is solid (works as designed).** `RichBuffer` (`markdown.ts:64-103`) keeps markdown as the source of truth and only serializes on a real edit, so merely opening rich mode does not normalize the body. Verified the toggle preserved `##` after a rich edit and the reload confirmed byte-level persistence. No jank here — this is the strong part of the design.
- **"Can't be edited here" fallback (works as designed).** `BodyEditor.tsx:46-47,136-148` forces raw mode when `lossyConstructs` is non-empty. Detection is server-side and narrow (`packages/core/src/markdown/lossy.ts`): only **footnotes** (`[^1]`) and **unregistered raw HTML** (tags outside the allowlist) force raw; every LocTT extension node (math, super/sub, mentions, embeds) is representable and deliberately *not* reported. The Rich button is correctly disabled in that state. This path is coherent; no defect found. (Minor: GFM pipe-tables are in the HTML allowlist but there is no table TipTap node and `fromMarkdown` doesn't parse `| a | b |` markdown tables — a markdown table would be shown as literal paragraph text rather than forcing raw. Edge case, **P3**.)
- **Two editors, shared testid.** Both description and comment surfaces render `[data-testid="rich-editor"]` and `[data-testid="rich-editor"]`-scoped toolbars; not a user-facing bug but makes the DOM ambiguous (had to scope by `[data-testid="body-editor"]`). **P3**, test-hygiene.

---

## 4. What headings SHOULD be

**Proposed control:** a **level dropdown** in the toolbar — `Paragraph, Heading 1 … Heading 6` — replacing the lone Heading button. A `<select>` (or a small menu) is the right shape here because six levels as six buttons would dominate a toolbar that's already unpolished. It should:

- show the current block's level as its value (read via `isActive("heading",{level})`, falling back to Paragraph);
- call `editor.chain().focus().setHeading({level}).run()` for H1–H6 and `setParagraph()` for Paragraph;
- live inside the shared icon-button/toolbar primitive recommended in §2.

**Confirmed no round-trip blocker and no new extension needed:**
- StarterKit's `heading` extension is registered with `levels = [1,2,3,4,5,6]` (read live) — the default; nothing in `RichEditor.tsx` restricts it.
- `setHeading({level:n})` for n∈{1,3,4,6} produced correct `<h1>`/`<h3>`/`<h4>`/`<h6>` live.
- `toMarkdown` (`markdown.ts:362-365`) emits `#`×level (clamped 1–6); `fromMarkdown` (`markdown.ts:168-177`) parses `#{1,6}`. H2 was verified surviving a real save+reload.

So the entire fix for the P1 complaint is **UI + wiring**. The round-trip is *not* the blocker.

---

## Severity summary

| # | Finding | Severity |
|---|---|---|
| 1 | No H1–H6 control — only H2 offered (the reported complaint) | **P1** |
| 2 | Caret/active-state after whole-selection block toggle (feeds "doesn't work") | P2 |
| 3 | No ordered-list button despite full pipeline support | P2 |
| 4 | Toolbar buttons hand-rolled, no shared primitive, text-only, look poor | P2 |
| 5 | No placeholder in rich editor (inconsistent with raw mode) | P2 |
| 6 | Markdown paste inserted as literal text, not parsed | P2 |
| 7 | Strike/super/sub/math/mention have no toolbar buttons | P3 |
| 8 | GFM pipe-tables neither parsed nor forced-to-raw | P3 |
| 9 | Shared `rich-editor` testid across two surfaces | P3 |

**Counts:** P1 × 1, P2 × 5, P3 × 3.

Verified-working (not defects): the H2 round-trip end-to-end, active-state detection when caret is in-node, all seven mark/node toggles, the rich↔raw toggle's non-normalizing buffer, and the lossy-content force-raw fallback.

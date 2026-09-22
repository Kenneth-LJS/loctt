# LocTT markdown extensions

Task bodies are stored as plain markdown (CommonMark / GitHub-Flavored
Markdown) in `.loctt/tasks/<id>/task.md`. The WYSIWYG editor in the UI
supports a few features that vanilla CommonMark can't express; those
features use the on-disk conventions documented here so that:

- The file on disk stays readable as markdown.
- Agents reading task bodies via `get_task` (MCP) see a stable,
  predictable syntax — they should **not** "correct" or "normalize"
  these tokens.
- The editor can round-trip a body losslessly between WYSIWYG and
  markdown-source modes.

## On-disk syntax table

| Feature | Source representation | Notes |
|---|---|---|
| Bold / italic / code | `**bold**` / `*italic*` / `` `code` `` | CommonMark |
| Strikethrough | `~~text~~` | GFM (double tilde) |
| Headings | `# H1` … `###### H6` | CommonMark |
| Block quote | `> quote` | CommonMark |
| Ordered / unordered list | `1.`, `-`, `*` | CommonMark |
| GFM task list | `- [ ] todo`, `- [x] done` | GFM |
| Footnotes | `[^1]` references + `[^1]: text` | Common extension |
| Tables | GFM pipe tables | GFM |
| Code blocks (lang) | ` ```ts ` fences | CommonMark info-string |
| Code blocks (line highlight) | ` ```ts {3,5-7} ` info-string | Convention shared with many doc tools |
| Inline KaTeX | `$expr$` | LocTT extension |
| Block KaTeX | `$$\nexpr\n$$` | LocTT extension |
| Superscript | `^text^` | Pandoc-style |
| Subscript | `~text~` | Pandoc-style (single tilde — distinct from `~~strikethrough~~`) |
| Mention | `@user:<id>` | LocTT extension; renderer resolves to display name |
| Task reference | `T-123` | Autolinked at render time. No on-disk syntax — bare keys are detected and linked |
| Image embed | `![alt](attachments/<name>)` | Standard markdown |
| Video / audio embed | `![alt](attachments/<name>)` | Standard markdown image syntax; renderer dispatches by MIME |
| Non-media file embed | `![[attachments/<name>]]` | LocTT extension, Obsidian-style |

Anything not listed above falls back to CommonMark / GFM semantics. If
a body contains constructs the WYSIWYG editor cannot represent cleanly
(arbitrary HTML outside the allowlist, unknown directives), the editor
shows a banner and forces source-mode editing for that task — see
**lossy-content guardrail** below.

## Attachment embedding

The renderer dispatches embedded attachments by MIME (derived from the
file extension; see `packages/core/src/task/mime.ts`):

- `image/*` → inline `<img>`
- `video/*` → inline `<video>`
- `audio/*` → inline `<audio>`
- everything else → inline file chip (icon + filename + size + download)

All four forms point at the same backing path: `attachments/<name>`
relative to the task folder. The on-disk file is fetched via the
existing `GET /api/tasks/:ref/attachments/:name` endpoint.

### Security

The download endpoint **always** serves `application/octet-stream` with
`X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.
The UI uses the `mime` field on `AttachmentResponse` (returned by
`get_task` and `GET /api/tasks/:ref`) to dispatch inline renderers, and
must:

- Wrap image/video/audio renders in a sandboxed `<img>` / `<video>` /
  `<audio>` using a blob URL, never via direct `src` on the URL.
- Treat `image/svg+xml` and `text/html` as script-capable formats —
  embed them via a sandboxed `<iframe srcdoc>` (with the `sandbox`
  attribute) or run them through a sanitizer (e.g. DOMPurify) before
  injecting.

Do **not** switch the download endpoint to a derived `Content-Type`
header; an inline `image/svg+xml` or `text/html` upload would be an
XSS hole even with `nosniff`.

### Authoring flow (Jira-style)

The editor offers three ways to add attachments:

1. **Drag-drop / paste into the editor.** Upload via
   `POST /api/tasks/:ref/attachments`, wait for the response, then
   insert the appropriate markdown at the cursor. Upload failure ⇒
   no insertion, toast the error.
2. **Insert existing attachment.** Toolbar button opens a picker of
   the task's existing attachments; selecting one inserts the matching
   markdown.
3. **Attach without embedding.** The existing Attachments panel on
   task detail still accepts uploads independently — body is untouched.

All three paths hit the same backend endpoint; the difference is purely
on the UI side.

## Lossy-content guardrail

When the editor opens a task, it parses the body. If parsing finds
constructs that can't be represented in the WYSIWYG node tree, the
editor:

1. Refuses to enter WYSIWYG mode for that body.
2. Shows a banner: *"This task body contains markdown features that
   can't be edited visually. Edit in source mode."*
3. Forces source-mode editing for the rest of the session on that task.

This prevents the editor from silently dropping content on save: TipTap
removes any node its schema does not recognise, so a visual save would
delete the content while reporting success.

**Only two things trigger it: footnotes, and HTML tags outside the
allowlist.** Every LocTT extension — inline and block KaTeX, `^sup^`,
`~sub~`, mentions, attachment embeds — has a custom TipTap node
(`apps/web/src/client/editor/extensions.ts`), so those stay *visually
editable* rather than being detected and banished to source mode. A
detector that over-reports pushes users into source mode for content
the editor handles perfectly well, which trains them to ignore the
banner.

Detection lives in core (`packages/core/src/markdown/lossy.ts`,
`findLossyConstructs`), not in the editor: it is pure text analysis so
it is testable without a browser, and the CLI and MCP can warn about
the same bodies without importing an editor. `GET /api/tasks/:ref`
carries the result as `lossyConstructs`, so every client applies one
rule instead of each reimplementing it.

Code fences and inline code spans are skipped — a `<div>` inside a
fence is sample text, and a body documenting HTML must stay visually
editable.

**Status.** Detection, the API field and the TipTap node definitions
are implemented and tested. The banner and the mode-forcing are not:
the body editor itself does not exist yet (`/tasks/$key` is a
registered route rendering a stub), so there is no component to hang
them on. When that editor lands it must read `lossyConstructs` rather
than re-detecting.

Mention parsing (`extractMentions`, `packages/core/src/task/comments.ts`)
requires the `user:` prefix, refuses to fire when the `@` follows a word
character (so `bob@example.com` is not a mention), and skips code spans
and fenced blocks — an id in a code sample is documentation, and
notifying someone for it is a false positive the author cannot avoid
except by not writing the example.

## Save semantics

The editor **autosaves** after roughly 1.5s of idle typing, and also on
blur. `Ctrl/Cmd+S` forces an immediate save.

Each save sends one `POST /api/tasks/:ref/body` request. Consecutive
`body_edited` history entries by the same actor within a 15-minute window
are **coalesced into one entry**
(`packages/core/src/task/history.ts:12`, `COALESCEABLE_KINDS` at `:24`),
so a long editing session produces one activity row rather than dozens.

The editor surfaces:

- A saving / saved indicator.
- A warn-on-navigate-away while a save is in flight or has failed.
- `Ctrl/Cmd+S` to save immediately.

Markdown source mode and WYSIWYG mode share the same backing buffer
and save flow.

> An earlier revision of this document specified an explicit Save button
> with no autosave. That contradicted both the history-coalescing window
> (which has nothing to coalesce under explicit save — it would merge two
> deliberate saves minutes apart) and the UI acceptance criteria in
> `tests/cases/ui-test-cases/flow-tasks.md`. Autosave is the intended
> behaviour.

## Features dropped (not representable in markdown)

The editor deliberately does NOT expose:

- Text color
- Font size / font family
- Arbitrary embedded HTML outside the allowlist

If a user needs these, they should use an external tool and attach a
rendered file (e.g. a PDF or PNG).

## For agents

If you read a task body via `get_task`, expect to see any of the
tokens in the table above. **Do not normalize them.** In particular:

- `^x^` and `~x~` (single tilde) are LocTT-extension super/sub-script.
  Strip them and you lose user content.
- `$expr$` and `$$\nexpr\n$$` are KaTeX. Strip them and you lose math.
- `@user:<uuid>` is a mention reference. Replacing it with a
  display-name string will break the mention link on re-render.
- `![[attachments/x.pdf]]` is a file embed. The `[[...]]` form is
  intentional; don't rewrite to `![](attachments/x.pdf)` (that would
  render as a broken image).
- Bare `T-123` keys are autolinked by the renderer — they don't need
  explicit link markup, and adding it (`[T-123](url)`) is redundant
  and tends to drift when keys change.

If you produce a task body, prefer plain CommonMark / GFM. Use the
extensions only when the user has explicitly asked for the feature
they cover.

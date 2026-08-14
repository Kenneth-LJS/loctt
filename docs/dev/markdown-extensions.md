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
| Mention | `@user:<uuid>` | LocTT extension; renderer resolves to display name. **Spec only — see below** |
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
constructs that can't be represented in the WYSIWYG node tree
(arbitrary HTML outside the allowlist, unknown directives, malformed
extension syntax), the editor:

1. Refuses to enter WYSIWYG mode for that body.
2. Shows a banner: *"This task body contains markdown features that
   can't be edited visually. Edit in source mode."*
3. Forces source-mode editing for the rest of the session on that task.

This prevents the editor from silently dropping content on save.

> **Mention parsing does not match this spec.** The implemented regex
> (`packages/core/src/task/comments.ts:51`) is `/@([\w\-.]+)/g` — it has no
> `:`, so `@user:01J...` captures the literal token `user` rather than the
> id, and the raw token is then stored as if it were a user id. It also
> matches inside email addresses and code spans. Treat the table row above
> as the target; the parser needs fixing to reach it.

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
> `docs/dev/ui-test-cases/flow-tasks.md`. Autosave is the intended
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

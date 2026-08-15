# Flow: comments and activity feed

The task detail panel's Comments section — list, composer, own-comment
edit/delete, @mention autocomplete and chips — and the Activity feed
built on `readHistory`, including day grouping, bulk-op collapsing, and
"Load more". Lands in **M2.4**. Meta-field edits that *generate* activity
entries are [flow-tasks.md](flow-tasks.md); the body editor's own
@mention picker is also [flow-tasks.md](flow-tasks.md) (M2.3); the bulk
operations that stamp `bulk_op_id` are [flow-bulk.md](flow-bulk.md);
link and attachment events originate in
[flow-relationships.md](flow-relationships.md).

Grounding: comments live in a per-task YAML file as
`{ id (ULID), author (user ULID), body, created_at, updated_at?,
edited?, mentions? }`. `mentions` stores resolved **user ids**, not
display names — that's what makes a rename survivable. History entries
are `{ timestamp, kind, field?, before?, after?, meta?, actor?,
bulk_op_id? }` in `_history.yaml`, appended oldest-first; `readHistory`
paginates with `order` / `limit` / `offset` and returns a post-filter
`total`.

## A. Happy path

### A.1 Reading and posting

### CMT-1 · M2 · blocker · P8
**Comments list oldest-first.** Open a task with 5 comments posted over
three days.
- The earliest comment is at the top, the newest at the bottom — the
  opposite ordering of the activity feed, deliberately.
- Each comment shows the author's display name, an avatar or initials,
  and a relative timestamp with the absolute time available on hover.
- The order matches the order in the underlying comments file.

### CMT-2 · M2 · blocker · P8
**The composer posts a comment without leaving the page.**
- The composer sits below the list, always visible without hunting.
- Submitting appends the comment to the bottom of the list immediately.
- **Reloading the page still shows the comment** — only the failure path checked disk, so an accepted-and-dropped write passed the happy path.
- The composer clears and stays focused so a second comment can be typed
  without re-clicking.
- The posted comment's author is the current user from the user menu —
  switching users and posting again attributes the second comment to the
  new user.
- An empty or whitespace-only body cannot be submitted; the submit
  control is disabled with the reason available.

### CMT-3 · M2 · major · P3
**Comment bodies render markdown.**
- Bold, italics, inline code, fenced code blocks, links, and lists
  render as formatted output.
- The raw markdown is what's stored — reopening the comment for edit
  shows the source the user typed, not the rendered HTML.

### CMT-4 · M2 · blocker · P5
**Edit and delete are offered on every comment, not only the current
user's own.** As user Ken, view a task with comments from Ken and from
Ana.

This case previously asserted the opposite. It was dropped in favour of
CMT-35: LocTT has no roles or permissions by deliberate decision (Q25),
users switch identity freely from a menu, and `comments.ts` already
stores an `editors` provenance array — a field that only makes sense if
someone other than the author can edit. An ownership check would have
been the product's only permission rule, guarding nothing.

- Both Ken's and Ana's comments show edit and delete controls.
- Switching the active user changes attribution on a subsequent edit,
  not which controls are present.
- The requirement is traceability, not refusal — see CMT-35 for what an
  edit of someone else's comment must record.

### CMT-5 · M2 · major · P5
**Editing a comment marks it edited.** Any comment, not only the
current user's — CMT-4's ownership premise is gone.
- Edit opens the raw body in place, prefilled.
- Saving updates the body, sets `updated_at`, and sets `edited: true`.
- The comment renders an "edited" marker with the edit time available.
  **Which marker depends on who edited:** editing one's own comment
  renders the plain "edited" marker; editing someone else's renders
  the author primarily with "Edited by \<editor\>" secondary, per
  CMT-35. The two are different renderings, not alternatives.
- Verified by re-reading the comments file, not only the rendered list.
- Cancelling discards changes and leaves the stored body untouched.
- `Esc` cancels the edit.

### CMT-6 · M2 · major · P5
**Deleting a comment confirms once and removes it.** Applies to any
comment, not only the current user's — CMT-4's ownership premise is
gone.
- A confirmation names what's being deleted (a comment, with a preview
  or its timestamp).
- No typed confirmation — a comment is a smaller blast radius than a
  task.
- The default focus is Cancel, not Delete.
- On confirm the comment is removed from the list and from the file; the
  other comments' order is unchanged.

### A.2 Mentions

### CMT-7 · M2 · blocker · P8
**@mention autocomplete filters as you type.** Type `@` in the
composer.
- A picker opens listing users; typing `an` narrows it to users matching
  `an` in their display name.
- Arrow keys move the highlight; Enter or Tab inserts the highlighted
  user; `Esc` closes the picker without inserting.
- The picker shows enough to disambiguate two users with the same
  display name (email, or truncated id).
- Typing a `@` inside a code span or fenced block does not trigger the
  picker.

### CMT-8 · M2 · blocker · P7
**Archived users are excluded from NEW mentions.**
- An archived user does not appear in the autocomplete list at all.
- Typing their exact display name does not surface them.
- If their token is typed manually and posted, it does not resolve to a
  mention chip — it stays plain text — and the comment still posts
  rather than being rejected.
- An *existing* mention of a user archived later still renders as a chip
  with an archived treatment; historical attribution never breaks.

### CMT-9 · M2 · blocker · P3
**Mentions render as chips.**
- A resolved mention renders as a distinct chip showing the user's
  current display name.
- The chip is not plain text and is distinguishable from surrounding
  prose by more than colour.
- Clicking or activating the chip does something useful and predictable
  (filters to that user, or opens their profile) — and the same thing
  every time.
- An unresolvable `@token` renders as plain text, not as a broken chip.

### CMT-10 · M2 · blocker · P1 P3
**Mentions survive a rename of the mentioned user.** Post a comment
mentioning "Ana Lopez", then rename her to "Ana Ruiz" in Settings →
Users.
- The stored `mentions` array is unchanged — it holds her user ULID.
- The comment's chip now reads "Ana Ruiz" on the next render.
- The stored comment *body* may still contain the old token; the chip
  must render the current name regardless.
- The "Mentions me" saved filter still matches the comment for that
  user after the rename.

### CMT-11 · M2 · major · P8
**Multiple mentions in one comment all resolve.**
- Three distinct mentions produce three chips and three entries in
  `mentions`.
- The same user mentioned twice appears twice in the body but once in
  `mentions` (de-duplicated).
- Order in `mentions` follows document order.

### CMT-12 · M2 · minor · P3
**Editing a comment recomputes its mentions.**
- Adding an `@user` during an edit adds that user to `mentions`.
- Removing the only `@user` removes the `mentions` key entirely rather
  than leaving an empty array.
- The chips in the rendered comment update to match.

### A.3 Activity feed

### CMT-13 · M2 · blocker · P8
**The activity feed is reverse-chronological and grouped by day.**
- The newest entry is at the top — opposite the comments list.
- Entries are grouped under day headings ("Today", "Yesterday", then
  dates).
- Within a day, entries are newest-first.
- Day boundaries use the workspace timezone from `calendar.yaml`, not
  the browser's, so the grouping matches what the CLI would show.

### CMT-14 · M2 · blocker · P3
**Field changes show before and after values.** A status change from
`not_started` to `in_progress`.
- The entry reads with both sides visible: "Status: Not started →
  In progress".
- Both sides render as the workflow **labels**, not the stored keys.
- A field set from empty shows the empty side explicitly ("Assignee:
  — → Ana Lopez"), not a bare "Assignee: Ana Lopez".
- A field cleared shows the reverse.
- The actor's display name and the timestamp accompany every entry.

### CMT-15 · M2 · major · P3
**Each history kind has its own icon and phrasing.**
- `created`, `field_change`, `custom_field_change`, `label_added` /
  `label_removed`, `archived` / `unarchived`, `link_added` /
  `link_removed`, `body_edited`, `attachment_added` /
  `attachment_removed`, `comment_added` / `comment_edited` /
  `comment_deleted` are each visually distinguishable.
- Icons are supplemented by text — icon alone is not the only carrier of
  meaning.
- `body_edited` says the body changed without pretending to show a diff
  (core captures no content for it).
- `attachment_added` names the file from the entry's `meta`.
- The `comment_*` kinds likewise capture no comment body — activity
  only. Each carries `meta.comment_id` and `meta.author` (the comment's
  *original* author), with the acting user on `actor`. When the two
  differ, the entry must make that visible: "Ken edited Ana's comment",
  not a bare "comment edited".

### CMT-16 · M2 · blocker · P9
**Consecutive entries sharing a `bulk_op_id` collapse into one
expandable row.** Bulk-set status on 50 tasks including this one, then
open its activity.
- The bulk entries render as a single row summarizing the operation
  ("Ken bulk-changed Status on this task", with the shared operation
  noted).
- The row is expandable; expanding reveals the individual entries with
  their own before/after values.
- Only *consecutive* entries with the same `bulk_op_id` collapse — an
  unrelated entry between two bulk entries breaks the group into two.
- Entries with no `bulk_op_id` never collapse with anything.
- Collapsed state does not hide the timestamp or the actor.

### CMT-17 · M2 · blocker · P9
**"Load more" pages through history without duplicating or skipping.** A
task with 300 history entries, page size 50.
- The first render shows the newest 50 and states the scope honestly
  ("50 of 300").
- "Load more" appends the next 50; the boundary entry is not repeated
  and none is skipped.
- The request uses `readHistory`'s `offset` against the same `order`, so
  the sequence is stable.
- After six loads all 300 are present and "Load more" disappears.
- Day groupings merge correctly across page boundaries — a day split
  across two pages renders one heading, not two.

### CMT-18 · M2 · minor · P8
**Comments and Activity are separate, addressable sections.**
- Both are reachable on the task detail without a full page load.
- Whichever is a tab records itself in the URL, so a link to the
  activity tab opens on the activity tab (P2 also applies).
- Switching between them does not refetch the whole task.

### CMT-19 · M2 · minor · P6
**A task with no comments and no history shows designed empty
states.**
- The comments section says there are none and shows the composer.
- The activity feed shows at minimum the `created` entry; a task with a
  genuinely empty `_history.yaml` says so rather than rendering an empty
  box.

## B. Edge cases

### CMT-20 · M2 · major · P9
**80 comments render without collapsing the page.**
- The list is scrollable or progressively loaded; the composer stays
  reachable without scrolling through all 80.
- If comments paginate, the control states the remaining count.
- Posting a new comment scrolls to it rather than leaving the user at
  comment 40 wondering if it worked.
- A very long single comment (thousands of words) is truncated with a
  "Show more" rather than pushing the composer off screen.

### CMT-21 · M2 · blocker · P4 P7
**A comment mentioning a hard-deleted user still renders.** Post a
comment mentioning Ana, then hard-delete Ana's user.
- The comment renders; its body is intact.
- The mention renders as an unresolved chip or plain text naming what's
  known (the stored id, truncated), not as `undefined` or a blank gap.
- The comment list does not fail to load because one mention doesn't
  resolve.
- The same applies to a comment whose *author* was hard-deleted: the
  comment still renders with an "unknown user" attribution rather than
  disappearing.

### CMT-22 · M2 · blocker · P4
**Markdown injection and script tags in a comment are neutralized.**
Post a comment containing `<script>alert(1)</script>`, an
`<img onerror=...>`, and a `[link](javascript:alert(1))`.
- No script executes; the browser console shows no injected execution.
- The raw text is displayed escaped, or the tag is stripped — either is
  acceptable, silently executing is not.
- A `javascript:` URL does not become a clickable link.
- Round-tripping through edit preserves what the user typed; the
  sanitization is a render-time concern, not a storage-time mangle.
- A comment containing YAML-special characters (`:`, `---`, leading
  `- `) round-trips through the comments file without corrupting it or
  the neighbouring comments.

### CMT-23 · M2 · major · P1
**A comment posted from another surface appears in the UI.** Post a
comment via the CLI/MCP while the task is open.
- The comment appears after a refresh or refetch, in correct
  chronological position.
- The UI's own pending comment is not lost by the refetch.
- Two comments posted near-simultaneously from two surfaces both survive
  — the per-task comments lock means neither write clobbers the other.

### CMT-24 · M2 · major · P1
**Editing a comment that was deleted elsewhere fails cleanly.** Delete
the comment in another tab, then save the edit in this one.
- The save reports that the comment no longer exists.
- The comment is removed from this tab's list on refresh.
- The edit text is preserved somewhere the user can copy it from, or the
  message says the text was lost — it is not silently discarded with no
  acknowledgement.

### CMT-25 · M2 · major · P9
**300 history entries collapsing into few bulk groups still paginate
correctly.** 300 entries of which 200 share three `bulk_op_id`s.
- "Load more" pages by underlying *entries*, and the count text is
  honest about which unit it's counting.
- A bulk group split across a page boundary is not rendered as two
  separate groups after the second page loads.
- Expanding a group does not consume a page of the pagination budget or
  reset the loaded offset.

### CMT-26 · M2 · major · P3 P7
**A `field_change` referencing a since-deleted config value still
renders.** A history entry with `before: "urgent"` where the `urgent`
priority was removed from `workflow.yaml`.
- The entry renders showing the raw key with a drift indicator ("urgent
  (no longer defined)"), not a blank.
- The `after` side, if still valid, renders as its label.
- The feed does not fail to load because one entry references a removed
  key.

### CMT-27 · M2 · major · P3
**A `custom_field_change` renders using the field's configured label and
type.**
- The entry names the field by its `label` from `custom_fields`, not the
  key.
- An enum value renders as its value label; a number renders as a
  number; a date renders in the workspace's date format.
- A multi-valued field shows the added/removed members rather than two
  opaque array dumps.
- A custom field removed from config since the entry was written renders
  the raw key with a drift indicator.

### CMT-28 · M2 · minor · P7
**An entry with no `actor` renders honestly.** A history entry written by
a headless path.
- The entry shows "System" or equivalent, not a blank byline and not a
  fabricated user.
- The absence of an actor does not break the day grouping or the
  collapsing.

### CMT-29 · M2 · minor · P9
**Entries from a `key_history` rename resolve.** A task renamed by a
sync rekey.
- Activity entries referencing the old key are still attributed to this
  task.
- The `key` change appears in the feed with before and after keys.

### CMT-30 · M2 · minor · P8
**Timestamps within the same minute are ordered stably.**
- Several entries sharing a timestamp render in a deterministic order
  and do not reshuffle between renders or across "Load more".
- Two comments with identical `created_at` keep a stable order.

### CMT-31 · M2 · minor · P3
**Day headings respect the calendar's first day of week and holidays
only where relevant.**
- Headings are day-based, not week-based; a holiday is not skipped or
  merged.
- "Today" and "Yesterday" are computed in the workspace timezone; at
  23:50 local in a different workspace timezone, the label matches the
  workspace's day, not the browser's.

## C. Error cases

### CMT-32 · M2 · blocker · P4
**A failed comment post does not lose the text.**
- The message names the action ("could not post your comment") and the
  reason.
- The composer keeps the typed body verbatim, including markdown.
- A retry action re-posts the same text.
- The comment does not appear optimistically in the list while the write
  failed.

### CMT-33 · M2 · blocker · P4
**Posting with no current user is refused with a route out.** Clear
`.loctt/.current-user`, then post.
- Core rejects the post ("no current user set").
- The UI's message says a user must be selected to comment and points at
  the user menu.
- The composer text is preserved.
- The comments *list* still renders — reading doesn't require a current
  user.

### CMT-34 · M2 · blocker · P4 P5
**A delete that fails does not remove the comment from the list.**
- The comment stays visible.
- The message names the reason and offers retry.
- If the comment was already gone, the message says so and the list
  converges on refresh.

### CMT-35 · M2 · major · P4 P5
**An edit of another user's comment succeeds and is attributed.**
Anyone may edit or delete anyone's comment — LocTT is local and
unauthenticated, users switch identity freely from a menu, so there is
no trust boundary between users of one tracker and an ownership guard
would add friction without protecting anything. The requirement is
traceability, not refusal.
- Editing Ana's comment as Ken succeeds; no ownership error appears.
- The comment's `author` still reads Ana — editing does not transfer
  authorship.
- Ken is appended to the comment's `editors`, and the comment renders
  Ana primarily with "Edited by Ken" secondary.
- A `comment_edited` history entry records `actor: Ken` and
  `meta.author: Ana`.
- Ana editing her own comment adds no `editors` entry and renders a
  bare "Edited".
- Repeat editors appear once, in first-edit order: three editors read
  "Edited by X, Y, and Z".

### CMT-36 · M2 · blocker · P4 P6
**A corrupt comments file degrades the section, not the task.**
Hand-break the YAML.
- The Comments section shows an error naming the file and the parse
  problem.
- The meta panel, body, relationships, attachments, and activity all
  still render.
- The composer is disabled with a stated reason so a post can't
  overwrite the broken file with a fresh one and silently discard the
  existing comments.
- A next action is given: fix the file at the named path.

### CMT-37 · M2 · blocker · P4 P6
**A corrupt `_history.yaml` degrades the activity feed only.**
- The feed shows an error naming the file.
- If some entries parsed, they render and the feed says the list is
  incomplete rather than presenting a partial log as complete.
- Comments and every other section render normally.

### CMT-38 · M2 · major · P4 P9
**A "Load more" failure keeps the loaded entries and offers retry.**
- The already-loaded entries stay on screen.
- The message names the pagination request as what failed.
- Retrying resumes from the same offset — it does not restart from zero
  and duplicate entries.
- If the total changed underneath (new entries appended), the feed says
  so rather than silently skipping the shifted entries.

# Deep-linking audit & plan (K76)

Ken's K76 ruling makes deep-linking an in-scope pre-publish workstream
that **starts with this audit + plan**, then implements in the normal
build loop (cases + tests). This document enumerates *where* deep links
should exist across every page, what exists today, and a sequenced build.

A "deep link" here is a URL that lands the user not just on a page but at
a **location within it** — a settings section, a specific field, a task's
comments, one comment — with the app scrolling that target into view and,
where it is a shareable location, a **copy-link** affordance.

## What exists today

The router (`apps/web/src/client/router/index.tsx`) already deep-links at
the **page and record** level, and the list carries rich filter state in
the URL:

| Route | Deep-link granularity today |
|---|---|
| `/list` | Full filter/sort/pagination state in the query string (`status`, `labels`, `q`, `sort`, `page`, …) — already deeply linkable and copyable via the URL bar |
| `/board`, `/timeline` | Page-level; view options in the query string |
| `/tasks/$key` | One task — but **no** in-page anchor (comments, relationships, attachments are not individually targetable) |
| `/sprints`, `/sprints/$key`, `/milestones`, `/milestones/$id` | Record-level |
| `/settings/$section` | **Section-level** — `/settings/calendar` lands on the Calendar section (SET-2). No scroll-to-*field* within a section. |

The `?edit=1` list param (VUE-22) and the `?progress=true` API pattern
show the codebase already threads intent through the URL; `useSearch` /
`navigate` from TanStack Router is the mechanism, and `listSearch.ts` is
the model for a typed search schema.

**Gaps** (what K76 names):
1. Settings **scroll-to-field** within a section (unblocks K75's GUI
   nudge — "take me to *this* setting", not just its section).
2. Task **comments section** anchor + **scroll-to-comment** + **copy
   link to a comment** (the Jira analogue Ken called out).
3. Any other page section worth targeting (below).

## The target inventory

Ranked by the value K76 states (K75 nudge first, then the Jira comment
analogue, then the long tail).

### Tier 1 — named in the ruling

- **Settings → section → field.** A link like
  `/settings/calendar#field-timezone` scrolls to and briefly highlights
  the timezone control. Needs: a stable `id`/anchor per settable field in
  each built settings panel, and a scroll-into-view + highlight on load
  and on hash change. Unblocks **K75** (a GUI nudge that says "set your
  timezone" can link straight to it).
- **Task → comments section.** `/tasks/T-1#comments` scrolls the comments
  panel into view. The panel already exists (`CommentsPanel`); it needs a
  stable anchor id and the scroll-on-load.
- **Task → a specific comment.** `/tasks/T-1#comment-<id>` scrolls that
  comment into view and highlights it briefly. Each comment row already
  has a stable id; it needs an anchor + a scroll/highlight, and — since
  the comments list is now a bounded scroll box (A-CMT20) — the scroll
  must target the box, not only the window.
- **Copy-link-to-comment.** A per-comment affordance (a small "link"
  action, next to edit/delete) that copies `<origin>/tasks/T-1#comment-<id>`
  to the clipboard. This is the Jira behaviour Ken named.

### Tier 2 — the same pattern, other in-page sections

- **Task → relationships / attachments sections** (`#relationships`,
  `#attachments`) — same anchor+scroll as comments; cheap once the task
  scroll mechanism exists.
- **Milestone / sprint detail sections** if any grow long enough to
  warrant intra-page targets (today they are short; revisit).

### Tier 3 — not deep-linking, already covered

- **List filter state** is already fully in the URL and copyable; no work.
- **Board / timeline view options** are in the query string; no
  intra-page anchor is meaningful (they are single canvases).

## The scheme

- **Anchor via the URL hash** (`#field-timezone`, `#comment-<id>`), not a
  new search param: a hash is the web-standard "location within a
  document", it is copy-pasteable from the address bar for free, and it
  does not collide with the typed search schemas the pages already use.
  (The one existing intra-page intent that is a *search* param — list
  `?edit=1` — stays, because it changes what renders, not where you
  scroll.)
- **Scroll + highlight on load and on `hashchange`.** A shared hook
  (`useScrollToHash` or similar) reads `location.hash`, finds the element
  by id, `scrollIntoView({ block: "start" })`, and applies a brief
  highlight class (respecting `prefers-reduced-motion`, per SHL-28). It
  runs after the target's data has loaded (a comment/field may mount
  after an async fetch), so it must retry once the anchor appears — a
  MutationObserver or an effect keyed on the loaded data, mirroring the
  A11Y-17 focus-restore pattern already in `ListView`.
- **Copy-link affordances** build the absolute URL from
  `window.location.origin` + the route + the hash, and use the clipboard
  API with a "Link copied" announcement (the shared `Announcer`, so it is
  accessible). The sandbox note: nothing here downloads or navigates
  externally.

## Build sequence

Each step is its own build-loop pass (case authored + PM-reviewed per the
run contract, implemented, unit + UI test, gates green):

1. **`useScrollToHash` + highlight hook** — the shared mechanism, unit-
   tested in isolation (given a hash and a mounted target, it scrolls and
   highlights; reduced-motion drops the animation).
2. **Task comments anchor + scroll-to-comment** (`#comments`,
   `#comment-<id>`) — highest-value Jira analogue; targets the CMT-20
   scroll box.
3. **Copy-link-to-comment affordance** — per-comment, clipboard + announce.
4. **Settings scroll-to-field** (`#field-<key>`) — anchor ids on the
   built panels' fields; unblocks K75's GUI nudge, which is then wired to
   emit the deep link.
5. **Tier-2 task sections** (`#relationships`, `#attachments`) — trivial
   once step 2's mechanism exists.

Cases live in `flow-comments-activity.md` (comment links) and
`flow-settings.md` (field links); the shared hook gets a unit test.
K75's GUI-nudge half is unblocked after step 4 and closes with it.

## Out of scope / deferred

- Deep links into the **board card** or **timeline bar** positions — the
  canvases are already single targets; no sub-location is meaningful.
- Cross-tracker or authenticated share URLs — LocTT is local-first; a
  deep link is only meaningful within one running instance's origin.

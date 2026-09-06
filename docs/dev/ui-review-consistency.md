# Web UI — Visual Consistency Review

Read-only sweep of `apps/web/src/client` for **systemic** visual drift —
the kind a design-system pass fixes once, not per-screen nits. The
trigger was Ken noticing the view toolbar buttons have "no rhyme or
reason" in size/height. That is a symptom: `ui/` ships Modal, Menu,
Toast, Avatar, Announcer — but **no Button primitive**, and no shared
Chip / Input / Field. Every surface hand-rolls Tailwind classes, so
every surface drifts.

The tokens are not the problem. `styles/tokens.css` defines a complete,
sensible set (75 vars: `bg-*`, `border-*`, `text-*`, `accent*`,
`status-*`, `priority-*`, `feedback-*`, `radius-sm/md/lg`) and
`styles/index.css` wires them into Tailwind v4. Colours are almost
entirely token-based. **The drift is in *composition*: no shared
component captures "what a button is", so 80 files each re-answer it.**

---

## Headline

- **~25 distinct button styles for one concept.** 51 distinct *static*
  `<button className="…">` strings across the client (plus more built
  with conditional/`cn`-style class lists this count can't see). They
  collapse to a handful of *intended* roles — primary, secondary,
  ghost, danger, icon — but each role is spelled a dozen ways.
- **The single most important button (primary accent) has ~10
  variants.** See §1.
- **No shared Button / Chip / Input / Field primitive exists.** 80
  `.tsx` files render raw `<button>`; the count/status/label "pill"
  concept is re-implemented in 11+ files; the text-input concept in 9+.
- **`text-white` on coloured buttons (7 places)** bypasses the
  `accent-contrast` token that exists precisely to keep the label
  readable on a light accent — a real defect, not cosmetic. See §3.

Priority order below is **most visible + most repeated first.**

---

## 1. Buttons — the core finding (P0)

No `ui/Button`. `RefreshButton.tsx` is a feature component, not a
primitive. Every button is bespoke. The axes that drift, for what is
conceptually the *same* button:

| Axis | Values seen in the wild |
|---|---|
| Height | `h-8` (18×) · `h-7` (5×) · none, height from `py-*` |
| Vertical padding | `py-0.5` · `py-1` · `py-1.5` · `py-2` (all on buttons) |
| Horizontal padding | `px-1.5` · `px-2` · `px-2.5` · `px-3` |
| Text size | `text-[11px]` · `text-[12px]` · `text-[13px]` |
| Radius | `rounded` · `rounded-md` (near 50/50 split — see §2) |
| Border token | `border-border-subtle` · `border-border-default` · none |
| Disabled | `disabled:opacity-40` · `-50` · `-60`; `cursor-not-allowed` present or not |
| Label colour on accent | `text-accent-contrast` · `text-white` (§3) |

### 1a. The toolbar Ken flagged — `list/FilterBar.tsx`

Three buttons sitting side-by-side in one row, three different shapes:

- L194 "Advanced": `rounded border border-border-subtle px-2 py-1 text-[12px]` — no fixed height, 12px, subtle border, `rounded`.
- L240 FilterDropdown trigger: `inline-flex h-8 … rounded-md border border-border-default px-2.5 text-[13px]` — `h-8`, 13px, default border, `rounded-md`.
- L242 "⭑ Save as view": its own third combo.

Same conceptual row of controls; three heights, two radii, two border
tokens, two text sizes. This is the "no rhyme or reason" in miniature.

### 1b. Primary accent button — ~10 variants for THE primary action

`grep bg-accent … text-[13px]` returns these distinct spellings:

```
bg-accent px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50        (7×)
bg-accent px-3 text-[13px] font-medium text-accent-contrast no-underline hover:bg-accent-hover (4×)
bg-accent px-3 text-[13px] font-medium text-accent-contrast                            (3×)
bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-50                        (2×)  ← text-white, py- height
bg-accent px-3 py-1 text-[13px] text-accent-contrast disabled:opacity-50               (1×)
bg-accent px-3 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 (1×)
… + several more
```

They disagree on: height mechanism (`h-8` implied vs `py-1` vs `py-1.5`),
`font-medium` present/absent, `hover:bg-accent-hover` present/absent,
disabled opacity (50 vs 60), `disabled:cursor-not-allowed` present/absent,
and label colour (§3). This is one button. It should be one class.

### 1c. Secondary/ghost/danger — same story

- Secondary (bordered): `h-8 rounded-md border border-border-default px-3 text-[13px] text-text-secondary` vs `rounded-md border border-border-subtle px-3 py-1.5 text-[13px] …` vs `rounded border border-border-default px-3 py-1.5 …` — 3+ border/height/radius combos.
- Ghost (`h-8 rounded-md px-3 text-[13px] text-text-secondary`, 5×) vs `rounded px-2 py-1 text-[13px] text-text-secondary hover:bg-bg-muted` — height vs padding again.
- Icon buttons: `grid h-8 w-8 place-items-center rounded-md` vs `grid h-7 w-7 place-items-center rounded` — different size *and* radius for the same square icon button.

**Fix direction:** extract `ui/Button.tsx` with `variant`
(primary | secondary | ghost | danger) × `size` (sm | md) and an
`iconOnly` form. One height per size, one radius, one disabled
treatment, `accent-contrast` baked in. Migrate the ~25 call-site
spellings onto it. This alone resolves the reported symptom and most of
§2/§3.

---

## 2. Spacing / type / radius — arbitrary, not a scale (P1)

Everything is expressed as **arbitrary Tailwind values** (`text-[13px]`,
`px-2.5`) rather than a named scale, so there's no gravity pulling
values together.

**Type size — 9 distinct arbitrary sizes, zero use of `text-xs/sm`:**

```
text-[13px] 373   text-[12px] 334   text-[11px] 122   text-[10px] 19
text-[15px] 15    text-[14px] 8     text-[9px] 2      text-[16px] 1   text-[20px] 1
```

13/12/11 are the de-facto body/label/meta ramp but are never named;
`text-[9px]`/`[10px]`/`[14px]`/`[15px]` are one-off deviations. A reader
can't tell whether `text-[14px]` somewhere is intentional or a typo for
13.

**Radius — `rounded` vs `rounded-md` split ~50/50 for the same corner:**

```
rounded 216   rounded-md 200   rounded-full 29   rounded-lg 13   rounded-sm 2
```

Critical detail: the *tokens* are `radius-sm`=4px → `rounded-sm`,
`radius-md`=6px → `rounded-md`, `radius-lg`=8px → `rounded-lg`
(`styles/index.css` L53-60). Bare **`rounded` is Tailwind's default
0.25rem/4px — it is NOT a token** and happens to equal `radius-sm`. So
216 elements use an off-token 4px radius while 200 use the 6px token,
often for identical controls. Buttons/chips visibly disagree by 2px.

**Padding/gap — full ad-hoc spread:** `px-1/1.5/2/2.5/3`,
`py-0.5/1/1.5/2/2.5`, `gap-0.5/1/1.5/2/2.5/3`. `px-2.5` (26×) and
`px-2` (130×) are used for the same button role; `gap-1` (67×) vs
`gap-1.5` (21×) vs `gap-2` (104×) for the same icon+label pairing.

**Fix direction:** a short **spacing/type scale doc** (see §6) naming
`body=13 / label=12 / meta=11`, control heights `sm=h-7 / md=h-8`, and
padding steps; ban bare `rounded` in favour of `rounded-md`. Most of
this enforces itself once §1's primitives exist, because the values move
into the primitive.

---

## 3. Colour / token usage (P1 for the bug, low for the rest)

Colours are overwhelmingly token-based — good. Two real issues:

**3a. `text-white` on coloured buttons — bypasses `accent-contrast`
(defect, 7 places):**

```
settings/ReconcilePanel.tsx:260   bg-accent … text-white
settings/GitSyncPanel.tsx:171     bg-accent … text-white
comments/CommentComposer.tsx:272  bg-accent text-white
settings/DeleteViewDialog.tsx:78  bg-danger-fg … text-white
list/DeleteConfirmDialog.tsx:122  bg-danger-fg … text-white
create/CreateTaskModal.tsx:1270   bg-danger-fg … text-white
task/DeleteTaskDialog.tsx:131     bg-danger-fg … text-white
```

`--accent-contrast` exists so the label stays legible if the accent is
themed light; `text-white` hardcodes past it and will fail contrast on a
light accent. Danger buttons should likewise use a paired
contrast token, not raw white. This is a genuine correctness issue that
a Button primitive fixes for free.

**3b. Hardcoded hex — 3 real, 4 benign:**

```
shell/Sidebar.tsx:469  #8A94A6  (ColorDot: "All projects" grey)
shell/Sidebar.tsx:517  #1E6FCB  (ColorDot: project blue — comment admits it's a mockup stand-in)
shell/Sidebar.tsx:815  #1F8A4C  (ColorDot: active-sprint green)
settings/LabelsPanel.tsx (4×)  #aabbcc  (placeholder text in a colour input — fine)
```

The three `Sidebar` ColorDot colours are semantic (grey/blue/green) but
literal; they should be tokens (`text-tertiary`, an accent/project
token, `success-fg`). Low volume, but they're the *only* real hardcoded
colours in the app, so worth tokenising while touching the sidebar.

The Phase-Z "~792 hardcoded px" note is about **spacing** (§2's
arbitrary values), not colour — colour is in good shape here.

---

## 4. Iconography / glyph affordances (P2)

Icons are literal Unicode glyphs, no icon component — mostly fine, but
the **same affordance uses different glyphs**:

| Affordance | Glyphs used | Locations |
|---|---|---|
| **Star** | `★` vs `⭑` | `Sidebar.tsx:522,652` (default project = `★`) vs `FilterBar.tsx:242` ("Save as view" = `⭑`) |
| **Close/dismiss** | `×` vs `✕` | `×`: Toast, ShortcutHelpDialog, CreateTaskModal, BulkBar "Clear ×". `✕`: referenced in FilterBar chip removal |
| **Disclosure caret** | `▾/▸` (common) vs `▼/▲` | `▾/▸` in ReconcilePanel, TimelineChart, TreeRows, RelationshipsPanel, FilterDropdown; `▼/▲` in `ListView.tsx:626` sort indicator |
| **Overflow / more** | `⋯` (3×) and `…` (109×, mostly literal ellipsis) | mixed |

`★`≠`⭑` is the clearest: two stars for two star-ish actions. Close is
`×`≠`✕`. Carets are mostly `▾` but the list sort header uses the
heavier `▼`.

**Fix direction:** a tiny `icons.ts` (or `<Icon name>`) mapping named
affordances → one canonical glyph: `star ⭑`, `close ✕`, `caret ▾`,
`more ⋯`. Cheap, removes the "two stars" class of drift.

---

## 5. Cross-view / cross-component drift (P1)

**Good news first:** Board *reuses* List's field renderers —
`board/BoardCard.tsx` imports `StatusBadge` etc. from `list/cells.tsx`,
so status/label chips render identically in List and Board. That's the
model the rest of the app should follow.

**Where it breaks down — the "pill/chip" concept, re-implemented ~11×
with drift.** Same visual object (small rounded label/count), different
spelling everywhere:

```
board/BoardView.tsx:566        rounded-full border px-2.5 py-1 text-[12px]
shell/Sidebar.tsx:203          rounded-full bg-bg-muted px-1.5 text-[11px]  (no py)
sprints/SprintsView.tsx:645    rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase
sprints/SprintMetaHeader:217   rounded-full bg-bg-muted px-2 py-0.5 text-[11px] font-medium
task/editors/LabelsField:142   rounded-full px-2 py-0.5 text-[11px]
milestones/MilestoneDetail:186 rounded-full bg-bg-muted px-1.5 py-0.5 text-[10px] uppercase
milestones/MilestonesView:245  rounded-full bg-bg-muted px-1.5 py-0.5 text-[10px] uppercase
```

Text size (10/11/12), padding (px-1.5/2/2.5, py none/0.5/1), and weight
(none/medium/semibold) all differ for the same pill.

**Even within one file:** `list/cells.tsx` status badge is
`rounded-md … px-1.5 py-0.5 text-[12px]` (L47) while its label chip is
`rounded … px-1.5 py-0.5 text-[11px]` (L189) — different radius *and*
text size for two adjacent chip types.

**Repeated "error/warning banner" block (~5×):** e.g.
`rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg`
in `timeline/TimelineView.tsx` (×3 nearby), plus warn/danger variants in
CustomFields, EnumCollection, etc. Another primitive candidate.

**Text input concept — 9 spellings:**

```
rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]      (9×)
rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px]   (5×)
rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[13px] (4×)
rounded-md border border-border-subtle bg-bg-surface px-3 py-1 text-[13px]   (2×)
…
```

rounded vs rounded-md, subtle vs default border, px-2 vs px-3, py-1 vs
py-1.5 — same field, no shared component.

**Fix direction:** `ui/Chip.tsx` (variant: neutral | accent | status,
size sm), `ui/Field.tsx`/`ui/Input.tsx`, and a shared `Callout`/`Banner`
for the danger/warn block. Follow the Board→cells reuse model.

---

## 6. Recommended design-system scaffolding (minimal, prevents recurrence)

In dependency order — each removes a whole class of drift:

1. **`ui/Button.tsx`** — `variant` × `size` × `iconOnly`. Bakes in one
   height per size, `rounded-md`, one disabled treatment, and
   `accent-contrast`. Kills §1 and §3a. **Highest leverage; start here.**
2. **`ui/Chip.tsx`** — neutral/accent/status pill. Kills the §5 pill
   drift; adopt in the 11 sites (Sidebar, Sprints, Milestones, Labels,
   Board count).
3. **`ui/Input.tsx` + `ui/Field.tsx`** — one text-field shape. Kills the
   9-way input drift.
4. **`ui/Callout.tsx`** (or Banner) — danger/warn/info block. Kills the
   repeated error-banner spelling.
5. **`icons.ts`** — named affordance → canonical glyph (`star`, `close`,
   `caret`, `more`). Kills §4.
6. **A scale doc** — `docs/dev/ui-scale.md` (or a section here): name the
   type ramp (`meta 11 / label 12 / body 13`), control heights
   (`sm h-7 / md h-8`), padding steps, and the rule **"radius is always
   `rounded-md`; bare `rounded` and `rounded-sm` are banned"**. Most of
   the scale then lives inside the primitives, so drift can't recur at
   call sites.

Optional guardrail: an ESLint rule (or a `tools/` grep check) that flags
raw `<button className=…>` and bare `rounded`/`text-white` in
`apps/web/src/client`, steering new code to the primitives.

### Systemic vs one-off

**Systemic (worth a primitive):** everything in §1, §2, §3a, §5. These
are 20–200-instance drifts caused by a missing component.

**One-off nits (fix in place, no primitive):** the 3 Sidebar ColorDot
hexes (§3b); the list-sort `▼/▲` glyph vs the app's `▾` (§4) — a single
call site.

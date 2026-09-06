# UI review — list filter bar / toolbar

Read-only design review of the `/list` toolbar. No code was changed.
Scope: `apps/web/src/client/list/FilterBar.tsx` and how
`ListView.tsx` composes it with Refresh and Export. Live app confirmed
at `http://localhost:7755/list` (seeded demo).

## TL;DR

- **The "Advanced" button is inconsistent by construction.** It is the
  one control in the row that is *not* built to the shared pill spec
  (`h-8 … text-[13px]`); it uses `px-2 py-1 text-[12px]` with
  `border-border-subtle`, so it is shorter, lighter-bordered, and
  smaller-typed than every facet next to it. `FilterBar.tsx:190-197`.
- **"Advanced" is not a filter — it is a mode switch**, and a
  destructive one: clicking it does an early `return` that unmounts the
  entire basic bar (facets, chips, archived toggle, Save as view) and
  replaces it with the DSL editor. `FilterBar.tsx:164-185`. It should
  not sit at the head of the facet list as though it were the first
  facet.
- **The toolbar has no grouping.** Facets, a spacer, the archived
  checkbox, and Save-as-view live in one `flex-wrap` row inside
  `FilterBar`; Refresh and Export live one level up in `ListView` in a
  *different* flex container. So the six visible controls actually come
  from two components with two layout systems, which is why "there's no
  rhyme or reason."
- **No shared Button primitive exists.** Every button is bespoke
  Tailwind, and they have already drifted into ~5 different heights and
  border tokens. This is the root cause; the height mismatch is a
  symptom.

Recommendation headline: **move "Advanced" out of the facet row into
the right-hand action cluster as a labelled mode toggle ("Advanced
query" / a `⌂ DSL` toggle), built to the same `h-8` pill spec as its
neighbours; and introduce a single `<ToolbarButton>` primitive so
height/border/size can't drift again.** Detail below.

---

## 1. Current layout map

### 1a. Two containers, not one

The visible toolbar is assembled from two components with two separate
flex rows:

- **`ListView.tsx:480-487`** — the outer row:
  ```
  <div className="flex items-center justify-between gap-3">
    <FilterBar />                       // the whole basic bar
    <RefreshButton … />
    <ExportMenu … />
  </div>
  ```
  So Refresh and Export are siblings of the *entire* FilterBar, not of
  the facets. They are `justify-between` against it.

- **`FilterBar.tsx:187-245`** — inside `<FilterBar>`, a
  `flex flex-col gap-2` wrapper whose first child is
  `flex flex-wrap items-center gap-2` holding, **in this DOM order**:

  | # | Control | Source | Styling (verbatim) |
  |---|---------|--------|--------------------|
  | 1 | **Advanced** (mode toggle) | `FilterBar.tsx:190-197` | `rounded border border-border-subtle px-2 py-1 text-[12px] text-text-secondary hover:bg-bg-muted` |
  | 2 | Project / Status / Priority / Type / Assignee / Reporter / Label / Milestone / Sprint (facets) | `FilterBar.tsx:198-207` → `FilterDropdown.tsx:76-89` | `inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[13px]` (accent variant when active) |
  | 3 | custom-field facets (enum) | `FilterBar.tsx:209-219` | same as facets |
  | 4 | `<div className="flex-1" />` spacer | `FilterBar.tsx:221` | pushes the rest right |
  | 5 | **Show archived** checkbox+label | `FilterBar.tsx:223-234` | `inline-flex … gap-1.5 text-[13px]` — a raw checkbox, no pill, no fixed height |
  | 6 | **⭑ Save as view** | `FilterBar.tsx:236-244` | `inline-flex h-8 items-center gap-1 rounded-md border border-border-default bg-bg-surface px-2.5 text-[13px]` |

  Second child of the col wrapper: **the applied-filter chip row**
  (`FilterBar.tsx:247-284`) — removable chips + "Clear all", shown only
  when filters are active.

- **`ListView.tsx:482-486`**:
  - **Refresh** — `RefreshButton.tsx:36`: `inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-bg-surface px-2.5 text-[13px]`
  - **Export ▾** — `ExportMenu.tsx:122`: `rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium` (no `h-8`)

### 1b. What the live app shows (seeded demo)

At the observed width the single `flex-wrap` row wraps: **Advanced +
all nine facets on line 1**, then **Show archived + Save as view drop
to line 2**, while Refresh/Export stay pinned top-right (they're in the
other container and don't participate in the wrap). "Advanced" is
visibly shorter and thinner-bordered than the facet pills beside it.
So the two user complaints are both reproducible on screen.

### 1c. The DSL editor is a full replacement, not an inline panel

`FilterBar.tsx:164-185`: when `advanced` state is true the component
returns `<AdvancedQueryEditor …>` **instead of** the basic bar. The
facets, chips, archived toggle and Save-as-view are gone while editing.
Return to basic is via the editor's own "Switch to basic"
(`AdvancedQueryEditor.tsx:256-276`) or Esc/Close. This is a genuine
mode switch, which is exactly why it does not belong inline among the
facet filters.

---

## 2. The inconsistencies, precisely

### 2a. Height / size / weight / border mismatches

The row mixes at least **four** button recipes. Canonical pill is
`h-8 … rounded-md … text-[13px]` (facets + Refresh + Save as view).
Deviations:

| Control | File:line | Deviates how |
|---------|-----------|--------------|
| **Advanced** | `FilterBar.tsx:194` | `px-2 py-1` (no `h-8`) → shorter box; `text-[12px]` not `[13px]`; `rounded` not `rounded-md`; `border-border-subtle` not `border-border-default`. Four independent deltas from its neighbours. |
| **Export ▾** | `ExportMenu.tsx:122` | `px-2.5 py-1` (no `h-8`) → shorter than the `h-8` Refresh right beside it; `text-[12px]`; `border-border-subtle`. |
| **Show archived** | `FilterBar.tsx:223` | not a button at all — bare `<input type=checkbox>` + label, no height box; visually floats against the pills. |
| facets / Refresh / Save as view | `FilterDropdown.tsx:78`, `RefreshButton.tsx:36`, `FilterBar.tsx:240` | the intended baseline (`h-8`, `text-[13px]`, `rounded-md`, `border-border-default`). |

Net: two of the toolbar's buttons (Advanced, Export) are built to a
*different, older* recipe than the three that align. The user's "the
other buttons align nicely" is literally true — Advanced and Export are
the two that don't.

### 2b. The semantic grouping problem

The controls belong to **five distinct functional classes** but are
interleaved with no visual separation:

1. **Facet filters** (Project…Sprint, custom fields) — narrow the set.
2. **Mode toggle** (Advanced) — switches the *entire input surface*
   from facets to raw DSL. Not a filter.
3. **Scope toggle** (Show archived) — a filter-ish boolean, but a
   different interaction (checkbox) and a different meaning (include
   otherwise-hidden rows).
4. **View management** (Save as view) — persists the current filter to
   `queries.yaml`.
5. **Result actions** (Refresh, Export) — act on the *result set*, not
   the query. These already live in a different component.

Today #2 sits at the *front* of #1 (reads as "the first facet"), #3
and #4 are jammed at the end of the facet row after a `flex-1` spacer,
and #5 is orphaned in `ListView`. There is no rule a reader can infer
for why any control is where it is.

### 2c. Root cause: no Button primitive

There is no shared button component anywhere in `apps/web/src/client`
— every button re-specifies its Tailwind. That is why five buttons
that should be identical are written five ways and have drifted. Any
re-layout that doesn't also centralise the button will drift again the
next time someone adds a control.

---

## 3. Proposed information architecture + spec

### 3a. Grouping (left → right, one row that wraps gracefully)

```
[ facet filters ………… ]   ‹flex-1 spacer›   [ view group ] │ [ result actions ]

Line 2 (only when filters active): [ applied-filter chips … ] [Clear all]
```

- **Left cluster — facet filters only.** Project, Status, Priority,
  Type, Assignee, Reporter, Label, Milestone, Sprint, custom fields.
  Nothing that isn't a facet. (Remove Advanced from here.)
- **Right cluster A — query/view management**, separated from the
  facets by the existing `flex-1` spacer and, from each other, by a
  thin divider or a `gap-3` step-up:
  - **Advanced query** (mode toggle) ← moved here, see §3c
  - **Show archived** (scope toggle)
  - **⭑ Save as view** (view management)
- **Right cluster B — result actions**: **Refresh**, **Export**.
  These should be visually grouped (tighter `gap-1`/`gap-2`) and set
  slightly apart from cluster A. Ideally lift them *into* FilterBar's
  row (or pass them in) so all toolbar controls share one flex context
  and one wrap behaviour — today they can't wrap together because they
  live in two containers (§1a). At minimum keep them a distinct pair.
- **Applied-filter chips** stay on their own line below
  (`FilterBar.tsx:247`) — that is already correct and should not move
  into the control row.

Rationale for order: the eye reads inputs (facets) → then how to
change the input mode / scope / save it → then what to do with the
output. Advanced and Show-archived are both "change how the query
behaves," so they sit together, left of Save-as-view.

### 3b. Sizing / alignment spec (existing tokens only)

Every direct control in the toolbar row conforms to **one** pill spec:

```
h-8               // fixed height — the thing that makes them align
inline-flex items-center gap-1
rounded-md
border border-border-default
bg-bg-surface
px-2.5
text-[13px]
text-text-secondary
hover:bg-bg-muted
```

Active/selected variant (already used by facets,
`FilterDropdown.tsx:80-81`):
`border-accent bg-accent-muted text-accent`.

Concrete edits this implies (no behaviour change):

- **Advanced** (`FilterBar.tsx:194`): adopt the pill spec →
  `h-8 … rounded-md border border-border-default … text-[13px]` (drop
  `py-1`, `text-[12px]`, `rounded`, `border-border-subtle`).
- **Export ▾** (`ExportMenu.tsx:122`): add `h-8`, bump to `text-[13px]`,
  `border-border-default`, `inline-flex items-center` so it matches
  Refresh beside it.
- **Show archived** (`FilterBar.tsx:223`): wrap the checkbox+label in an
  `h-8 inline-flex items-center` shell so it shares the baseline and
  doesn't float; the checkbox itself is unchanged.

### 3c. Where "Advanced" goes, and why

**Move it out of the facet list and into right-cluster A, styled as a
mode toggle**, not a facet.

- **Why not a facet position:** it is a mode switch that *unmounts the
  facets* (`FilterBar.tsx:164`). Placing a control that destroys the
  row at the head of the row it destroys is the core confusion.
- **Make its toggle nature visible:** it should read as
  **"Advanced query"** (or an icon toggle `{} DSL`) and reflect state
  with `aria-pressed`. Pair it with the reverse control that already
  exists — "Switch to basic" (`AdvancedQueryEditor.tsx:258`) — so
  basic↔advanced is one conceptual toggle living in one place, not an
  unlabelled "Advanced" on one screen and "Switch to basic" on the
  other.
- **Placement:** first item of right-cluster A, immediately left of
  Show archived / Save as view. It is about *how you express the
  query*, which is a peer of "save this query," and both are distinct
  from the facets and from the result actions.

### 3d. Recommend a shared Button primitive — yes

Introduce a single `ToolbarButton` (or a small `Button` with a
`toolbar`/`pill` variant) under `apps/web/src/client/ui/` that encodes
the §3b spec plus the active variant. Then:

- `FilterDropdown`'s trigger, Advanced, Refresh, Export, Save as view,
  and the Show-archived shell all render through it.
- Drift like the current four-recipe spread becomes impossible — the
  height/border/size live in one file.

This is warranted specifically because the reported bug *is* drift, and
there are already ≥5 hand-written variants of the same button. Without
the primitive, a re-layout fixes today's symptom and re-opens it later.
(Keep scope honest: the primitive is the durable fix; the §3b class
edits fix the visible mismatch even on their own.)

---

## 4. Behaviour + test-id constraints a re-layout must preserve

The behaviour cases pin *reachability and function*, **not position**,
so the re-layout is free — provided these locators and behaviours
survive.

### 4a. Test-ids / accessible names the tests locate by

Web tests are vitest + Testing Library (`*.test.tsx`); the `tests/e2e`
suite is **CLI/MCP only** and does not touch the web toolbar. Preserve:

| Locator | Kind | Used by | Note |
|---------|------|---------|------|
| `advanced-query-toggle` | `data-testid` | `FilterBar.tsx:192` | keep this test-id on the moved/re-styled Advanced control. |
| `"Show archived"` | label text | `FilterBar.test.tsx:157` (`getByLabelText`) | the checkbox's accessible label must stay exactly "Show archived". |
| `"Save as view"` | button accessible name | `FilterBar.test.tsx:202,207` (`getByRole button /Save as view/`) | keep the name matchable by `/Save as view/`. |
| `dsl-input`, `dsl-run`, `dsl-help-toggle`, `dsl-error`, `dsl-error-token`, `dsl-error-caret`, `switch-to-basic`, `switch-to-basic-reason`, `dsl-close-*` | `data-testid` | `AdvancedQueryEditor.test.tsx`, and `advanced-query-editor` wrapper | inside the editor — unaffected by toolbar layout, but don't rename when touching the toggle. |
| `query-warnings`, `broken-view`, `broken-view-fix`, `broken-view-position` | `data-testid` | `ListView.tsx:491-533` | banners above the table; keep if the Refresh/Export row is refactored. |
| facet triggers | accessible name `Filter <Label>` / `Filter by <Label>` | `FilterDropdown.tsx:72,79` | preserve when routed through a Button primitive. |
| Refresh | `aria-label="Refresh"` | `RefreshButton.tsx:34` | keep. |
| Export | `aria-label="Export"`, `aria-haspopup="menu"`, `aria-expanded` | `ExportMenu.tsx:113-116` | keep the menu semantics. |

### 4b. Behaviours to keep intact

- **LST-12** (`flow-list.md:170`): Show archived toggles `archived=true`
  in the URL, off removes the param; archived rows get a badge. Toggle
  logic is `FilterBar.tsx:226-232` — don't alter the URL write when
  re-housing the control.
- **VUE-8 / VUE-10 / VUE-11** (`flow-saved-views.md:70,83,90`): the
  Advanced DSL editor must remain reachable, run queries, and offer the
  disabled-with-reason "Switch to basic". Moving/relabelling the toggle
  must still mount `AdvancedQueryEditor` (`FilterBar.tsx:164-185`) and
  keep `?edit=1` deep-linking (`FilterBar.tsx:92-106`,
  `ListView.tsx:519-527` "Fix this view in the editor").
- **VUE-6 / VUE-7** (`flow-saved-views.md:55,63`): "Save as view" opens
  `SaveViewDialog` and writes `queries.yaml`. `showSaveView` prop still
  hides it on `/sprints/$key` (`SprintDetail.tsx:219`,
  `FilterBar.test.tsx:200-207`) — keep that prop honoured wherever the
  control lands.
- **FilterBar reuse on `/sprints/$key`**: the bar is shared verbatim
  with `hiddenFacets={["sprint"]}` and `showSaveView={false}`
  (`FilterBar.tsx:59-70`, `SprintDetail.tsx:219`). Any grouping change
  must keep working when a facet is withheld and Save-as-view is off —
  don't hard-code the right cluster around Save-as-view being present.
- **XS-3 Refresh / BLK-14-16 Export**: Refresh must stay a top-level
  control (`RefreshButton.tsx` doc: "reachable without opening a menu");
  Export stays a menu following the *filter*, not the selection. If
  Refresh/Export are lifted into FilterBar's row, keep them top-level
  buttons, not folded into an overflow menu.
- **Applied-filter chips** (`FilterBar.tsx:247-284`) and their
  `Remove <facet> <label>` aria-labels / "Clear all" must stay on their
  own line and keep working; `clearedSearch` is also reused by the
  empty-state "Clear filters" (`ListView.tsx:699`) — shared, don't fork.

---

## 5. Files touched by any implementation (for reference)

- `apps/web/src/client/list/FilterBar.tsx` — move/restyle Advanced;
  group right cluster; wrap Show archived.
- `apps/web/src/client/list/ListView.tsx:480-487` — the Refresh/Export
  container; candidate to merge into FilterBar's row for one wrap
  context.
- `apps/web/src/client/list/ExportMenu.tsx:122` — bring Export to the
  `h-8` pill spec.
- `apps/web/src/client/list/RefreshButton.tsx:36` — already conformant;
  route through the primitive if one is added.
- `apps/web/src/client/list/FilterDropdown.tsx:76-89` — facet trigger;
  route through the primitive.
- `apps/web/src/client/list/AdvancedQueryEditor.tsx:256-276` — the
  reverse "Switch to basic" toggle to pair with the relabelled Advanced.
- **New:** `apps/web/src/client/ui/ToolbarButton.tsx` (recommended).

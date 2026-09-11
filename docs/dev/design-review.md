# UI design review

A thorough review of the web UI (`apps/web/src/client`) on 2026-09-11,
across three axes run as independent audits: **design-token adherence**,
**primitive/component consistency**, and **accessibility / interaction
state**. Every finding below is grepped-and-cited against source, not
taken on an agent's word; where two audits found the same defect by
different routes it is marked **cross-confirmed**.

## The one-sentence verdict

**The v1 build produced excellent design systems and then stopped short
of wiring the app onto them.** Every finding is *adoption debt*, not a
design flaw:

- The token system is well-designed (WCAG-worked colors, both themes, a
  4px spacing scale with a documented root cause) — **and barely
  adopted**: 0 of 1,818 spacing sites, 12 of ~885 type-size sites, and
  those 12 are all inside `ui/`.
- The primitive library is sound (Dialog correctly layered over Modal,
  Button/IconButton/ToolbarButton cleanly separated, a deliberate icon
  strategy) — **and barely adopted**: ~170 raw `<button>`s re-spell
  Button variants; 7 delete dialogs, no shared confirm primitive.
- The a11y *apparatus* is excellent (a real global focus ring, a real
  focus-trap/inert/restore hook, `IconButton` requires `aria-label`) —
  **and barely adopted**: `useFocusTrap` is called in 3 places out of
  ~9 dialogs.

This is the same lesson `lessons.md` already records as
`unarchiveView`: **built is not adopted.** Nothing here asks for a
redesign. It asks for the migrations the v1 build deferred and never ran.

## Is any of this a publish blocker?

**Ken ruled (2026-09-11): §A1 is a publish blocker — fix before
publishing.** The rest is fast-follow.

- **P0 — BLOCKER (Ken's ruling):** the dialog focus-trap / inert / focus-
  restore gap (§A1). It is a real keyboard/screen-reader regression, not
  cosmetic — a user can Tab out of a modal into the frozen page behind
  it, and focus is not returned to the trigger on close. Cross-confirmed
  by two audits. Bounded fix (one primitive). The README's a11y claims
  are partly untrue until this ships, which is part of why it blocks.
- **P1 — strong fast-follow:** primitive adoption (Button, Callout, form
  controls, the `ConfirmDialog` collapse). Mechanical, low-risk, large in
  aggregate. Improves consistency; the app is not broken without it.
- **P2 — fast-follow:** the two token migrations (spacing B4, type
  scale). ~2,700 sites, purely visual (off-grid spacing, inconsistent
  text sizes). Renders fine today to a non-designer's eye.

The app **works and looks coherent today**; the drift is visible to a
designer, and the a11y gap is invisible until someone uses the keyboard.
So: one true blocker (§A1), the rest fast-follow.

---

## A. Accessibility & interaction — do first (real user harm)

### A1. Dialogs bypass the focus-trap / inert / focus-restore primitive — **P0, cross-confirmed — PARTIALLY FIXED (K71)**

**Fixed 2026-09-11** via a shared `ui/ConfirmDialog.tsx`
(`ConfirmDialog` + `TypedConfirmDialog`, over `Dialog`/`Modal`). These
five now inherit focus-trap / inert / focus-restore:
- ✅ `settings/DeleteViewDialog.tsx` → `ConfirmDialog`
- ✅ `comments/DeleteCommentDialog.tsx` → `ConfirmDialog`
- ✅ `list/DeleteConfirmDialog.tsx` → `TypedConfirmDialog`
- ✅ `task/MoveTaskDialog.tsx` → `Dialog` (has a picker, not confirm-shaped)
- ✅ `editor/BodyConflictDialog.tsx` → `useFocusTrap`+`useInertBackground`
  directly (too wide — `max-w-4xl` — for Modal's panel)

Verified by a real-browser focus-trap+restore e2e (`flow-accessibility`
"K71: a migrated confirm dialog traps focus and restores it") plus the
preserved behavior specs (BLK-11, CMT-6, XS-12/65, TSK-44, VUE-38).

**STILL TO FIX (K71 remainder):**
- `list/AdvancedQueryEditor.tsx` (:226 alertdialog, :280 dialog)
- `create/CreateTaskModal.tsx` — the **primary create flow**: has
  `useInertBackground` + Escape but **no** `useFocusTrap`; its nested
  `DiscardDialog` (`role="alertdialog"`) has no trap, no Escape, no
  restore — only `autoFocus` on Keep.

**Fix:** route every one through `Modal`/`Dialog` (which already provide
the apparatus), or call `useFocusTrap` + `useInertBackground`. This
overlaps entirely with §B1 — the `ConfirmDialog` primitive fixes the
delete-dialog subset of this list at the same time.

### A2. `Menu` claims the ARIA menu pattern but omits arrow-key nav — P1
`ui/Menu.tsx` sets `role="menu"` (:80) / `role="menuitem"` (:120) and
Escape (:56) but has **no ArrowUp/ArrowDown** handler. A `role="menu"`
contract requires roving arrow-key movement. Either implement it or drop
to plain buttons (which don't promise the pattern).

### A3. Loading states are ad-hoc and silent to screen readers — P1
No shared loading/skeleton component. ~14+ features re-spell
`<div class="p-8 text-[13px] text-text-tertiary">Loading…</div>` with
**no `role="status"`/`aria-busy`/`aria-live`**, so loads aren't
announced: `settings/{PreferencesPanel:78, CardLayoutPanel:81,
CalendarPanel:56, UsersPanel:475, SprintsPanel:182,
WorkflowPanelFrame:98, SavedViewsPanel:211, SidebarPinsPanel:66,
MilestonesPanel:269, ProjectsPanel:585, SidebarGroupsPanel:66,
LabelsPanel:358}`, `milestones/{MilestoneDetail:89,248,
MilestonesView:146}`, `sprints/SprintDetail:72`. The pattern *exists* —
`comments/CommentsPanel.tsx:76` (`aria-busy`), `board/BoardView.tsx:470`
(`role="status"`) — most features just don't use it. **Fix:** a shared
`LoadingState` with the live-region baked in.

### A4. Ad-hoc accent focus rings override the token ring — P2
Global ring is `styles/index.css:143`
`:focus-visible { outline: 2px solid var(--text-primary) }`. Several raw
inputs override it with an **accent-colored** ring —
`shell/Header.tsx:248`, `list/SaveViewDialog.tsx:52`,
`list/AdvancedQueryEditor.tsx:147`, `shell/SkipLink.tsx:35`
(`focus:outline-accent`) — the exact low-contrast-ring risk the CSS
comment warns about (accent ring near accent surfaces), reintroduced ad
hoc.

### Passed (verified, no action)
- Icon-only buttons carry `aria-label`; `IconButton` enforces it as a
  required prop.
- No `onClick` on non-interactive elements without keyboard support
  (`editor/BodyRenderedView.tsx:83` does it correctly).
- No hover-only reveal affordances (`relationships/RelationshipRow.tsx:46`
  explicitly documents keeping the action focusable).
- `ui/ErrorState` (`role="alert"`) is the single error pattern, used
  across 27 features.
- **Colors: no raw literals** in styling — every inline style uses
  `var(--…)`; dynamic colors are user-supplied label colors, correctly
  so.

---

## B. Primitive / component consistency — fast-follow

### B1. Delete/confirm dialog family is divergent — P1 (top consistency fix)
**7 delete/confirm dialogs, no shared confirm primitive, 3 distinct base
implementations:**
- hand-rolled overlay+panel: `task/DeleteTaskDialog.tsx:72`,
  `list/DeleteConfirmDialog.tsx:75`, `comments/DeleteCommentDialog.tsx:54`,
  `settings/DeleteViewDialog.tsx:44`
- `Modal` + `Button`: `settings/RemapDeleteDialog.tsx:76`
- `Modal` + **raw `<button>`**: `settings/DeleteProjectDialog.tsx:48`
  (:55,:108,:116 + raw `<select>` :79), `settings/UserDeleteDialog.tsx:88`
  (:155,:188,:196 + raw `<input>` :170 + raw radio :125)

The four hand-rolled overlays duplicate the exact string `w-full
max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5` — and
don't even match `Modal`'s own `bg-bg-surface-raised shadow-overlay`.
Three of them are the §A1 a11y regression. The confirm-word logic is
*already* shared (`DeleteConfirmDialog.tsx:15` `DELETE_CONFIRM_WORD`,
imported by `UserDeleteDialog.tsx:11`) — only the shell around it is not.

**Fix:** a `ConfirmDialog` over `Dialog`/`Modal` with
`{title, body, confirmLabel, variant="danger", confirmDisabled,
onConfirm, onCancel}`, plus a `TypedConfirmDialog` variant for the
type-to-confirm dialogs. Closes §A1 for this family for free.

### B2. Button primitive barely adopted — P1
~170 raw `<button>` outside `ui/` vs 33 files importing `ui/Button`.
Many re-spell the exact variants Button provides:
- danger fill: `settings/DeleteProjectDialog.tsx:126`,
  `settings/UserDeleteDialog.tsx:201` (`bg-danger-fg px-3 …`)
- primary: `settings/DeleteProjectDialog.tsx:58`
- ghost: `settings/UsersPanel.tsx:428`, `settings/ProjectsPanel.tsx:167`
- more across `shell/Header.tsx`, `shell/Sidebar.tsx`, `list/ListView.tsx`,
  `relationships/RelationshipsPanel.tsx`, `attachments/AttachmentsPanel.tsx`,
  `sprints/SprintsView.tsx`, `activity/ActivityPanel.tsx`

These miss the hover/active/focus/`cursor-pointer`/`disabled` states in
`BUTTON_BASE` (`Button.tsx:77`) — the exact defect Button was built to end.

### B3. Danger banner — `Callout` not adopted (17 duplicates) — P1
`border-danger-fg/30 bg-danger-fg/5` appears **17×**
(`list/ListView.tsx:535,585`, `board/BoardView.tsx:305,337,352`,
`sprints/SprintsView.tsx:268,368,408,450`, `sprints/SprintDetail.tsx:186`,
`timeline/TimelineView.tsx:496,542`, `milestones/MilestonesView.tsx:213,230`,
`task/FieldFailureNotice.tsx:51`, `create/CreateTaskModal.tsx:439`,
`board/ConfigErrorState.tsx:43`). `Callout` (danger tone) exists for
exactly this; only 8 files import it, none of the above. The hand-rolled
banners use `bg-danger-fg/5`, `Callout` uses the `bg-danger-bg` token —
so they're not even the same color.

### B4. Raw form controls beside their primitives — P2
- 55 raw `<input>` outside `ui/` (excl. checkbox/radio). Direct drift:
  `settings/UserDeleteDialog.tsx:170` hand-spells the typed-confirm input
  while `task/DeleteTaskDialog.tsx:103` uses `TextField` for the *same*
  field.
- raw `<select>`: `settings/DeleteProjectDialog.tsx:79`,
  `task/MoveTaskDialog.tsx`, `task/editors/OptionPicker.tsx`,
  `relationships/LinkPicker.tsx` (despite `ui/Select`).
- raw radios: `settings/UserDeleteDialog.tsx:125,138` while sibling
  `settings/RemapDeleteDialog.tsx:93,107` uses the `Radio` primitive for
  the identical remap-choice UI.

### B5. Hand-rolled menus bypass `ui/Menu` — P2
`list/ExportMenu.tsx`, `list/BulkBar.tsx` (:345,:369) build `role="menu"`
dropdowns by hand instead of `ui/Menu` (used correctly by Header,
TaskDetail, FilterDropdown, RelationshipRow, KeyboardPanel).

### B6. Chip + icon-glyph adoption partial — P2
Chip: 4 importers; hand-rolled pills remain in
`sprints/SprintMetaHeader.tsx:285,390`, `milestones/MilestoneDetail.tsx:186`,
`milestones/MilestonesView.tsx:390,398`, `task/editors/LabelsField.tsx:144,169`,
`create/CreateTaskModal.tsx:1172`, `shell/Sidebar.tsx:353`.
Glyphs bypassing the `ICON` map (`ui/icons.ts`): `create/CreateTaskModal.tsx:427`
& `shell/ShortcutHelpDialog.tsx:80` use `"×"` (want `ICON.close` `✕`);
`list/FilterDropdown.tsx:89`, `relationships/RelationshipsPanel.tsx:241`,
`relationships/TreeRows.tsx:75` use literal `▾`/`▸`.

### Library health (verified, no redesign needed)
- **Dialog vs Modal:** correctly layered, not redundant. Modal = base
  (backdrop, trap, inert, Esc/backdrop-close, `role=dialog`); Dialog =
  body + `DialogActions` over Modal. The real "second implementation" is
  the hand-rolled overlays in §B1, which should be deleted.
- **Button / IconButton / ToolbarButton:** clean separation, both compose
  Button and share `BUTTON_VARIANT`. No redundancy.
- **Icons:** deliberate Unicode-glyph strategy via `ICON` map, not an
  `<Icon>` component. Only 8 inline `<svg>`, all legitimate (charts,
  glyphs).

---

## C. Design-token adherence — fast-follow (cosmetic)

### C1. Spacing scale (`--space-*`) never adopted — B4 never ran — P2
- `var(--space-*)` at call sites: **0**.
- rem-based Tailwind spacing (`p-*`,`gap-*`,`m-*`,`space-y-*`): **1,818
  across 108 files**.
- tokens.css (lines 27-28) self-confirms: *"no call site is migrated onto
  these yet (that is B4)."* Because `--space-*` is deliberately **not**
  wired into `@theme`, `p-2` gets Tailwind's rem step (7px at the 14px
  root), not `--space-2` (8px). Adoption needs explicit
  `p-[var(--space-2)]`-style edits. Worst files: `settings/GitSyncPanel`
  (54), `settings/ProjectsPanel` (53), `sprints/SprintsView` (46).

### C2. Type scale never adopted — P2
Named scale (`text-meta/label/body/heading`, `index.css:88-91`) used in
**12 places, all in `ui/`**. **873** `text-[Npx]` remain:
`[12px]`×352 → `text-label`, `[13px]`×334 → `text-body`, `[11px]`×139 +
`[10px]`×21 → `text-meta`, `[15px]`×15 → `text-heading`; off-scale
one-offs `[14px]`×8, `[9px]`×2, `[20px]`×1 (`task/TaskDetail.tsx`).
**Also:** the `index.css:71-87` comment claims this scale "replaces the 9
ad-hoc `text-[Npx]` sizes" — false; ~875 remain. **Fix the comment
regardless of the migration.**

### C3. Radius drift — P2
`rounded-sm/md/lg` used 182× (good), but **204 bare `rounded`**
(= 0.25rem = 3.5px at 14px root, bypassing `--radius-sm` 4px), e.g.
`ui/ErrorState.tsx:120,129,137`, `init/InitWizard.tsx:143,146,269`; and
`shell/Header.tsx:327` `rounded-[4px]` → should be `rounded-sm`.

### C4. Arbitrary dimensions — P3 (minor)
37 bracket px/rem widths/heights bypassing any scale, mostly
dropdown/popover widths where no token exists (`w-[280px]` recurring in
board/sprints/list/header). Low priority — no token to migrate to.

---

## Suggested sequencing

1. **§A1 `ConfirmDialog`/`TypedConfirmDialog` primitive** — fixes the P0
   a11y regression *and* the §B1 dialog divergence in one move.
2. **§A3 `LoadingState`** + **§A2 `Menu` arrow-keys** — remaining a11y.
3. **§B2/B3/B4 mechanical adoption** — Button, Callout, form controls.
   Each is find-and-replace against an existing primitive; do file by
   file, mutate the component's own tests (per `lessons.md`).
4. **§C1/C2 token migrations** — the big mechanical passes. Consider
   codemods; ~2,700 sites. Fix the false `index.css` comment (C2) now,
   independent of the migration.

Each closes, per the project bar, only when the corrected pattern is
codified as a case + `@verifies` test — not on the edit alone.

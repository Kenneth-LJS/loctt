# Phase Z Batch 2 — A11Y + Code-Smell review of `apps/web/src/client`

Read-only review. Scope: concrete gaps a real screen-reader/keyboard user
hits, and maintainability hazards that are latent bugs or proven-dead
artifacts. Nits and "could be cleaner" observations are deliberately
omitted.

Already-recorded gaps are **cited, not re-filed**:
- **A95** — text-only-zoom / hardcoded 792px absolute type scale (decision A95, known-gaps).
- **A94** — `ui/Menu.tsx` has no arrow-key/type-ahead navigation (decision A94).
- The axe-dependency and manual-screen-reader items M4.8 declined (A11Y-39/40).
- **A134** — the `useVanishedViews` render-loop, fixed; used here as the
  reference pattern when hunting siblings (none found — see code-smell note).

---

## A11Y

### 1. ReconcilePanel pick-value controls have no associated label — A11Y-22 violation
**File:** `apps/web/src/client/settings/ReconcilePanel.tsx:410` (enum `<select>`) and `:426` (scalar `<input type="text">`)

Both branches of the per-field "pick a third value" control render a bare
form field with **no `<label htmlFor>`, no `aria-label`, and no
`aria-labelledby`**. The field's identity (`conflict.fieldLabel`) is a
plain `<div>` at line 376, not programmatically associated with the
control. The enum branch's only text is the placeholder option
`"Pick a value…"` (line 419); placeholder text is not a label.

**Impact:** A screen-reader user resolving a git reconciliation hears
"combobox" / "edit text" with no field name. On a multi-field, multi-task
conflict they cannot tell which field's third value they are typing —
exactly the failure A11Y-22 names ("Every form field has a
programmatically associated label ... every settings form"). The
keep-local / keep-remote `SideButton`s (line 448) are fine (they carry
visible text); only the pick-value control is unlabelled.

**Severity:** major. Every other inline editor in the app
(`OptionPicker`, `DateField`, `TextField`) sets `aria-label`/`aria-describedby`
meticulously; this panel is the one settings form that skipped it. The
fix is a one-line `aria-label={`Pick a value for ${conflict.fieldLabel}`}`
on each control, or associating the line-376 label via `htmlFor`/`id`.

---

### 2. (Not a finding — verified OK) Modal focus trap, inert background, focus restore
`ui/Modal.tsx` + `ui/useFocusTrap.ts` are thorough: focus trap recomputed
per keystroke, chrome inerted with depth counting, focus restored via a
module-level focusin history with `isConnected` fallback. All dialogs that
matter route through `Modal`/`useFocusTrap`. `OptionPicker`, `LinkPicker`,
`MentionMenu`, `AttachmentsPanel`, `DateField`, `TextField` were all
inspected: labels, `aria-label`, `role="listbox"`/`role="option"`, Escape +
focus-return, and `aria-hidden` decorative glyphs paired with `sr-only`
text (`list/cells.tsx`, `RelationshipRow`, `TimelineChart`, `SprintsView`)
are all correct. `AttachmentsPanel` has no preview "viewer" overlay — it
downloads — so there is no un-trapped viewer. No findings in these.

**Note (borderline, not filed as a blocker):** `OptionPicker`
(`task/editors/OptionPicker.tsx:177`) and `MentionMenu`
(`editor/MentionMenu.tsx:168`) use `role="listbox"` with `role="option"`
children rendered as real `<button>`s. They are keyboard-operable (Tab
through options; MentionMenu additionally has full arrow/Enter/Escape
handling and `aria-selected`), but neither uses `aria-activedescendant`
and OptionPicker has no in-listbox arrow navigation. This is the **same
class as A94** (`Menu.tsx` arrow-key nav) rather than a new blocker: the
controls work by keyboard, they are just not idiomatic ARIA listboxes.
Recorded here for completeness; treat as the A94 family, not a separate
gap.

---

## CODE-SMELL

All dead-export findings were confirmed by scanning every `.ts`/`.tsx` in
`apps/web/src` (client + server): the identifier appears **only at its own
declaration** and nowhere else in any `src` tree (only in built `dist/`),
including test files and barrels (there is no `api/hooks` barrel).

### 3. `useSaveWorkflow` + `withCollection` — retired buggy predecessor, still exported, dead
**File:** `apps/web/src/client/api/hooks/useWorkflowMutations.ts:62` (`useSaveWorkflow`) and `:139` (`withCollection`)

`useSaveWorkflow` PUTs the **whole workflow document** built from the
panel's possibly-stale in-memory copy. The doc comment immediately below
it (lines 70–91) describes exactly the stale-clobber bug this shape
causes — "with the Statuses panel open, adding a status by hand and then
dragging a row deleted the hand-added status" — and `useSaveWorkflowCollection`
(line 107) is its **replacement**: it re-reads the document immediately
before the PUT and applies the panel's edit to the fresh copy (SET-28).
`withCollection` (line 139) is the naive `{...workflow,[key]:value}` helper
the old path implied; the replacement uses the `CollectionEdit.apply`
callback instead.

**Proof:** both `useSaveWorkflow` and `withCollection` have zero importers
anywhere in `src`. The whole app saves workflow edits through
`useSaveWorkflowCollection`.

**Impact:** a latent trap. Anyone wiring a new workflow panel who reaches
for the obviously-named `useSaveWorkflow` reintroduces the SET-28 stale
clobber the codebase already paid to fix. Dead code that is *the wrong way
to do the thing next to the right way* is worse than inert dead code.
**Severity:** major.

### 4. `useSetProjectPrefix` — dead hook; PRU-44 (edit existing prefix) has no UI
**File:** `apps/web/src/client/api/hooks/useProjectMutations.ts:102`

Implements the prefix-change endpoint (`PUT /api/projects/:id/prefix`,
PRU-44 — "Changing a project's prefix renames every task in it, and says
so before doing it"). Zero importers; no client code posts to that
endpoint. `settings/ProjectsPanel.tsx` has a prefix `<input>` only in the
**create** form (`project-create-prefix`, lines 35–102); there is no
edit-existing-prefix control anywhere.

**Impact:** PRU-44 is a defined **M4 major** case (with the blast-radius
confirmation, `key_history` preservation, etc.) and is **not** in
known-gaps. The core hook and server endpoint exist and are exercised by
CLI/MCP, but the web surface for it was never built. This is both a dead
export and an unrecorded functional gap.
**Severity:** major (functional gap) — the dead hook is the tell, not the
whole story. Recommend either wiring PRU-44 into ProjectsPanel or
recording it in known-gaps.

### 5. `useUpdateUser` — dead hook, no backing requirement
**File:** `apps/web/src/client/api/hooks/useUserMutations.ts:32`

`PUT /api/users/:id` (edit a user's name/email). Zero importers.
`settings/UsersPanel.tsx` wires only `useCreateUser`, `useArchiveUser`,
`useDeleteUser` — there is no edit-user control, and no defined case
requires editing an existing user's profile in the web UI (flow-projects-users
has no such case; not in known-gaps).

**Impact:** genuinely inert dead code — the endpoint is used by CLI/MCP,
but this web hook has no requirement behind it and no caller. Safe to
delete.
**Severity:** minor.

### 6. `lockedCustomFieldProps` — dead single-source-of-truth helper; lock inlined instead
**File:** `apps/web/src/client/settings/workflowEdits.ts:188`

Written as the SET-16 authority for which custom-field props lock once the
field exists (its own doc, line 186: "This function is what the panel
disables on"). Zero importers. `settings/CustomFieldsPanel.tsx`
**hardcodes** the disabled state inline instead (lines 205, 219 —
`disabled` literals on the type and multi controls).

**Impact:** the helper that was meant to keep the lock rule in one place is
orphaned while the rule lives inline in the panel. Behaviour is currently
correct, but the two can drift: a future lock rule change made in the
helper (the obvious place, given its doc) would silently not reach the
panel.
**Severity:** minor.

### 7. `defaultStatusKey` — dead helper; logic duplicated inline
**File:** `apps/web/src/client/settings/workflowEdits.ts:205`

Returns the default status's key (SET-3, "exactly one status is the
default"). Zero importers. `settings/EnumCollectionPanel.tsx:258` inlines
the same predicate — `(row as StatusDef).default === true` — instead of
using the helper.

**Impact:** duplicated default-detection logic; the extracted helper is
dead. Low risk (the predicate is trivial) but it is a proven-dead export
with its logic copied inline.
**Severity:** minor.

### 8. `DEFAULT_COLUMN_ORDER` — dead constant
**File:** `apps/web/src/client/list/columns.ts:53`

`export const DEFAULT_COLUMN_ORDER = DEFAULT_COLUMNS.map(c => c.id)`. Zero
importers anywhere in `src`.
**Impact:** inert dead constant, safe to delete.
**Severity:** minor.

---

## Render-loop (A134) sibling check — clean

Surveyed all 128 `useEffect` sites in the client for the A134 pattern (an
effect that `setState`s while depending on a freshly-built array/object
reference). None found:
- `TimelineView.tsx` lines 129/214/220 depend on `items` but are `useMemo`,
  not effects — no setState, no loop; `items` is itself memoised on `pages`.
- `CreateTaskModal.tsx:159` depends on the unstable `initial` object but is
  guarded by `if (seeded) return` + `setSeeded(true)`, so it runs once.
- `useVanishedViews.ts` (the A134 fix) uses a stable content signature.
The codebase consistently defends this class with `useMemo`, string
signatures, and one-shot guards. No new finding.

---

## Summary

**A11Y:** 1 finding — 1 major (ReconcilePanel unlabelled pick-value, A11Y-22).
(Plus 1 borderline OptionPicker/MentionMenu listbox note folded into the
A94 family, not counted.)

**Code-smell:** 6 findings — 2 major (`useSaveWorkflow`/`withCollection`
retired-buggy dead path; `useSetProjectPrefix` dead hook / unbuilt PRU-44),
4 minor (`useUpdateUser`, `lockedCustomFieldProps`, `defaultStatusKey`,
`DEFAULT_COLUMN_ORDER` dead exports).

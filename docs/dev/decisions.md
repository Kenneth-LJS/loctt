# Design decisions

Locked decisions for LocTT, extracted from the v1 UI planning docs before
those were retired. Keys (`D1`, `Q4`, `CW-3`, …) are preserved so existing
cross-references keep resolving.

**What's here and what isn't.** Decisions whose outcome is visible in the
code are *not* repeated — the code is the record, and duplicating it here
would just create another thing to drift. What survives is the material
that leaves no trace:

1. **Deliberately not built** — the "we decided against X" calls. Nothing
   in the codebase distinguishes these from oversights, so without this
   list someone eventually "fixes" them.
2. **Decided but unbuilt and unticketed** — real decisions that fell out
   of the plan. These need converting to tickets or dropping on purpose.
3. **Superseded** — where the shipped behaviour diverged from the locked
   decision. Recorded so the old decision isn't re-applied.

---

## 1. Deliberately not built

Each of these is a considered "no". Re-opening any of them is a product
decision, not a bug fix.

### Scope boundaries for v1

| Key | Decision | What not to "fix" |
|---|---|---|
| **Q21** | **No notifications.** | Absence of any notification system is intentional. |
| **Q23** | **English only.** No i18n framework. | Don't add a translation layer speculatively. |
| **Q25** | **No roles or permissions.** | LocTT is single-user-per-machine; there is no authorization model to complete. |
| **Q27** | **No time tracking.** | `estimate` is a planning number, not a timer. |
| **Q29** | **No print stylesheets.** | |
| **Q16** | **Empty states are text-only.** | No illustrations. |
| **B7** | **No workflow preset selector.** The canonical default workflow (CW-10) is the only starting point. | The absence of "choose a template on init" is deliberate. |
| **B8** | **No workspace name field.** Display uses the directory basename. | Grep confirms zero trace of `workspace_name` anywhere — without this row it reads as an oversight. |

### Capabilities kept out of the UI on purpose

| Key | Decision | Why it matters |
|---|---|---|
| **C2** | **`rebuild key index` is CLI-only.** | A recovery operation, not a routine one. Unlike C1, this one stands. |

### Interaction calls that leave no artifact

| Key | Decision |
|---|---|
| **Q4** | **No websockets and no manual refresh button.** Cross-tab freshness is TanStack Query `staleTime` plus focus refetch. |
| **Q6** | **Card layout is visibility + ordering only — no 2D positioning.** |
| **Q7** | **Broken sidebar pins are silently dropped** *and* removed from config on next render. |
| **Q15** | **Sort-only saved views are allowed** (a view need not filter). |
| **Q20** | **Tasks in archived projects stay editable.** Archiving a project is a list-hygiene action, not a freeze. |
| **SV-6** | **Duplicate saved-view names warn, don't block.** |
| **SV-7** | **Built-in filters are not editable in place.** Editing one opens a Create dialog pre-populated from it. |
| **D19** | **Timezone is editable in two places and last-write-wins.** The duplication is intentional, not a bug to consolidate. |
| **D13 / B18** | **No "hide discarded" board toggle** — superseded by per-status filter chips before it was built. |
| **Q1** | **"No default — force picker" is a valid workspace state.** Don't assume a default project always exists. |

---

## 2. Resolved — scheduled for build

Every item here was decided, then fell out of the plan. All have now been
given a disposition.

| Key | Decision | Disposition |
|---|---|---|
| **D2 / B2** | **Global search** in the header — `text ~ q` DSL, no full-text index. | **Build now.** No longer milestone-gated. |
| **B5** | **Lossy-content guardrail** — detect constructs WYSIWYG cannot represent, warn, and force source mode for that task. | **Build.** The spec already exists in [markdown-extensions.md](markdown-extensions.md#lossy-content-guardrail); it was never implemented. Custom TipTap nodes cover LocTT's own extensions (KaTeX, `^sup^`, `~sub~`, mentions, `![[attachments/x]]`) so those stay visually editable; footnotes and unregistered raw HTML trigger the fallback. Tables need no fallback — `@tiptap/extension-table` handles them. |
| **CW-4** | Bulk ops: `bulkLink`, `bulkUnsetField`, CLI `loctt set T-1,T-2 …`, MCP `bulk_update_tasks`. | **Build in full**, plus HTTP bulk routes — the existing `bulkSetFields` / `bulkArchive` currently reach no surface at all. |
| **SV-2** | Saved-view editor reachable from list/board/timeline filter bars, sidebar, view pickers, and Settings. | **Build all entry points.** Endpoints and UI made obsolete by this work get removed rather than left dangling. |
| **SV-3** | Basic mode covers **all** DSL fields, including custom fields and `relationship.<type>`. | **Build.** Blocked on first fixing the `relationship.<type>` vs `.target` evaluator bug — otherwise the chip builder emits queries that cannot match. |
| **SV-4** | Sort rows inline below filter rows, drag-reorderable for sort priority. | **Build.** |
| **B14** | Relationship rows show each target's live status. | **Build.** Requires `TaskResponse` to carry resolved relationships first — it currently drops them (`packages/contracts/src/service.ts:97-107`). |
| **D17** | Editor mode (WYSIWYG vs source) persists per user via `UserSettings`. | **Build**, alongside CW-17. |

## 3. Superseded — do not re-apply

The locked decision no longer matches what shipped.

| Key | Was decided | What shipped |
|---|---|---|
| **Q19** | Relationship symmetry via a **`symmetric: true`** boolean on `RelationshipDef`. | Shipped as **`kind: "symmetric"`** (`packages/contracts/src/workflow.ts:64,126`). The old form is now **actively rejected** — `workflow.ts:110` errors when `inverse` equals `key`. Any doc or fixture still showing `symmetric: true` is a copy-pasteable bug. |
| **CW-17** | `UserSettings.card_layout` as an **ordered array** (visibility + order). | **Resolved — now implemented.** Was ticked done while only the older boolean-map shape existed in a test fixture. See §5. |
| **CW-20** | Frontend compresses **all** attachment uploads to JPG/WebP. | Narrowed to **avatars only**. |
| **Q24** | Three responsive breakpoints — desktop, tablet, phone — **from day one**. | Phone breakpoint deferred. |
| **Q26** | Comments with **1-level threading**, `@mentions`, and a "Mentions me" filter. | Threading dropped. Note that comments reach **no surface at all** today — the storage layer exists with zero callers. |
| **Q11** | No per-file attachment cap. | A size cap is enforced server-side. |

---

## 4. Still-binding invariants

Moved to **[invariants.md](invariants.md)** — different audience and
lifecycle. Decisions are history; invariants are rules you check a change
against.

---

## 5. Recently resolved

| Key | Resolution |
|---|---|
| **C1** | **Migration is no longer CLI-only.** The UI gets `POST /api/migrate` and a working "Migrate now" button on the schema banner, gated behind a preview-then-confirm flow showing what will change, how many files, and where the backup lands. MCP gains a migrate tool so agents are not stuck either. The "migration is CLI-only" comment in `packages/contracts/src/service.ts` is now wrong and must be updated when this lands. |
| **CW-17** | **`card_layout` is an ordered array** — `[priority, assignee, due_date]` — carrying visibility *and* order, satisfying Q6's drag-to-reorder. Now defined in `UserSettingsSchema` with contract tests. |

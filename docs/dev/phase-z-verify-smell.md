# Phase Z Batch 2 — adversarial verification of the code-smell findings

Verifies the six code-smell findings in `phase-z-findings-a11y-smell.md`
(§ CODE-SMELL, items 3–8) and the render-loop sweep claim. Read-only;
every claim below was re-derived by grep/read on 2026-09-06, not taken
from the findings doc.

**Method.** Each symbol was grepped with a word boundary across the
*whole* repo — `--include='*.ts' --include='*.tsx' --include='*.js'
--include='*.mjs' --include='*.json'`, excluding `node_modules`, `dist`,
`docs`, `.git` — so client, server, tests, e2e, CLI, MCP, core and
contracts were all in scope, not just `apps/web/src`. A symbol counts as
dead only when the sole hit is its own declaration.

**Public-surface check.** `apps/web` is consumed externally only through
`@loctt/web` (`apps/cli/src/commands/ui.ts:29` imports `createWebApp`).
`apps/web/src/server/index.ts` exports exactly `createWebApp`,
`LocttClient`, `AttachmentExistsError` and two types. None of the six
symbols live in that barrel; there is no `api/hooks/index.ts` barrel
(directory listed — 39 hook files, no index). So none of the six is part
of any public API surface. Nothing in `apps/cli`, `apps/mcp` or
`packages/*` imports from `apps/web/src/client`.

---

## Finding 3 · `useSaveWorkflow` + `withCollection` — **CONFIRMED-DEAD**

    $ grep -rnE "useSaveWorkflow\b" <repo, ts/tsx/js/json, no node_modules/dist/docs>
    apps/web/src/client/api/hooks/useWorkflowMutations.ts:62:export function useSaveWorkflow() {

    $ grep -rnE "withCollection" <same scope>
    apps/web/src/client/api/hooks/useWorkflowMutations.ts:139:export function withCollection<K extends keyof WorkflowConfig>(

One hit each, both the declaration. The word boundary matters:
`useSaveWorkflowCollection` would otherwise match.

**The live path is `useSaveWorkflowCollection`** (declared at `:107`),
imported and called by all four workflow panels:

    settings/RelationshipsSettingsPanel.tsx:5,51
    settings/EstimationPanel.tsx:5,40
    settings/EnumCollectionPanel.tsx:5,74
    settings/CustomFieldsPanel.tsx:5,55

Read of `useWorkflowMutations.ts:62-123` confirms the characterisation:
`useSaveWorkflow` PUTs whatever `PutWorkflowRequest` the caller built
(the stale in-memory document); the SET-28 doc block at `:70-91` sits
directly beneath it describing the clobber that shape caused; the
replacement re-`GET`s `/api/workflow` inside `mutationFn` and applies
`edit.apply(fresh)`. `withCollection` is the naive `{...workflow,[key]:
value}` spread — the replacement inlines the same spread against the
*fresh* copy at `:114`, so the helper is not even used by its successor.

**Severity assessment holds (major).** The hazard is real: the dead hook
carries the obvious name and a plausible-looking signature; the doc
comment that would warn a reader off it is positioned *after* it and
reads as the rationale for the next function. Delete both; no test or
barrel references either.

---

## Finding 4 · `useSetProjectPrefix` — **CONFIRMED-DEAD-PLUS-GAP** (all four legs confirmed)

### Leg (a) — the hook is dead

    $ grep -rn "useSetProjectPrefix" <repo-wide scope>
    apps/web/src/client/api/hooks/useProjectMutations.ts:102:export function useSetProjectPrefix() {

Single hit, the declaration. `ProjectsPanel.tsx:7-12` imports
`useArchiveProject, useCreateProject, useDeleteProject, useUpdateProject`
— not `useSetProjectPrefix`. No client file contains the string
`/prefix` as a request path except the dead hook itself (`:110`).

### Leg (b) — core / CLI / MCP / web-server all have it

    packages/core/src/projects/prefix.ts:122     export async function setProjectPrefix(
    packages/core/src/projects/index.ts:23       setProjectPrefix,          (re-export)
    packages/core/src/index.ts:246               setProjectPrefix,          (public core barrel)
    apps/cli/src/commands/project.ts:110         case "set-prefix": {
    apps/cli/src/commands/project.ts:156           const result = await setProjectPrefix(locttDir, id, newPrefix);
    apps/mcp/src/tools/project.ts:105              const result = await setProjectPrefix(locttDir, id, args["prefix"] as string);
    apps/web/src/server/server.ts:988            const PROJECT_PREFIX_RE = /^\/api\/projects\/([^/]+)\/prefix$/;
    apps/web/src/server/server.ts:1740             const result = await setProjectPrefix(locttDir, id, request.prefix);

Three surfaces plus the web *server* endpoint exist. The only layer
missing is the web *client*.

### Leg (c) — ProjectsPanel has no edit-prefix control

Read `apps/web/src/client/settings/ProjectsPanel.tsx` in full (402
lines). Two places touch a prefix:

- `CreateProjectForm`, `:99-104` — `<input data-testid="project-create-prefix">`,
  editable, **create only**. Its label text (`:96`) even says
  "changeable later only by renaming every task in the project".
- `ProjectRow`, `:206-216` — the per-project prefix cell is
  `<input readOnly disabled ... title="Changing the prefix renames every
  task in the project." value={project.prefix}>`. The comment above it
  (`:193-194`) says "PRU-6/PRU-20: slug and prefix are disabled, not
  merely unvalidated, and say why."

PRU-44's first bullet (`flow-projects-users.md:355`) is "The prefix
field is editable, not disabled". The shipped row is `disabled`. There is
no confirm dialog, no blast-radius text, no call site for the endpoint.
The panel's own `@case` list (`:19-20`) claims PRU-45 and PRU-46 but
**not** PRU-44 — and PRU-45 ("set one's prefix to the other's … error
renders at the prefix input") is unsatisfiable without an editable
prefix input, so that tag is hollow too.

### Leg (d) — not recorded in known-gaps (or anywhere durable)

    $ grep -niE "PRU-44|edit.{0,20}prefix|prefix.{0,20}(edit|change|rename)|useSetProjectPrefix" docs/dev/known-gaps.md
    (all hits are PRU-46 / K16 / prefix-format validation — none is PRU-44)

    $ grep -rln "PRU-44" docs/dev apps
    docs/dev/phase-z-findings-a11y-smell.md      (the finding under review)
    docs/dev/invariants.md:21                    (P-5 — says PRU-44 "depends on the change being possible")
    docs/dev/case-index.json                     (the index)
    docs/dev/ui-test-cases/flow-projects-users.md (the case)
    apps/web/src/server/server.ts:1726           (comment)
    apps/web/src/server/server.test.ts:779       (@verifies — see below)
    apps/web/src/client/api/hooks/useProjectMutations.ts:98 (the dead hook's doc)

Not in `known-gaps.md`, not in `decisions.md` (grep for PRU-44 returns
nothing; K16 is PRU-46), not in `TEMP-RUN-WORKFLOW.md` § cases that
cannot be satisfied yet (grep empty). The *only* place the gap was ever
written down is the M4 gate r2 row of `TEMP-BUILD-PLAN.md`'s Status
table (`:186`: "**Recorded, not built**: … PRU-44/45 (the prefix field
is `readOnly` **and** `disabled`, and `useSetProjectPrefix` has **zero
callers**"). That file is working state slated for deletion when the
build lands, so the record does not survive. The finding's "not in
known-gaps" is correct and slightly understated.

**Extra evidence the coverage is hollow.** The only `@verifies PRU-44`
is `server.test.ts:779`, whose docstring reads: "The API half of the
prefix-rename UI cases. The panel itself is not built (settings routes
are still stubs)". The panel *is* now built; the docstring is stale, and
the tag still lets PRU-44 count as covered under `--require` with the
UI half absent.

**Verdict:** CONFIRMED-DEAD-PLUS-GAP. Severity major stands; this is a
defined M4 major case with no web implementation and no durable record.
Do **not** delete the hook as dead code — it is the correct client half
of an unbuilt feature. Either wire it (PRU-44 + PRU-45) or move it out
of the tree *and* record the gap in `known-gaps.md`.

---

## Finding 5 · `useUpdateUser` — **CONFIRMED-DEAD** (no lurking gap)

    $ grep -rnE "useUpdateUser\b" <repo-wide scope>
    apps/web/src/client/api/hooks/useUserMutations.ts:32:export function useUpdateUser() {

`UsersPanel.tsx:7-13` imports `useArchiveUser, useCreateUser,
useDeleteUser` only; `:203,273-275` instantiate those three. No edit-user
control in the panel. Unlike PRU-44, no case in `flow-projects-users.md`
requires editing an existing user's name/email in the web UI, so this is
purely dead — safe delete. (The `PUT /api/users/:id` server endpoint
stays; it is used by other surfaces.)

---

## Finding 6 · `lockedCustomFieldProps` — **CONFIRMED-DEAD** (drift risk, not a functional gap)

    $ grep -rn "lockedCustomFieldProps" <repo-wide scope>
    apps/web/src/client/settings/workflowEdits.ts:188:export function lockedCustomFieldProps(existing: boolean): ...

Declaration only. Its doc (`:186`) says "This function is what the panel
disables on" — false. `CustomFieldsPanel.tsx:205` (`<select … disabled>`)
and `:219` (`<input type="checkbox" … disabled>`) are bare `disabled`
literals with no reference to the helper. Behaviour matches the rule
(`type` and `multi` locked) so nothing is broken; the finding's "two can
drift" framing is accurate. Minor stands. Either call the helper from the
panel or delete it and fix the doc comment.

---

## Finding 7 · `defaultStatusKey` — **CONFIRMED-DEAD**

    $ grep -rnE "defaultStatusKey\b" <repo-wide scope>
    apps/web/src/client/settings/workflowEdits.ts:205:export function defaultStatusKey(statuses: readonly StatusDef[]): ...

Declaration only. `EnumCollectionPanel.tsx:258` inlines the predicate:
`const isDefault = isStatus && (row as StatusDef).default === true;`.
Trivial duplication; safe delete. Minor stands.

---

## Finding 8 · `DEFAULT_COLUMN_ORDER` — **CONFIRMED-DEAD**

    $ grep -rn "DEFAULT_COLUMN_ORDER" <repo-wide scope>
    apps/web/src/client/list/columns.ts:53:export const DEFAULT_COLUMN_ORDER: readonly string[] = DEFAULT_COLUMNS.map(c => c.id);

Declaration only. Note `columns.test.ts` uses `DEFAULT_COLUMNS.map(c =>
c.id)` inline six times (`:13,54,60,72,80`) — the exact expression the
constant wraps — so the constant was probably written for the test and
never adopted. Inert; safe delete. Minor stands.

---

## Render-loop (A134) sibling sweep — **claim holds; one number is wrong**

**Count discrepancy.** The findings doc says "all 128 `useEffect` sites".
`grep -rn "useEffect(" apps/web/src/client` returns **77** call sites
(78 lines mentioning `useEffect` excluding imports; zero in test files).
128 is not reproducible from the tree — possibly counted `useMemo`/
`useCallback` too, or `dist/`. The conclusion is unaffected but the
number should not be repeated.

**Spot-check of the riskier sites** — effects whose dependency arrays
contain arrays/objects rebuilt each render and that call `setState`:

| Site | Deps rebuilt per render? | Guard | Loop-safe? |
|---|---|---|---|
| `shell/useVanishedViews.ts:78` (the A134 fix) | `current` is fresh every render | depends on a string `signature` built from `id name` pairs, not the array; `current` read inside but excluded from deps | yes |
| `settings/SidebarPinsPanel.tsx:88-95` | `sweep.removed` / `sweep.kept` are new arrays every render (`sweepSidebarPins` is called inline at `:80`), so the effect **does** re-run every render | `sweptFor` ref holds `sweep.removed.join(",")`; early-returns when unchanged, so `setExplained` + `save.mutate` fire once per distinct sweep | yes — same signature-ref pattern as A134 |
| `create/CreateTaskModal.tsx:159-165` | `initial` is a `useMemo` on `[choice, initialStatus, currentUser.data]`, but `currentUser.data` can change on refetch | one-shot: `if (seeded) return; … setSeeded(true)` | yes |
| `board/useBoardDrag.ts:144-151` | `columns` prop array | no `setState` unless a column vanished mid-drag, and then only `cancel()` which sets `drag` to `null` (bails out if already null); no dep on `drag` itself | yes |
| `list/ListView.tsx:453-476` | `loadedPages` is a number derived from `pages.length`; `fetchNextPage` is TanStack-stable | comment at `:454-456` explicitly says `tasks` was *not* used as a dep because it is a fresh reference every render; the `navigate` effect at `:467` guards on `loadedPages > urlPage` | yes |
| `timeline/TimelineView.tsx:85-89` | `views.data` | this is `useMemo`, not `useEffect` — no setState | n/a (finding doc's note about TimelineView being memo-not-effect is correct) |

All five effect sites defend the class the way the doc says (string
signature, one-shot flag, primitive-only deps, or a bail-out `setState`).
The sweep claim is not hollow. I did not re-audit the remaining ~70
sites; most have deps like `[onClose]`, `[editing]`, `[storedTheme]`,
`[pathname, navigate]` — callbacks or primitives, not per-render arrays.

---

## Summary

| # | Symbol | Verdict | Action implied |
|---|---|---|---|
| 3 | `useSaveWorkflow`, `withCollection` | CONFIRMED-DEAD (major) | delete both; live path is `useSaveWorkflowCollection` (4 callers) |
| 4 | `useSetProjectPrefix` | CONFIRMED-DEAD-PLUS-GAP (major) | all 4 legs confirmed; PRU-44 (and by extension PRU-45) has no web UI and no durable record; do not delete as dead — build or record |
| 5 | `useUpdateUser` | CONFIRMED-DEAD (minor) | safe delete; no case requires it |
| 6 | `lockedCustomFieldProps` | CONFIRMED-DEAD (minor) | doc claims panel uses it; panel hardcodes `disabled` at `CustomFieldsPanel.tsx:205,219` — wire or delete+fix doc |
| 7 | `defaultStatusKey` | CONFIRMED-DEAD (minor) | inlined at `EnumCollectionPanel.tsx:258`; safe delete |
| 8 | `DEFAULT_COLUMN_ORDER` | CONFIRMED-DEAD (minor) | safe delete |
| — | A134 sibling sweep | HOLDS | "128 sites" is wrong (77); 5 riskiest effects each guard correctly |

Zero refutations. Nothing "dead" is exported through `@loctt/web`'s
public barrel or consumed by CLI/MCP/core. Two incidental stale-comment
findings surfaced while verifying: `server.test.ts:781-782` ("The panel
itself is not built (settings routes are still stubs)") and
`workflowEdits.ts:186` ("This function is what the panel disables on").

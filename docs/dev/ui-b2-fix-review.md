
## B2 fix-review — CONFIRMED bugs (must-fix before B2 commit)

### Projects/Users/Milestones lane (sub-review a11d052)
1. **Invalid email saves as 200 then vanishes** (silent data loss). UsersPanel Edit → email "bob" → Save 200, dialog closes, row shows blank (core degrades bad email into health on read; no write-side validation). Fix: client + server `z.email()` validation; reject, don't degrade-on-write.
2. **"(none)" timezone option lies.** Selecting it + Save reports success but core keeps the old tz (save() omits empty). Fix: honor clear (send null) or remove the option.
3. **Silent write failures**: set-default (ProjectsPanel), milestone-archive toggle, (pre-existing archive) never render `.isError`. Fix: surface the error (Callout/toast).
4. **Milestone archive leaves `/milestones` stale 30s** — invalidates `["milestones"]` but the view reads `["workflow","milestones-progress"]` (staleTime 30s). Fix: invalidate milestones-progress too.
5. **Project/Milestone Edit opens a STALE name draft after external rename** → Save writes the old name back. Fix: `setName(project.name)` on Edit click.
- Mis-tagged: dataPanels MSL-25 ×2 + flow-milestones:940 verify the archive toggle, not MSL-25 → retag. PRU-47 has no Playwright far-end (reload-shows-edits) → add one.

### Workflow lane (main reviewer a22cbf6) — FIXED 2026-09-06 (staged)
6. **flow-settings-workflow.spec.ts drives REMOVED inline testids** (custom-field-label-*.fill, -weight-*, -multi-*, -type-lock-*, relationship-inverse-*, -searchable-*) → e2e will fail. Fix: rewrite the spec for the new Edit-dialog flow. **FIXED:** SET-3/4/5/7/8/16 rewritten to the Edit-dialog flow (row read-outs + dialog controls); SET-33 also fixed (see below). Full `flow-settings-workflow` spec: 29/29 green. Red-first proven for SET-5/16/33.
7. **Relationship + custom-field Edit dialogs silently drop valid `icon`/`color`** (rebuild row from draft; statuses path spreads original). Fix: preserve unedited fields (spread original like statuses). **FIXED (A155):** `RelationshipDraft`/`CustomFieldDraft.values` carry optional icon/color, seeded from `initial` and re-emitted by the build helpers; statuses/priorities/task-types already spread original (regression test added). Wire-shape locked in `workflowPanels.test.tsx`, red-first.
8. **Field-delete blast-radius counts 0 for number/boolean fields** (usage counts only string values) → destructive confirm says "affects nothing" while core drops the field from every task (silent-loss shape). Fix: count all field types. **FIXED (A154):** new `custom_fields` per-field total in `computeWorkflowKeyCounts` (core), surfaced on web confirm + CLI `config usage` + MCP `get_workflow_key_usage` (P10 parity). Core unit + CLI/MCP integration red-first.
- **Bonus (K32 / SET-33):** the workflow panels now surface the tolerant `broken` config as a `workflow-panel-error` pane instead of an empty list (A156).

### Still pending: Sprints/Views + K-10 sub-reviews; sprint-archive follow-up.

### K-10 lane (sub-review a9ceea1)
9. **Header search Enter is BROKEN e2e** — `Header.tsx:217` → `/list?q=<raw>`; list treats q as DSL (`buildDsl.ts:44`), so `(bug)` → ParseError → "Could not load tasks". SHL-46's headline feature doesn't work. Fix: emit `q: 'text ~ "<q>"'` (match /api/search quoting). "See all results" (:288) same fault.
10. **Duplicate `/` binding** (A11Y-8 regression) — Header.tsx:199 adds a 2nd document keydown bypassing AppShell's dialog-guard. Fix: delete Header's listener (AppShell:130 already handles `/`→search).
11. **CLI read omits filters** — `user.ts:287` resolves SIDEBAR_GROUP_IDS only, so `--hidden overdue` writes but read-back shows all visible (write invisible on CLI). Fix: include filter ids in the read/resolve.
12. **CLI+MCP silently accept typo'd ids** (silent no-op) — `user.ts:270`/`tools/user.ts:150` drop unknown ids, exit 0/success, nothing changed. Fix: reject unknown ids with a clear error (or at least warn), don't silently drop.
- **Doc-record fix:** A150 + `sidebarGroups.ts:22` docstring + contracts comment say "one bad id degrades one entry"; actual loader drops the WHOLE key (parseSettingsTolerant). Code is P7-safe but the record lies. Fix the docs/A150 to state real behaviour.
- **GAP:** the batch-plan's doctor check for a corrupt sidebar_groups (ui-implementation-batches.md:295) was neither built nor recorded. Build the listing or record the decision not to.
- Vacuous tags: Sidebar.test.tsx:883, :898-906; Header.test.tsx:344 — strengthen (waitFor + real corrupt-degrade assertion).
- STYLE (fix if cheap): hiding `views` removes the only pointer-nav to Board/Timeline; mixed group+filter drag list implies filter-reordering that does nothing; panel has no reorder-persist test.

## Tally: 12 confirmed bugs + doc-record fixes + doctor gap + ~5 vacuous tags. B2 does NOT commit until fixed. Awaiting sprint-archive follow-up, then a consolidated fix wave (per-lane, red-first), re-review, gate, commit.

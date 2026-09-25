# Known gaps

Defects that are real, understood, and not yet fixed. Each says what is
wrong, how to reproduce it, and what (if anything) Ken has to decide
before it can be built.

**Check here before reporting a defect as new.** Delete an entry the
moment it is fixed. Nothing here is "deferred" (K117): an item stays
open until it is fixed or Ken rules on it. Fixed and accepted items live
in `decisions.md` and git history, not here. Process lessons live in
`docs/dev/process/build-loop.md`.

---

### A11Y-50: bulk-delete dialog text no longer matches the case's "cannot be undone" wording

`tests/ui/flow-accessibility.spec.ts:983` asserts
`await expect(dialog).toContainText(/cannot be undone/i);` but
`list/DeleteConfirmDialog.tsx`'s body now reads "Deleting tasks is
irreversible. Continue?" (K129's delete-confirmation ruling, applied
before this session). The two say the same thing but don't share a
substring, so the test fails deterministically, not flakily — confirmed
by running it alone, repeatedly, unrelated to any other change in
flight. Found while gating an unrelated B20 close-out session; not
touched here since `DeleteConfirmDialog.tsx` and this test are outside
that ticket's scope.

**Repro.** `npx playwright test tests/ui/flow-accessibility.spec.ts -g
"A11Y-50"` — fails every time with the mismatch above.

**What Ken needs to decide.** Whether to update the test's regex to the
current wording, or reintroduce "cannot be undone" into the dialog copy
— the case itself doesn't mandate either exact phrase, just that
irreversibility is stated.

### A11Y-55: `/settings/sidebar-groups` checkboxes are 14px tall, under the 24px pointer-target minimum

`tests/ui/flow-accessibility.spec.ts:3608` (`A11Y-55: every pointer
target on every Settings page is at least 24px`) fails deterministically
(confirmed by running it alone, repeatedly): every "Show X in the
sidebar" checkbox on `/settings/sidebar-groups`, plus its "Reset to
default" control, measures 24.5×14.0 / 89.5×17.2 — under WCAG 2.5.8's
24px minimum on the short axis. Found while gating an unrelated B20
close-out session; not touched here since `SidebarGroupsPanel.tsx` is
outside that ticket's scope.

**Repro.** `npx playwright test tests/ui/flow-accessibility.spec.ts -g
"every pointer target on every Settings page"` — fails every time,
naming all 15 undersized controls.

**What Ken needs to decide.** Whether to grow the checkbox row height on
`/settings/sidebar-groups` to meet the 24px minimum, consistent with
A334's fix for other Settings pointer targets.

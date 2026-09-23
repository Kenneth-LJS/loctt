---
name: review
description: Run a structured code review on recent changes or specified files
user-invocable: true
---

Perform a structured code review. If arguments are provided, review those files/paths. If no arguments, review recent uncommitted or staged changes.

## Review Checklist

Work through each category and report findings.

### 1. Correctness

- Does the code do what it claims?
- Are edge cases handled?
- Are error paths meaningful (not swallowed or generic)?
- Are types accurate and strict (no unnecessary `any`)?

### 2. Design Doc Compliance

Cross-reference changes against `docs/dev/` (architecture.md, schema-reference.md, etc.):

- Does the data model match confirmed schema?
- Does CLI surface match the intended commands?
- Are MCP guardrails respected (structured tools for metadata, no direct frontmatter editing)?
- Are workflow values using config `key`s not labels?
- Is the `.loctt/` directory structure correct?

Flag anything that contradicts a confirmed decision.

### 3. UI Glyphs (web client)

Ken has reported this three times; A208 is the ruling.

- No Unicode character used as an **affordance** — caret, close, kebab,
  reorder handle, checkmark, bullet. These are drawn with `<Icon>` from
  `apps/web/src/client/ui/Icon.tsx`. The `no-restricted-syntax` glyph
  rule in `eslint.config.js` fails the build on the unambiguous ones.
- **What the lint rule cannot catch, and you must:** arrows (`→ ← ↑ ↓`)
  and `×` are deliberately unbanned, because the app uses them as prose
  and typography (`{start} → {end}`, "Settings → Users", `×{n}
  duplicate`) and A208 keeps those literal. So check by eye whether a
  given arrow is *punctuation* (fine) or a *control* — a bare `→` in a
  button or link is an affordance and belongs in `<Icon>`.
- A native `<details>`/`<summary>` draws the browser's own `▸`. It is
  not in our source, so no grep and no lint rule will find it: use the
  shared `<Disclosure>` primitive, which suppresses the native marker.
- Adding a glyph to `ui/icons.ts` is almost always wrong. That map holds
  two text characters (`⭑`, `⚠`); a new affordance gets a path in
  `Icon.tsx`.
- **Action labels carry no trailing `…`** (K112) — menu items, buttons
  and links read `Edit`, `Delete`, `Set WIP limit`. Progress states
  (`Saving…`), input placeholders (`Search…`) and literal sequences
  (`1, 2, 3, …`) keep theirs. Lint cannot make this call: an action
  label and a progress string are the same AST shape, so a rule tight
  enough to avoid false positives misses the bare-JSX-text cases that
  actually regressed, and a loose one fires on every progress string.
- **No hand-rolled "animated glyph" spinners** (A312) — a JSX element
  whose `className` carries `animate-pulse`/`animate-spin` and whose
  only child is a short glyph-only text node (`•`, `...`, `⋯`, `●`, no
  letters/digits) is someone spinning a character instead of using the
  real spinner. Use `LogoSpinner`
  (`apps/web/src/client/ui/brand/LogoSpinner.tsx`) directly, or
  `Button`'s `loading` prop / `LoadingState` for a busy region — and
  give the busy region an accessible name (`aria-label`, or `aria-busy`
  + a `role="status"` message). The `no-restricted-syntax` rule in
  `eslint.config.js` catches this for a plain string-literal
  `className` (including one literal argument inside a `cn(...)` call).
  It does NOT see a class built by string concatenation, a template
  literal, or a variable — check those by eye. Skeleton bars
  (`animate-pulse` with no text child) are legitimate and the rule
  leaves them alone.

### 3a. Messaging (web client)

Ken has removed explanatory text app-wide (K116); `docs/dev/design/messaging.md` is the rule.

- New visible text that introduces, explains, reassures, restates a
  label, shows an internal path/ID, or duplicates navigation — flag it.
  Format hints and messages reporting something that happened are fine.
- Error/result text carries only: what happened, what it did to the
  data (saved / not saved / unknown), the next action, and a file path
  only when hand-editing it is the fix. Cause yes, justification no.
- No em dashes or semicolons in UI copy; a disabled control's reason is
  `SrOnly` + `aria-describedby`, never a visible notice.

### 4. Clean Code (per `.claude/housekeeping.md`)

- No debug logging left behind
- No dead code or commented-out blocks
- Comments describe WHY not WHAT
- No quick fixes or workarounds
- No `any` types without justification
- Named exports used

### 5. Impact Analysis

- What else in the codebase is affected by this change?
- Are there callers, tests, or docs that need updating?
- Any breaking changes to existing behavior?

### 6. Testing Gaps

- What's untested that should be?
- Are mocks limited to external dependencies only?
- Would existing tests catch a regression if this code broke?

## Output Format

```
## Review: [files or scope]

### Correctness
- [findings]

### Design Doc Compliance
- [findings or "No issues"]

### UI Glyphs
- [findings or "No issues" / "N/A — no web-client changes"]

### Clean Code
- [findings]

### Impact
- [affected areas]

### Testing Gaps
- [what needs tests]

### Summary
[severity] [count] issues found
- Critical: [list]
- Suggestions: [list]
```

Arguments: $ARGUMENTS

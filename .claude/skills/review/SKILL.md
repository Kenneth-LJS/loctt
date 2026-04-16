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

Cross-reference changes against `docs/` (architecture.md, schema-reference.md, etc.):

- Does the data model match confirmed schema?
- Does CLI surface match the intended commands?
- Are MCP guardrails respected (structured tools for metadata, no direct frontmatter editing)?
- Are workflow values using config `key`s not labels?
- Is the `.loctt/` directory structure correct?

Flag anything that contradicts a confirmed decision.

### 3. Clean Code (per `.claude/housekeeping.md`)

- No debug logging left behind
- No dead code or commented-out blocks
- Comments describe WHY not WHAT
- No quick fixes or workarounds
- No `any` types without justification
- Named exports used

### 4. Impact Analysis

- What else in the codebase is affected by this change?
- Are there callers, tests, or docs that need updating?
- Any breaking changes to existing behavior?

### 5. Testing Gaps

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

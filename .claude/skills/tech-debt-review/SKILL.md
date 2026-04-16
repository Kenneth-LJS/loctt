---
name: tech-debt-review
description: Review technical debt and suggest improvements
user-invocable: true
---

Perform technical debt review:

1. Read current debt from `.claude/technical-debt.md` (if it exists)
2. Scan codebase for issues:
   - Code quality problems
   - Architecture concerns
   - Missing tests for critical paths
   - Performance bottlenecks
   - Deferred TODOs
3. Categorize by severity (critical / moderate / low)
4. Prioritize by effort vs impact
5. Update `.claude/technical-debt.md` with findings
6. Present summary with recommendations

Arguments: $ARGUMENTS

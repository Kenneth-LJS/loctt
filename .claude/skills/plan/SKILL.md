---
name: plan
description: Create a detailed implementation plan for a feature
user-invocable: true
---

Create a comprehensive implementation plan for the specified feature.

Steps:
1. Read relevant docs from `docs/` and `docs/dev/` (architecture, schema-reference, etc.)
2. Review existing codebase for current implementation state
3. Analyze the codebase to understand current architecture
4. Break the feature into subtasks with dependencies
5. Identify all impacts (code,  docs, tests, cleanup)
6. Plan testing approach
7. Create cleanup checklist per `.claude/housekeeping.md`

Present the plan and wait for user approval before any implementation.

Arguments: $ARGUMENTS

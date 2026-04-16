---
name: feature
description: Full feature development workflow with review points
user-invocable: true
---

Execute the complete feature development workflow:

1. **Planning** - Create implementation plan
   - Read `design-doc.md` for confirmed decisions
   - Read `implementation-plan.md` for context
   - Present plan to user for review
   - STOP and wait for approval before proceeding

2. **Implementation** - Execute the plan
   - Follow git flow from `.claude/git-flow-config.md`
   - Present each subtask completion for review

3. **Testing** - Validate functionality
   - Create and run tests
   - Mock only external dependencies
   - Report results

4. **Documentation & Cleanup**
   - Update all relevant documentation
   - Run housekeeping checklist from `.claude/housekeeping.md`

5. **Completion**
   - Present summary of all changes

Arguments: $ARGUMENTS

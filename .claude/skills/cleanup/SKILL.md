---
name: cleanup
description: Run housekeeping cleanup checklist
user-invocable: true
---

Perform comprehensive housekeeping cleanup on the codebase.

Follow the complete checklist from `.claude/housekeeping.md`:
1. Debug code removal (`console.log`, temp logging)
2. Documentation cleanup (outdated docs, implementation docs that should be deleted)
3. Code cleanup (dead code, commented-out blocks, unused imports)
4. Folder structure check (root cleanliness, folder size limits)
5. File cleanup (temp files, test scripts, version indicators in naming)

Report findings organized by category, with specific file paths and line numbers.

Arguments: $ARGUMENTS
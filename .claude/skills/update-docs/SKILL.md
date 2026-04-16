---
name: update-docs
description: Update all relevant documentation
user-invocable: true
---

Update documentation to reflect recent code changes.

Steps:
1. Check recent changes (git diff or specified scope)
2. Identify which documentation files are affected
3. Update each affected doc consistently
4. Cross-reference `design-doc.md` to ensure no contradictions
5. Follow documentation standards from `.claude/housekeeping.md`

Do not invent new specifications. Only document what is implemented or confirmed.

Arguments: $ARGUMENTS

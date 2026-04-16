# Housekeeping Rules

These rules apply to all work on LocTT.

## Thoughtful Implementation

When adding features, enhancements, or bug fixes:

1. **Understand intent** - ask clarifying questions if purpose isn't obvious
2. **Investigate impact** - how does this affect existing features? breaking changes?
3. **Identify complications** - edge cases, dependencies, testing needs
4. **THEN implement** - not before

Do NOT jump straight to code. Question -> Analyze -> Discuss -> Implement.

## No Quick Fixes

Always solve root causes. Never apply symptomatic fixes.

Prohibited:
- Suppressing error logs instead of fixing the error source
- Adding workarounds instead of addressing the underlying issue
- Hiding warnings instead of resolving what causes them

If you want to suggest an alternative solution, discuss it first.

## TypeScript Code Standards

- Strict types everywhere, no `any` unless genuinely unavoidable (and commented why)
- Named exports over default exports
- Errors should be meaningful - include context about what went wrong and what was expected
- No dead code - delete it, don't comment it out
- No barrel files unless the project already uses them

## Comment Standards

- Describe WHY, not WHAT
- No redundant line-by-line commentary
- High-level descriptions of intent only
- TODOs must include context: `// TODO(reason): description`

## Cleanup Checklist (Before Finishing Work)

- [ ] Remove `console.log` / debug logging
- [ ] Remove test scripts and temp files
- [ ] Remove implementation/migration docs (temporary, not permanent)
- [ ] Remove outdated documentation
- [ ] Strip version indicators from naming (v2, new_, phase2, etc.)
- [ ] Update any documentation affected by the change

## Documentation Integrity

- Only document what is explicitly confirmed or implemented
- Mark incomplete sections as **[PLACEHOLDER - To be discussed]**
- Never invent specifications or requirements
- Cross-reference `docs/` for product documentation and decisions

## Folder Structure

- Keep root directory clean
- `.loctt/` layout must match the design doc structure
- Documentation folders: max 5-8 files, consolidate by theme when exceeding
- Code folders: flexible for homogeneous collections, organize heterogeneous ones

## Testing Philosophy

- Tests exist to catch bugs, not boost coverage metrics
- Mock only external dependencies (file system, network, timers), never business logic
- Before writing tests: what critical functionality is being tested? would this catch a real regression?
- Present test strategy before implementing

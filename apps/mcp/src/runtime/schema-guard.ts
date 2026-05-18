/**
 * Tools that bypass the schema-version boot guard. `init` is the
 * one tool legitimately called against a non-existent or
 * pre-version tracker.
 *
 * (Future expansion: a per-tool `exemptFromSchemaGuard` flag in
 * the registry would obviate this magic set — flagged as a
 * follow-up in TEMP-REVIEW-FIXES.md § 4.2.)
 */
export const SCHEMA_GUARD_EXEMPT_TOOLS: ReadonlySet<string> = new Set(["init"]);

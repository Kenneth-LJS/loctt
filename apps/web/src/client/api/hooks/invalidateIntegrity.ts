import type { QueryClient } from "@tanstack/react-query";

/**
 * DEG-31: refresh the global integrity badge after a write.
 *
 * The badge (`useIntegrity`, key `["integrity"]`) must move when a write
 * repairs or introduces corruption — a repaired field, a deleted broken
 * config entry, a synced-in corrupt task — without polling. There is no
 * central invalidator in this codebase (each mutation family lists the
 * keys it touches), so this one-liner is called at every site that already
 * invalidates `["tasks"]`, keeping the badge as fresh as the list. Kept as
 * a named helper rather than an inline `invalidateQueries` so the set of
 * write paths that refresh the badge is greppable and cannot silently drift
 * from the list's own invalidations.
 */
export function invalidateIntegrity(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["integrity"] });
}

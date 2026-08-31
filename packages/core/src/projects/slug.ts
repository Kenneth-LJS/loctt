import type { ProjectDef, ProjectsConfig } from "@loctt/contracts";

/**
 * Project slugs (K3, decisions.md A60).
 *
 * A slug is the stable user-facing handle for a project: URLs carry it
 * (`?project=web`) and the CLI and MCP accept it wherever they accept a
 * project. It is generated from the name at creation and is
 * **immutable afterwards** — renaming a project never rewrites its
 * slug, so existing URLs, bookmarks, and shared links keep resolving.
 *
 * Slugs are optional on disk: a tracker created before K3 has none.
 * Nothing else on disk stores a slug — tasks reference their project by
 * ULID (P-2) and the query DSL compares `project` against that same
 * ULID — so a slug that drifts from a renamed project costs readability
 * and nothing else.
 */

/** Matches contracts' `SlugKey`: letter-led, lowercase, digits, `-`, `_`. */
const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

/** True when `value` is a well-formed slug. */
export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

/**
 * Derives a slug candidate from a human name: lowercased, accents
 * stripped, runs of anything else collapsed to a single hyphen.
 *
 * Returns `undefined` when the name yields nothing usable — a name of
 * only punctuation or only non-Latin script has no meaningful ASCII
 * slug, and inventing one ("project-1") would be a worse handle than
 * having none. Callers fall back to the ULID, which always resolves.
 */
export function slugifyName(name: string): string | undefined {
  const ascii = name
    .normalize("NFKD")
    .toLowerCase();
  const collapsed = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (collapsed.length === 0) return undefined;
  // A slug must start with a letter (contracts' SlugKey): a leading
  // digit can collide with auto-numbered prefixes in a picker.
  const led = /^[a-z]/.test(collapsed) ? collapsed : `p-${collapsed}`;
  return isValidSlug(led) ? led : undefined;
}

/**
 * Picks a slug for a new project that no existing project already
 * holds, suffixing `-2`, `-3`, … on collision.
 *
 * `existing` is every project in the tracker, archived included: an
 * archived project still owns its slug, and reusing it would make an
 * old URL silently resolve to a different project after an unarchive.
 */
export function allocateSlug(
  existing: readonly ProjectDef[],
  name: string,
  preferred?: string,
): string | undefined {
  const base = preferred !== undefined && preferred.length > 0
    ? (isValidSlug(preferred) ? preferred : undefined)
    : slugifyName(name);
  if (base === undefined) return undefined;

  const taken = new Set(
    existing
      .map(p => p.slug)
      .filter((s): s is string => s !== undefined),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The handle to show for a project. Falls back to the ULID for a
 * pre-K3 project that has no slug on disk — callers that print this
 * are showing an addressing token, not UI content (P-4, V3).
 */
export function projectSlug(project: ProjectDef): string {
  return project.slug ?? project.id;
}

/**
 * Resolves a slug to a project. Returns `undefined` when nothing
 * matches, so the caller can distinguish "unknown slug" from "no
 * project requested" — an unresolvable slug must say so rather than
 * silently widening to all projects (K3, P4, ERR-1).
 */
export function findProjectBySlug(
  config: ProjectsConfig,
  slug: string,
): ProjectDef | undefined {
  return config.projects.find(p => p.slug === slug);
}

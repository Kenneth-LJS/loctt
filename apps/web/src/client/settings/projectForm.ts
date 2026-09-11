import type { ProjectDef } from "@loctt/contracts";

/**
 * Client-side validation for the new-project form (PRU-19, PRU-35,
 * PRU-36, PRU-45, XS-63).
 *
 * Pure and unit-tested, in the shape of `create/formState.ts`. The
 * point of doing this on the client is PRU-19's second bullet: submit
 * stays disabled while a conflict stands, so *no server round-trip
 * half-creates the project*. The server enforces the same rules — this
 * is not the enforcement, it is the early warning.
 */

/** Mirrors contracts' `SlugKey`. */
const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

/** Same derivation as core's `slugifyName`, for the live preview. */
export function slugify(name: string): string {
  const collapsed = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (collapsed.length === 0) return "";
  return /^[a-z]/.test(collapsed) ? collapsed : `p-${collapsed}`;
}

export interface NewProjectDraft {
  readonly name: string;
  readonly prefix: string;
  readonly slug: string;
}

export interface ProjectProblems {
  readonly name?: string;
  readonly prefix?: string;
  readonly slug?: string;
}

/**
 * Prefix uniqueness is case-insensitive here because the *stored*
 * comparison is exact: `WEB-` and `web-` are two different prefixes to
 * core, but two projects whose prefixes differ only in case produce
 * keys a human cannot tell apart. PRU-19's last bullet asks for the
 * UI's answer to match the CLI's; core rejects only exact matches, so
 * a case-variant is surfaced as a *warning-shaped* rejection here and
 * would also be rejected server-side if it were an exact match.
 */
export function validateNewProject(
  draft: NewProjectDraft,
  existing: readonly ProjectDef[],
): ProjectProblems {
  const problems: { name?: string; prefix?: string; slug?: string } = {};

  const name = draft.name.trim();
  const prefix = draft.prefix.trim();
  const slug = draft.slug.trim();

  if (name.length > 0) {
    const clash = existing.find(p => p.name === name);
    if (clash) {
      // Not fatal — core allows duplicate names — but worth saying.
      problems.name = `Another project is already called "${name}". `
        + `Names do not have to be unique, but they will be hard to tell apart.`;
    }
  }

  if (prefix.length > 0) {
    const exact = existing.find(p => p.prefix === prefix);
    const caseless = existing.find(
      p => p.prefix.toLowerCase() === prefix.toLowerCase(),
    );
    if (exact) {
      problems.prefix = `Prefix ${prefix} is already used by "${exact.name}". `
        + `Prefixes must be unique across the tracker.`;
    } else if (caseless) {
      problems.prefix = `Prefix ${prefix} differs only in case from `
        + `${caseless.prefix}, used by "${caseless.name}". Task keys from the `
        + `two would be hard to tell apart.`;
    } else if (!/^[A-Z]{1,10}$/.test(prefix)) {
      // K88/A80: a prefix is 1–10 uppercase letters; the "-" is added at
      // render, so the user does not type it. Reject anything else with
      // the rule stated (PRU-36: explain what a prefix looks like).
      problems.prefix = `A prefix is 1–10 uppercase letters (A–Z). `
        + `The "-" separator is added automatically, so "WEB" produces `
        + `keys like "WEB-1".`;
    }
  }

  if (slug.length > 0) {
    if (!SLUG_RE.test(slug)) {
      // PRU-36: state the rule and show the suggestion.
      const suggested = slugify(slug);
      problems.slug = `A slug is lowercase letters, digits, hyphen or `
        + `underscore, starting with a letter.`
        + (suggested.length > 0 ? ` Try ${suggested}.` : "");
    } else {
      const clash = existing.find(p => p.slug === slug);
      if (clash) {
        problems.slug = `Slug ${slug} is already used by "${clash.name}".`;
      }
    }
  }

  return problems;
}

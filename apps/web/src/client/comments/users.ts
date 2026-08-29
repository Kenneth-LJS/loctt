import type { UserProfile } from "@loctt/contracts";

import type { MentionCandidate } from "../editor/MentionMenu.tsx";
import type { MentionTarget } from "./renderMarkdown.tsx";

/**
 * The client-side join from a user ULID to something a person can read.
 *
 * `author` on a comment and `userId` on a mention are both raw ULIDs;
 * `GET /api/users` (already loaded for the sidebar) is the only mapping
 * there is. This module is that join, in one place, because the same
 * lookup falling through in two places is how LST-33 shipped a ULID
 * into UI content.
 */

/**
 * What to show for a user id that resolves to nobody.
 *
 * **Never the raw id, never blank.** LST-33 shipped the ULID for
 * exactly this case and no test could see it, because a test asserting
 * a row "appears" passes on a ULID. CMT-21 covers the situation
 * directly: a comment by a hard-deleted user still has to render, and
 * the honest thing to say is that we do not know who it was.
 *
 * The id is *not* folded into the string. A 26-character ULID inside a
 * comment header is noise to every reader, and P-4's "the user's terms"
 * is the whole point — the id belongs in a `title` attribute for the
 * one person debugging, which is where {@link authorTitle} puts it.
 */
export const UNKNOWN_AUTHOR = "Unknown user";

export interface UserIndex {
  /**
   * Function *properties*, not methods. `mention` is passed to
   * `renderCommentBody` as a bare reference, and a method torn off its
   * object is the `unbound-method` hazard — none of these touch
   * `this`, and declaring them as properties is what says so.
   */
  /** Display name for a user id, or {@link UNKNOWN_AUTHOR}. */
  readonly name: (userId: string) => string;
  /** True when the id resolved to a real profile. */
  readonly known: (userId: string) => boolean;
  /** The profile behind an id, for a mention chip. */
  readonly mention: (userId: string) => MentionTarget | undefined;
  /** Users a *new* mention may name — archived excluded (CMT-8). */
  readonly mentionable: readonly MentionCandidate[];
}

export function buildUserIndex(users: readonly UserProfile[]): UserIndex {
  const byId = new Map<string, UserProfile>();
  for (const u of users) byId.set(u.id, u);

  return {
    name: (userId: string) => byId.get(userId)?.name ?? UNKNOWN_AUTHOR,
    known: (userId: string) => byId.has(userId),
    mention: (userId: string) => {
      const u = byId.get(userId);
      if (u === undefined) return undefined;
      return { id: u.id, name: u.name, archived: u.archived === true };
    },
    /**
     * CMT-8's first two bullets. Archiving a user is the gesture that
     * says "do not offer this person for new work", so they are absent
     * from the list the picker filters — not merely ranked lower, and
     * not surfaced by typing their exact name, because the filter can
     * only match what is in this array.
     *
     * Resolving an *existing* mention is a different question and uses
     * `mention` above, which does not filter. That asymmetry is CMT-8's
     * last bullet: historical attribution never breaks.
     */
    mentionable: mentionable(users),
  };
}

/**
 * The pickable users, each with a hint that tells same-named ones
 * apart (CMT-7's third bullet).
 *
 * The hint is the **email when there is one, a truncated id otherwise**
 * — the case names both, in that order, and an email is the thing a
 * person recognises. A ULID tail is the fallback rather than the
 * default for the P-4 reason: it is our vocabulary, not the user's, and
 * it earns its place only when nothing better exists.
 *
 * Attached to every candidate rather than only to the ambiguous ones.
 * Showing the hint conditionally means the row for "Ana Lopez" changes
 * shape the moment a second Ana is added — the picker the user learned
 * is not the picker they get back.
 */
function mentionable(users: readonly UserProfile[]): readonly MentionCandidate[] {
  return users
    .filter(u => u.archived !== true)
    .map(u => ({
      id: u.id,
      name: u.name,
      hint: u.email ?? `…${u.id.slice(-6)}`,
    }));
}

/**
 * The `title` for an author label: the id, but only for a user we could
 * not name. For a known user the visible name is already the answer and
 * a tooltip repeating it is noise.
 */
export function authorTitle(index: UserIndex, userId: string): string | undefined {
  return index.known(userId) ? undefined : `Unrecognised user id: ${userId}`;
}

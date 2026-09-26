/**
 * The description editor's unsaved draft (A338, for K124).
 *
 * Since K124 nothing reaches disk until Save, so a reload or a crashed
 * tab would lose a long edit. The draft closes that gap without a
 * "keep forever" store: it lives in `sessionStorage`, which survives a
 * reload of the same tab and dies with the tab. Two tabs therefore keep
 * independent drafts, and a closed tab's draft never resurfaces.
 *
 * The draft carries the base it was written against — the token and the
 * body the edit started from — so reopening can tell "nothing moved on
 * disk" (restore silently) from "the file changed since" (show the
 * conflict dialog, never overwrite silently).
 *
 * Storage failure degrades to "no draft" through `shell/storage.ts`.
 */

import { readSession, removeSession, writeSession } from "../shell/storage.ts";

export interface BodyDraft {
  /** The text in the editor when the draft was written. */
  readonly text: string;
  /** The body token the edit was based on (K2). */
  readonly baseToken: string;
  /** The body the edit was based on — the text `baseToken` refers to. */
  readonly baseBody: string;
}

/** A338's key shape. `field` is "body" for the description. */
export function draftKey(taskId: string, field = "body"): string {
  return `loctt:draft:${taskId}:${field}`;
}

export function readBodyDraft(taskId: string): BodyDraft | null {
  const raw = readSession(draftKey(taskId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof BodyDraft, unknown>>;
    if (
      typeof parsed.text === "string"
      && typeof parsed.baseToken === "string"
      && typeof parsed.baseBody === "string"
    ) {
      return { text: parsed.text, baseToken: parsed.baseToken, baseBody: parsed.baseBody };
    }
  } catch {
    // Unparseable: treated as no draft, and dropped below.
  }
  // A malformed entry is not something the user can act on; drop it so
  // it does not linger for the life of the tab.
  removeSession(draftKey(taskId));
  return null;
}

export function writeBodyDraft(taskId: string, draft: BodyDraft): void {
  writeSession(draftKey(taskId), JSON.stringify(draft));
}

export function clearBodyDraft(taskId: string): void {
  removeSession(draftKey(taskId));
}

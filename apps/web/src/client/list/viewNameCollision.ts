import type { SavedQuery } from "@loctt/contracts";

import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";

/**
 * VUE-20: a saved view whose name collides with an existing one must be
 * flagged *before* writing.
 *
 * Measured behaviour this guards (fresh tracker, `POST /api/views`
 * twice with name "overdue"): both succeed with 201 and `queries.yaml`
 * ends up holding two entries called `overdue`. The ids stay distinct,
 * so nothing is lost — but `loctt list --view overdue` then throws
 * `multiple views named 'overdue'; refer by id instead`, which is a
 * failure the user only discovers later, from the CLI. Core resolves
 * by name and cannot warn at create time without refusing the write,
 * so the warning belongs here, ahead of the request.
 *
 * Built-in *filters* are checked too: the sidebar shows them beside
 * saved views, so shadowing one silently is the same confusion.
 */

export type NameCollision =
  | { readonly kind: "none" }
  | { readonly kind: "saved"; readonly existingId: string; readonly message: string }
  | { readonly kind: "builtin"; readonly message: string };

/** Names compare case-insensitively after trimming, the way a user reads them. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function checkViewNameCollision(
  name: string,
  existing: readonly SavedQuery[],
): NameCollision {
  const wanted = norm(name);
  if (wanted === "") return { kind: "none" };

  const clash = existing.find(v => norm(v.name) === wanted);
  if (clash !== undefined) {
    return {
      kind: "saved",
      existingId: clash.id,
      // States how the ambiguity will resolve, per the case's second
      // bullet — the user is told the consequence, not just "taken".
      message:
        `A saved view named “${clash.name}” already exists. Saving another with `
        + `the same name keeps both (their ids stay distinct), but `
        + `\`loctt list --view ${clash.name}\` will refuse to pick between them `
        + `and ask you to refer to one by id.`,
    };
  }

  const builtin = BUILTIN_FILTERS.find(b => norm(b.label) === wanted);
  if (builtin !== undefined) {
    return {
      kind: "builtin",
      message:
        `“${builtin.label}” is also a built-in filter. Saving this name will show `
        + `two entries with the same label in the sidebar; the built-in is not replaced.`,
    };
  }

  return { kind: "none" };
}

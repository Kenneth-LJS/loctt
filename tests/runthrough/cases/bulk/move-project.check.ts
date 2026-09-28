/**
 * check_script for move-project: after a move, no key is claimed twice —
 * every current key is unique, and no current key is also another task's
 * retired key (which would make the retired key ambiguous, G1).
 */

import { asStringArray, type TrackerView } from "../../lib/tracker.ts";

export default function check(tracker: TrackerView): void {
  const owners = new Map<string, string[]>();
  for (const t of tracker.tasks()) {
    for (const key of [t.key, ...asStringArray(t.frontmatter["key_history"])]) {
      owners.set(key, [...(owners.get(key) ?? []), t.id]);
    }
  }
  const clashes = [...owners].filter(([, ids]) => ids.length > 1);
  if (clashes.length > 0) {
    throw new Error(`keys held by more than one task: ${JSON.stringify(clashes)}`);
  }
}

import type { SavedQuery } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { checkViewNameCollision } from "./viewNameCollision.ts";

/** VUE-20: a colliding view name is flagged before the write. */

const view = (id: string, name: string): SavedQuery =>
  ({ id, name, filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }] });

const EXISTING = [view("v1", "overdue"), view("v2", "My bugs")];

describe("saved-view name collisions", () => {
  // @verifies VUE-20
  it("warns when the name matches an existing saved view, and says how --view resolves", () => {
    const r = checkViewNameCollision("overdue", EXISTING);
    expect(r.kind).toBe("saved");
    if (r.kind !== "saved") return;
    expect(r.existingId).toBe("v1");
    // The case requires stating how `loctt list --view overdue` will
    // resolve the ambiguity — not merely that the name is taken.
    expect(r.message).toContain("loctt list --view overdue");
    expect(r.message).toMatch(/id/i);
  });

  // @verifies VUE-20
  it("matches the way a user reads a name, not byte-for-byte", () => {
    // "Overdue " and "overdue" are the same name to a reader; treating
    // them as distinct writes the collision the warning exists to stop.
    expect(checkViewNameCollision("  Overdue ", EXISTING).kind).toBe("saved");
  });

  // @verifies VUE-20
  it("flags a collision with a built-in filter rather than shadowing it silently", () => {
    const r = checkViewNameCollision("High priority", EXISTING);
    expect(r.kind).toBe("builtin");
    if (r.kind !== "builtin") return;
    expect(r.message).toContain("built-in");
  });

  // @verifies VUE-20
  it("does not warn for a free name", () => {
    // POSITIVE CONTROL for the assertions above: the checker is
    // capable of returning "none", so a "saved"/"builtin" verdict is
    // a real finding rather than a function that always warns.
    expect(checkViewNameCollision("Something else entirely", EXISTING).kind).toBe("none");
    expect(checkViewNameCollision("", EXISTING).kind).toBe("none");
  });
});

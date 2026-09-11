import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { UsageError } from "./errors.js";
import { assertWorkflowRelationshipKey } from "./workflow-assert.js";

/**
 * The CLI's relationship-type pre-flight must accept exactly what core's
 * `linkTask` accepts — both the forward key AND the inverse key of a
 * directional relationship. A single `blocks` definition (with
 * `inverse: blocked_by`) makes `blocked_by` a valid link type in core
 * and the web route; if this boundary guard only knows forward keys it
 * rejects `loctt link A blocked_by B` with a bogus "unknown relationship"
 * even though the operation itself would succeed.
 */
describe("assertWorkflowRelationshipKey", () => {
  const workflow: WorkflowConfig = {
    key: { prefix: "T" },
    statuses: [],
    priorities: [],
    task_types: [],
    relationships: [
      // Only the forward definition is listed. `blocked_by` exists
      // solely as this rel's inverse — never as a `key` of its own.
      { key: "blocks", label: "Blocks", inverse: "blocked_by", inverse_label: "Blocked by" },
      { key: "related_to", label: "Related to", kind: "symmetric" },
    ],
    custom_fields: [],
  };

  it("accepts the forward key", () => {
    expect(() => assertWorkflowRelationshipKey(workflow, "blocks")).not.toThrow();
  });

  it("accepts the inverse key of a directional relationship", () => {
    // The regression: rejected before the flatMap(relationshipTypeKeys) fix.
    expect(() => assertWorkflowRelationshipKey(workflow, "blocked_by")).not.toThrow();
  });

  it("accepts a symmetric relationship's single key", () => {
    expect(() => assertWorkflowRelationshipKey(workflow, "related_to")).not.toThrow();
  });

  it("rejects a genuinely unknown type and lists both directions as known", () => {
    let caught: unknown;
    try {
      assertWorkflowRelationshipKey(workflow, "nonsense");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UsageError);
    const msg = (caught as Error).message;
    expect(msg).toContain("unknown relationship 'nonsense'");
    // The "Known" hint must advertise the inverse the fix now accepts.
    expect(msg).toContain("blocked_by");
  });

  it("is a no-op when no workflow config is loaded", () => {
    expect(() => assertWorkflowRelationshipKey(undefined, "anything")).not.toThrow();
  });
});

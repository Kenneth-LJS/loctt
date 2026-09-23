/**
 * The label resolver and the failure reducer (ERR-43, ERR-4, XS-57).
 *
 * These are unit tests rather than browser ones because the behaviour
 * is a string transform and a branch on an envelope — driving a real
 * server to produce each envelope shape would test the server's
 * ability to produce them, which `server.errors.test.ts` already
 * covers. What is untested anywhere else is what this module does with
 * one once it has it.
 *
 * The browser half — that the resolved message actually reaches the
 * screen, at the right control, with the right control beside it — is
 * in `tests/ui/flow-task-failure.spec.ts`. Neither is sufficient
 * alone: this file would pass with the component never rendering, and
 * the UI spec cannot easily produce a timed-out write.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client.ts";
import {
  buildLabelIndex,
  markUnknownValues,
  resolveLabels,
  toFieldFailure,
} from "./fieldFailure.ts";

/**
 * A config sharing nothing with the shipped default, for the same
 * reason `flow-task-meta.spec.ts` uses one: against `in_progress` /
 * "In Progress" a resolver that did nothing at all would be hard to
 * distinguish from one that worked.
 */
const INDEX = buildLabelIndex({
  statuses: [
    { key: "triage", label: "Triaging" },
    { key: "in_review", label: "In review" },
    { key: "shipped", label: "Shipped" },
  ],
  priorities: [{ key: "p0_now", label: "Drop everything" }],
  users: [{ id: "01M15ZCHKHK534CBPCQS5FQ30S", name: "Ada Byron" }],
  milestones: [{ id: "01MMILESTONE0000000000000A", name: "Q3 launch" }],
});

describe("resolveLabels", () => {
  // @verifies ERR-43
  it("shows the configured label rather than the stored key", () => {
    const out = resolveLabels(
      'invalid value: status: unknown status "in_review"; valid: triage, in_review, shipped',
      INDEX,
    );
    // Both halves: the offending value and the list of options.
    expect(out).toContain('"In review"');
    expect(out).toContain("valid: Triaging, In review, Shipped");
    // And the keys are gone — a resolver that appended the label
    // beside the key would satisfy the two assertions above while
    // still showing the user `in_review`.
    expect(out).not.toContain("in_review");
    expect(out).not.toContain("triage");
    expect(out).not.toContain("shipped");
  });

  // @verifies ERR-43
  // @verifies TSK-46
  it("resolves a ULID to the name the user knows", () => {
    const out = resolveLabels(
      'cannot assign archived user "01M15ZCHKHK534CBPCQS5FQ30S" to assignee; unarchive it first',
      INDEX,
    );
    expect(out).toContain('"Ada Byron"');
    expect(out).not.toContain("01M15ZCHKHK534CBPCQS5FQ30S");
  });

  // @verifies ERR-43
  it("leaves a token the config does not declare exactly as it stands", () => {
    // ERR-43's stated exception. Inventing a label here would be worse
    // than showing the key: it would name something that does not
    // exist.
    const out = resolveLabels('unknown status "gone_from_config"', INDEX);
    expect(out).toBe('unknown status "gone_from_config"');
  });

  // @verifies ERR-43
  it("does not rewrite the same word outside quotes", () => {
    // A resolver matching bare words would turn this sentence into
    // nonsense — and it is the shape a naive implementation takes.
    const out = resolveLabels("the shipped write was in_review of nothing", INDEX);
    expect(out).toBe("the shipped write was in_review of nothing");
  });

  // @verifies ERR-43
  it("resolves the recognised half of a partly-orphaned valid list", () => {
    const out = resolveLabels("valid: triage, mystery, shipped", INDEX);
    expect(out).toBe("valid: Triaging, mystery, Shipped");
  });
});

describe("markUnknownValues", () => {
  // @verifies ERR-43
  // @verifies TSK-29
  it("marks an undeclared value as unrecognized rather than as a label", () => {
    const out = markUnknownValues('unknown status "gone_from_config"', INDEX);
    expect(out).toContain("unrecognized value");
    // Positive half: the raw key is still shown, because it is the
    // only thing that identifies which value to repair.
    expect(out).toContain("gone_from_config");
  });

  // @verifies ERR-43
  it("does not mark a value the config does declare", () => {
    const out = markUnknownValues('unknown status "in_review"', INDEX);
    expect(out).toBe('unknown status "in_review"');
  });
});

/** An `ApiError` carrying the envelope the server actually sends. */
function rejected(envelope: Record<string, unknown>, status = 400): ApiError {
  return new ApiError(String(envelope["message"]), {
    status,
    body: envelope,
    endpoint: "/api/tasks/T-12/set",
    envelope: envelope as never,
  });
}

describe("toFieldFailure", () => {
  // @verifies ERR-3
  // @verifies TSK-47
  it("carries the not-saved claim and keeps the write for retry", () => {
    const f = toFieldFailure(
      rejected({
        code: "validation_failed",
        message: 'invalid value: status: unknown status "nope"',
        field: "status",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      }),
      { field: "status", value: "nope" },
      INDEX,
      "T-12",
    );
    expect(f.dataState).toBe("not_saved");
    expect(f.field).toBe("status");
    // The retry re-sends *this* write, not whatever the panel holds
    // after the rollback (ERR-3's fourth bullet).
    expect(f.retry).toEqual({ field: "status", value: "nope" });
  });

  // @verifies ERR-4
  it("does not offer to re-send a write whose outcome is unknown", () => {
    const f = toFieldFailure(
      rejected(
        {
          code: "unknown",
          message: "the server did not respond, so LocTT cannot tell whether this was saved",
          data_state: "unknown",
          recovery: { kind: "reload" },
        },
        0,
      ),
      { field: "priority", value: "p0_now" },
      INDEX,
      "T-12",
    );
    expect(f.dataState).toBe("unknown");
    // Not "not_saved" — the two are different claims, and asserting
    // either one here would be a guess (ERR-4's first bullet).
    expect(f.dataState).not.toBe("not_saved");
    // Auto-retrying a non-idempotent write could double-apply.
    expect(f.retry).toBeUndefined();
    expect(f.recovery?.kind).toBe("reload");
  });

  // @verifies XS-57
  it("names the key, blames another process, and does not offer retry", () => {
    const f = toFieldFailure(
      rejected(
        {
          code: "not_found",
          message: 'task not found: "01M15ZCHCK617ZZSWNR38CHNE8"',
          data_state: "not_saved",
          recovery: { kind: "reload" },
        },
        404,
      ),
      { field: "priority", value: "p0_now" },
      INDEX,
      "T-12",
    );
    expect(f.message).toContain("T-12");
    // Not by ULID — core's own sentence carried one, and passing it
    // through would fail the case's first bullet.
    expect(f.message).not.toContain("01M15ZCHCK617ZZSWNR38CHNE8");
    expect(f.message).toContain("deleted by another process");
    // Distinguishable from a transport failure, which is the third
    // bullet's whole point.
    expect(f.message).not.toContain("not responding");
    expect(f.retry).toBeUndefined();
    expect(f.recovery?.kind).toBe("none");
  });

  // @verifies ERR-3
  it("names a stopped server as unreachable and not as a missing task", () => {
    // A transport failure never becomes an `ApiError`, so it has no
    // envelope. Reporting it as `not_found` is the conflation XS-57's
    // third bullet forbids from the other direction.
    const f = toFieldFailure(
      new TypeError("Failed to fetch"),
      { field: "status", value: "shipped" },
      INDEX,
      "T-12",
    );
    expect(f.message).toContain("not responding");
    expect(f.message).not.toContain("no longer exists");
    // Nothing left the machine, so the not-saved claim is safe here in
    // a way it would not be for a timeout.
    expect(f.dataState).toBe("not_saved");
    expect(f.retry).toEqual({ field: "status", value: "shipped" });
  });

  // @verifies TSK-46
  // @verifies ERR-43
  it("renders an archived-user rejection with the name, not the id", () => {
    const f = toFieldFailure(
      rejected({
        code: "archived_reference",
        message:
          'cannot assign archived user "01M15ZCHKHK534CBPCQS5FQ30S" to assignee; unarchive it first',
        field: "assignee",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      }),
      { field: "assignee", value: "01M15ZCHKHK534CBPCQS5FQ30S" },
      INDEX,
      "T-12",
    );
    expect(f.field).toBe("assignee");
    expect(f.message).toContain("Ada Byron");
    expect(f.message).toContain("archived");
    expect(f.message).not.toContain("01M15ZCHKHK534CBPCQS5FQ30S");
    expect(f.dataState).toBe("not_saved");
  });

  /**
   * XS-48: a write refused because a schema migration holds the lock.
   * The server side of this envelope (409, `schema_mismatch`,
   * `data_state: "not_saved"`, a message naming the migration and
   * telling the user to wait, `recovery.kind: "retry"`) is proven end
   * to end in `apps/web/src/server/server.migration-lock.test.ts`
   * (`@verifies TSK-56`). What that test cannot show is what the panel
   * does with the envelope once it has it — this is the missing half.
   */
  // @verifies XS-48
  it("names the migration as the cause, confirms nothing was saved, and offers retry — never force/bypass", () => {
    const f = toFieldFailure(
      rejected({
        code: "schema_mismatch",
        message: "A schema migration is in progress on this tracker. Wait for it to finish and try again.",
        field: "status",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      }, 409),
      { field: "status", value: "in_progress" },
      INDEX,
      "T-12",
    );
    expect(f.field).toBe("status");
    expect(f.message).toMatch(/migration is in progress/i);
    expect(f.message).toMatch(/wait/i);
    expect(f.dataState).toBe("not_saved");
    // Retry is offered as A control...
    expect(f.recovery?.kind).toBe("retry");
    // ...and the write is kept so Retry can re-send exactly it — this is
    // the ONLY recovery ever offered for this cause (never force/bypass,
    // which isn't a `recovery.kind` this module or the server produce).
    expect(f.retry).toEqual({ field: "status", value: "in_progress" });
  });
});

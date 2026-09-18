import { describe, expect, it } from "vitest";

import { ArchivedReferenceError } from "./config/archived-guard.js";
import { errorEnvelope, LocttError } from "./errors.js";
import { ParseError } from "./query/parser.js";
import { TokenizeError } from "./query/tokenizer.js";
import { QueryValidationError } from "./query/validate.js";
import { TaskNotFoundError } from "./task/lookup.js";
import { TaskUpdateError } from "./task/update.js";

/**
 * V1: core states its own cause, so a surface reports it rather than
 * guessing.
 *
 * What this replaces: `apps/web` inferred the code from the HTTP status
 * (`codeForStatus`, `server.ts:286`). An archived-reference rejection
 * arrives as a 400 and became `validation_failed` — indistinguishable
 * from a bad enum value, though the recoveries are opposite: unarchive
 * the entity, versus pick a valid value.
 */

describe("core errors carry the cause, not just a message", () => {
  it("an archived reference is not a generic validation failure", () => {
    const err = new ArchivedReferenceError("cannot assign archived milestone");
    // The distinction the status-based guess could not make.
    expect(err.code).toBe("archived_reference");
    expect(new TaskUpdateError("bad value").code).toBe("validation_failed");
  });

  it("a write-path error says the change did not land", () => {
    // ERR-18 requires the claim on every write failure; ERR-3 calls it
    // the single most important error behaviour in the app.
    expect(new TaskUpdateError("bad value").dataState).toBe("not_saved");
    expect(new ArchivedReferenceError("archived").dataState).toBe("not_saved");
  });

  it("a read-path error makes no claim about the data", () => {
    // Nothing was attempted, so asserting "not saved" would be a claim
    // about a write that never happened.
    expect(new TaskNotFoundError("T-9").dataState).toBeUndefined();
    expect(new TaskNotFoundError("T-9").code).toBe("not_found");
  });

  it("keeps the ref as the user typed it, never a ULID", () => {
    // ERR-16 bars raw ULIDs from user-facing copy.
    expect(new TaskNotFoundError("T-9").message).toContain("T-9");
  });

  it("existing catch sites still work, so the migration is compatible", () => {
    // Every class kept its name and extends the base, so `instanceof`
    // checks across the three surfaces are unaffected.
    const err = new TaskUpdateError("x");
    expect(err).toBeInstanceOf(TaskUpdateError);
    expect(err).toBeInstanceOf(LocttError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TaskUpdateError");
  });
});

describe("the envelope a surface serialises", () => {
  it("omits fields that were never set, rather than nulling them", () => {
    // An absent `data_state` and a null one are different claims; a
    // client cannot tell them apart once both are present as keys.
    const envelope = new TaskNotFoundError("T-9").toEnvelope();
    expect(envelope).toEqual({ code: "not_found", message: 'task not found: "T-9"' });
  });

  it("carries the field so the UI can render at the input", () => {
    // ERR-14: a field-level rejection renders at the field. The UI
    // derives that from `field` being present — the inference belongs
    // to the surface, which is why the shape describes the error rather
    // than naming a presentation (V8).
    const err = new TaskUpdateError("bad status", { field: "status" });
    expect(err.toEnvelope().field).toBe("status");
  });

  it("keeps technical detail out of the headline", () => {
    // ERR-16 allows it behind a details affordance, never in the first
    // sentence.
    const err = new TaskUpdateError("The status is not recognised.", {
      detail: "ZodError: invalid_enum_value at statuses[2].key",
    });
    const envelope = err.toEnvelope();
    expect(envelope.message).not.toContain("ZodError");
    expect(envelope.detail).toContain("ZodError");
  });
});

describe("a mistyped query is a known cause, not an unknown one", () => {
  it("carries validation_failed rather than falling through to unknown", () => {
    // These three extended bare `Error`, so a typo'd query reached the
    // UI as `unknown` — the generic handler ERR-31 reserves for causes
    // that genuinely cannot be determined. The position and the
    // suggestions are right there in the error.
    expect(errorEnvelope(new TokenizeError("unexpected character", 4)).code)
      .toBe("validation_failed");
    expect(errorEnvelope(new ParseError("expected a value", 9)).code)
      .toBe("validation_failed");
    expect(errorEnvelope(new QueryValidationError("unknown field", 0, ["status"])).code)
      .toBe("validation_failed");
  });

  it("names the query as the field, so the UI renders at the input", () => {
    // ERR-14: the rejection belongs at the query box, not in a toast.
    expect(errorEnvelope(new ParseError("expected a value", 9)).field).toBe("query");
  });

  it("keeps the position and suggestions the message already carried", () => {
    const err = new QueryValidationError("unknown field", 0, ["status"]);
    expect(err.position).toBe(0);
    expect(err.suggestions).toEqual(["status"]);
    // The hint survives the migration — it is the most useful part.
    expect(err.message).toMatch(/did you mean "status"/);
  });
});

describe("an error core did not attribute", () => {
  it("says the cause is unknown rather than inventing one", () => {
    // ERR-30 permits `unknown` only here, and ERR-31 forbids reaching
    // for it to avoid enumerating a cause that is actually known.
    const envelope = errorEnvelope(new Error("something odd"));
    expect(envelope.code).toBe("unknown");
  });

  it("still answers the three questions ERR-30 requires", () => {
    // "Something went wrong." with none of these is a failing result
    // for that case, however genuinely unknown the cause was.
    const envelope = errorEnvelope(new Error("something odd"));
    expect(envelope.data_state).toBe("unknown");
    expect(envelope.recovery).toEqual({ kind: "retry" });
    expect(envelope.message.length).toBeGreaterThan(0);
  });

  it("puts the raw message in detail, not in the headline", () => {
    const envelope = errorEnvelope(new Error("TypeError: undefined is not a function"));
    expect(envelope.message).not.toContain("TypeError");
    expect(envelope.detail).toContain("TypeError");
  });

  it("does not claim unknown for an error core did attribute", () => {
    // The whole point: a known cause must not be laundered into
    // `unknown` on its way out (ERR-31).
    expect(errorEnvelope(new ArchivedReferenceError("x")).code).toBe("archived_reference");
  });
});

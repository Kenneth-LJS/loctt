import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client.ts";
import { describeFailure } from "./CreateTaskModal.tsx";

/**
 * A348: a create that timed out may have landed. The copy used to be
 * "Couldn't create the task: the server did not respond, so LocTT
 * cannot tell whether this was saved", which asserts a failure and then
 * says the outcome is unknown. K127's wording replaces it.
 */
describe("describeFailure: a timed-out create", () => {
  const timeout = new ApiError("/api/tasks did not respond", {
    status: 0,
    body: undefined,
    endpoint: "/api/tasks",
    isTimeout: true,
    envelope: {
      code: "unknown",
      message: "the server did not respond, so LocTT cannot tell whether this was saved",
      data_state: "unknown",
      recovery: { kind: "reload" },
    },
  });

  it("says the task may not have been created and to check the list first (K134)", () => {
    expect(describeFailure(timeout, 0)).toEqual({
      message: "The task may not have been created. Check the list before trying again.",
    });
  });

  it("keeps the NEW-39 count of tasks already created", () => {
    expect(describeFailure(timeout, 2)).toEqual({
      message: "2 tasks already created. The task may not have been created. Check the list before trying again.",
    });
  });

  // NEW-32: a server that answered with an unattributed 500 carries
  // `data_state: "unknown"` too, but it did answer, and its reason is
  // quoted as reported. Only the client's own deadline is a timeout.
  it("quotes an answered 500 verbatim even when its data_state is unknown", () => {
    const fault = new ApiError("x", {
      status: 500,
      body: undefined,
      endpoint: "/api/tasks",
      envelope: {
        code: "unknown",
        message: "The server failed while handling POST /api/tasks.",
        data_state: "unknown",
        recovery: { kind: "reload" },
      },
    });
    expect(describeFailure(fault, 0)).toEqual({
      message: "Couldn't create the task: The server failed while handling POST /api/tasks.",
    });
  });

  it("still quotes a server refusal verbatim", () => {
    const refused = new ApiError("bad", {
      status: 400,
      body: undefined,
      endpoint: "/api/tasks",
      envelope: { code: "validation_failed", message: "Title is required.", data_state: "not_saved" },
    });
    expect(describeFailure(refused, 0)).toEqual({
      message: "Couldn't create the task: Title is required.",
    });
  });
});

import type { ProjectDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { resolveProjectChoice } from "./projectChoice.ts";

/**
 * NEW-14 through NEW-20 — how the project field opens.
 *
 * The precedence itself (explicit > user default > workspace default >
 * sole project) is core's `resolveProjectIdForUser`, and the server
 * reports its answer as `effective_default`. Measured against a real
 * tracker while building this:
 *
 *   one project + a `default:` line -> effective_default = that id
 *   three projects, no default at
 *   any level                       -> effective_default = null, and
 *                                      POST /api/tasks with no project
 *                                      returns 400 field="project"
 *
 * So these cases fix what the *client* does with that answer, which is
 * the part that can go wrong here: pre-fill it, show it read-only, or
 * ask. Re-deriving the order client-side is the thing the module
 * deliberately does not do.
 */
const web: ProjectDef = { id: "id-web", name: "Web", prefix: "WEB-" };
const backend: ProjectDef = { id: "id-be", name: "Backend", prefix: "BE-" };
const archived: ProjectDef = { id: "id-old", name: "Old", prefix: "OLD-", archived: true };

describe("resolveProjectChoice", () => {
  it("pre-fills whatever the server resolved (NEW-15)", () => {
    // The per-user default beating the workspace default is core's
    // decision; the client's job is to not second-guess it.
    expect(resolveProjectChoice([web, backend], "id-web"))
      .toEqual({ kind: "prefilled", id: "id-web" });
    expect(resolveProjectChoice([web, backend], "id-be"))
      .toEqual({ kind: "prefilled", id: "id-be" });
  });

  it("asks when the server resolved nothing and several projects exist (NEW-19)", () => {
    // The failure this guards against is picking "the first one".
    const choice = resolveProjectChoice([web, backend], null);
    expect(choice).toEqual({ kind: "ask" });
    expect(choice).not.toMatchObject({ id: "id-web" });
  });

  it("auto-selects a sole project with no default anywhere (NEW-18)", () => {
    // Not ambiguous, so asking would be busywork — but it must still
    // be *shown*, which is the `sole` kind rather than a silent omit.
    expect(resolveProjectChoice([web], null)).toEqual({ kind: "sole", id: "id-web" });
  });

  it("treats a sole project as sole even when it is also the default", () => {
    expect(resolveProjectChoice([web], "id-web")).toEqual({ kind: "sole", id: "id-web" });
  });

  it("falls through silently when the resolved id is not a live project (NEW-16)", () => {
    // A user default pointing at a hard-deleted project. NEW-16's
    // second bullet is explicit that this must NOT error here — it
    // falls through, and `loctt doctor` is where the dangling
    // preference gets reported.
    const choice = resolveProjectChoice([web, backend], "id-deleted");
    expect(choice).toEqual({ kind: "ask" });
  });

  it("falls through to a sole survivor rather than asking (NEW-16)", () => {
    expect(resolveProjectChoice([web], "id-deleted")).toEqual({ kind: "sole", id: "id-web" });
  });

  it("never pre-selects an archived project (NEW-17)", () => {
    // Creating into an archived project is not possible from the modal
    // at all, so it cannot be the pre-fill either.
    expect(resolveProjectChoice([web, archived], "id-old"))
      .toEqual({ kind: "sole", id: "id-web" });
  });

  it("ignores archived projects when counting for the sole-project rule", () => {
    // Two entries, one archived — that is one *selectable* project, so
    // it is `sole` and not `ask`. Counting raw entries would ask the
    // user to choose between one real option and one they cannot pick.
    expect(resolveProjectChoice([web, archived], null))
      .toEqual({ kind: "sole", id: "id-web" });
  });

  it("asks when every project is archived", () => {
    // There is no valid destination. Asking is wrong-ish but honest;
    // silently pre-filling an archived project would be worse, and the
    // server would reject it anyway.
    expect(resolveProjectChoice([archived], null)).toEqual({ kind: "ask" });
  });

  it("treats an undefined effective_default like a null one", () => {
    // An older server, or a response that omitted the field. It must
    // not be read as "a project whose id is undefined".
    expect(resolveProjectChoice([web, backend], undefined)).toEqual({ kind: "ask" });
  });
});

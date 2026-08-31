import { describe, expect, it } from "vitest";

import {
  afterCreateAnother,
  dateRangeProblem,
  emptyForm,
  hasUserContent,
  toCreateRequest,
} from "./formState.ts";

/**
 * NEW-11, NEW-23, NEW-26 and NEW-27's proportionality rule, tested as
 * pure functions.
 *
 * The "Create another" rule is the one worth isolating. Asserting it
 * through the DOM is easy to do vacuously — a form that *looks* empty
 * passes a screen-level check while still holding a stale assignee in
 * state and posting it with the next task. NEW-11's fourth bullet is
 * explicit that the cleared fields must be **absent from the second
 * task's frontmatter**, so the assertion that matters is on the
 * request body, which is what this file checks.
 */
describe("afterCreateAnother", () => {
  const filled = emptyForm({
    project: "proj-1",
    task_type: "bug",
    title: "First task",
    status: "in_progress",
    priority: "high",
    assignee: "user-1",
    reporter: "user-2",
    sprint: "sprint-1",
    milestone: "ms-1",
    labels: ["lbl-1", "lbl-2"],
    start_date: "2026-04-01",
    due_date: "2026-04-09",
    body: "some notes",
    fields: { points: 3 },
  });

  it("preserves exactly project and type", () => {
    const next = afterCreateAnother(filled);
    expect(next.project).toBe("proj-1");
    expect(next.task_type).toBe("bug");
  });

  it("clears the title so the next one can be typed straight away", () => {
    expect(afterCreateAnother(filled).title).toBe("");
  });

  it("clears every field that would otherwise leak into the next task", () => {
    const next = afterCreateAnother(filled);
    // Named individually rather than compared to `emptyForm()` in one
    // shot: a single deep-equal would go red for any reason at all and
    // would not say which field leaked.
    expect(next.priority).toBeUndefined();
    expect(next.assignee).toBeUndefined();
    expect(next.reporter).toBeUndefined();
    expect(next.sprint).toBeUndefined();
    expect(next.milestone).toBeUndefined();
    expect(next.status).toBeUndefined();
    expect(next.start_date).toBeUndefined();
    expect(next.due_date).toBeUndefined();
    expect(next.labels).toEqual([]);
    expect(next.body).toBe("");
    expect(next.fields).toEqual({});
  });

  it("leaves the cleared fields ABSENT from the next request, not empty", () => {
    // NEW-11's fourth bullet. `assignee: ""` would satisfy "the form
    // looks empty" and still write a key to frontmatter.
    const req = toCreateRequest({ ...afterCreateAnother(filled), title: "Second task" });
    expect(req.title).toBe("Second task");
    expect(req.project).toBe("proj-1");
    expect(req.task_type).toBe("bug");
    expect("assignee" in req).toBe(false);
    expect("priority" in req).toBe(false);
    expect("labels" in req).toBe(false);
    expect("due_date" in req).toBe(false);
    expect("start_date" in req).toBe(false);
    expect("milestone" in req).toBe(false);
    expect("sprint" in req).toBe(false);
    expect("body" in req).toBe(false);
    expect("fields" in req).toBe(false);
  });
});

describe("toCreateRequest", () => {
  it("trims the title, so the trimmed form is what gets stored", () => {
    // NEW-23's third bullet.
    expect(toCreateRequest(emptyForm({ title: "  Real title  " })).title).toBe("Real title");
  });

  it("omits an untouched field so it takes the workflow default", () => {
    // NEW-2: other fields take their workflow defaults rather than
    // blank values that fail validation later.
    const req = toCreateRequest(emptyForm({ title: "Only a title" }));
    expect("status" in req).toBe(false);
    expect("priority" in req).toBe(false);
    expect("task_type" in req).toBe(false);
  });

  it("sends all 25 labels when 25 are selected", () => {
    // NEW-24's third bullet: layout is one thing, but all of them have
    // to actually land on the task.
    const labels = Array.from({ length: 25 }, (_u, i) => `lbl-${String(i)}`);
    const req = toCreateRequest(emptyForm({ title: "Many", labels }));
    expect(req.labels).toHaveLength(25);
    expect(req.labels).toEqual(labels);
  });

  it("keeps a body of only whitespace out of the request", () => {
    // NEW-9's third bullet: an empty body, not a placeholder paragraph.
    expect("body" in toCreateRequest(emptyForm({ title: "T", body: "   \n  " }))).toBe(false);
  });
});

describe("dateRangeProblem", () => {
  it("flags a due date before the start date", () => {
    // NEW-26's own dates.
    const problem = dateRangeProblem("2026-04-10", "2026-04-02");
    expect(problem).toBeDefined();
    expect(problem).toContain("2026-04-02");
    expect(problem).toContain("2026-04-10");
  });

  it("accepts a due date equal to the start date", () => {
    // A one-day task is not an inverted range.
    expect(dateRangeProblem("2026-04-10", "2026-04-10")).toBeUndefined();
  });

  it("accepts a correctly ordered range", () => {
    expect(dateRangeProblem("2026-04-01", "2026-04-30")).toBeUndefined();
  });

  it("says nothing when either date is unset", () => {
    // NEW-8's fourth bullet: both fields are optional.
    expect(dateRangeProblem(undefined, "2026-04-02")).toBeUndefined();
    expect(dateRangeProblem("2026-04-10", undefined)).toBeUndefined();
    expect(dateRangeProblem(undefined, undefined)).toBeUndefined();
  });

  it("compares across a year boundary", () => {
    // The string comparison this relies on only works because the
    // format is zero-padded and big-endian. A test that only ever
    // compared days within one month would pass for a `parseInt` on
    // the day component too.
    expect(dateRangeProblem("2026-12-31", "2027-01-01")).toBeUndefined();
    expect(dateRangeProblem("2027-01-01", "2026-12-31")).toBeDefined();
  });
});

describe("hasUserContent", () => {
  const initial = emptyForm({ project: "proj-1", status: "backlog", reporter: "me" });

  it("is false for a modal the user has not touched", () => {
    // NEW-27's third bullet: an untouched modal closes with no prompt.
    // The pre-filled project, status and reporter are the app's doing,
    // not the user's, and prompting over them would make the
    // confirmation meaningless through familiarity.
    expect(hasUserContent(initial, initial)).toBe(false);
  });

  it("is true once a title is typed", () => {
    expect(hasUserContent({ ...initial, title: "Something" }, initial)).toBe(true);
  });

  it("is true once a body is typed", () => {
    expect(hasUserContent({ ...initial, body: "notes" }, initial)).toBe(true);
  });

  it("is true once a picker is changed away from its pre-fill", () => {
    expect(hasUserContent({ ...initial, priority: "high" }, initial)).toBe(true);
  });

  it("is false for a whitespace-only title", () => {
    // Consistent with NEW-23 treating whitespace as empty: three
    // spaces are not work worth a confirmation prompt.
    expect(hasUserContent({ ...initial, title: "   " }, initial)).toBe(false);
  });
});

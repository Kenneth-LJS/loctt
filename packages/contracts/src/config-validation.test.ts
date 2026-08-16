import { describe, expect, it } from "vitest";

import { CalendarConfigSchema } from "./calendar.js";
import { ProjectsConfigSchema } from "./projects.js";
import { CustomFieldDefSchema } from "./workflow.js";

/**
 * Audit group E: input that should be rejected was accepted.
 *
 * Each of these parsed cleanly and produced a config the rest of the
 * codebase cannot act on coherently — the failure surfaces later, far
 * from the edit that caused it, which is what makes them worth catching
 * at the schema boundary.
 */

const ID_A = "01JBQZ4X8N0000000000000001";
const ID_B = "01JBQZ4X8N0000000000000002";

describe("custom field enum values", () => {
  const base = { key: "severity", label: "Severity", type: "enum" as const, multi: false, searchable: false };

  it("accepts distinct value keys", () => {
    // Guard against the rejection below passing for the wrong reason.
    expect(() => CustomFieldDefSchema.parse({
      ...base,
      values: [{ key: "low", label: "Low" }, { key: "high", label: "High" }],
    })).not.toThrow();
  });

  it("rejects two values sharing a key", () => {
    // Stored task values are keys. A duplicate makes the field
    // ambiguous in the one way that cannot be resolved afterwards: the
    // task says `dup` and the config offers two labels for it.
    expect(() => CustomFieldDefSchema.parse({
      ...base,
      values: [{ key: "dup", label: "One" }, { key: "dup", label: "Two" }],
    })).toThrow(/duplicate value key/);
  });
});

describe("calendar working days", () => {
  const base = {
    timezone: "UTC",
    first_day_of_week: 1,
    holidays: [],
  };

  it("accepts an ordinary working week", () => {
    expect(() => CalendarConfigSchema.parse({
      ...base,
      working_days: [1, 2, 3, 4, 5],
    })).not.toThrow();
  });

  it("rejects an empty working week", () => {
    // Not a configuration — a tracker where no date calculation can
    // land anywhere. Rejecting here beats every consumer inventing its
    // own meaning for "no working days".
    expect(() => CalendarConfigSchema.parse({ ...base, working_days: [] }))
      .toThrow(/at least one day/);
  });

  it("rejects a duplicated day", () => {
    expect(() => CalendarConfigSchema.parse({ ...base, working_days: [1, 1, 2] }))
      .toThrow(/duplicate working day/);
  });
});

describe("projects default", () => {
  const project = (over: Record<string, unknown> = {}) => ({
    id: ID_A, name: "Tasks", prefix: "T-", ...over,
  });

  it("accepts a live default", () => {
    expect(() => ProjectsConfigSchema.parse({
      projects: [project()],
      default: ID_A,
    })).not.toThrow();
  });

  it("still rejects a default that names no project", () => {
    // The pre-existing rule, kept working alongside the new one.
    expect(() => ProjectsConfigSchema.parse({
      projects: [project()],
      default: ID_B,
    })).toThrow(/not in the projects list/);
  });

  it("rejects an archived default", () => {
    // Existence was checked; archived was not. New tasks would land in
    // a project hidden from every picker, so the user cannot see where
    // their work went.
    expect(() => ProjectsConfigSchema.parse({
      projects: [project({ archived: true })],
      default: ID_A,
    })).toThrow(/archived/);
  });

  it("allows an archived project that is not the default", () => {
    // Archiving a project must stay possible — the rule is about the
    // default pointer, not about archiving.
    expect(() => ProjectsConfigSchema.parse({
      projects: [project(), project({ id: ID_B, name: "Old", prefix: "O-", archived: true })],
      default: ID_A,
    })).not.toThrow();
  });
});

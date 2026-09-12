import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { estimationShape } from "./estimation.ts";

// Only `estimation` matters to the function under test; the rest of the
// workflow is irrelevant, so build a minimal cast rather than a full
// valid config.
const wf = (estimation: unknown): WorkflowConfig =>
  ({ estimation }) as unknown as WorkflowConfig;

describe("estimationShape (SET-9)", () => {
  it("is null when the workflow is absent", () => {
    expect(estimationShape(undefined)).toBeNull();
  });

  it("is null when estimation is absent or disabled", () => {
    expect(estimationShape(wf(undefined))).toBeNull();
    expect(estimationShape(wf({ enabled: false, unit: "points" }))).toBeNull();
  });

  it("is numeric with the unit as suffix for a built-in unit", () => {
    expect(estimationShape(wf({ enabled: true, unit: "points" })))
      .toEqual({ kind: "numeric", suffix: "points" });
  });

  it("prefers unit_label as the numeric suffix when present", () => {
    // The built-in default writes `unit_label: pts`; a custom_numeric
    // unit *requires* one. Either way the label wins over the bare unit.
    expect(estimationShape(wf({ enabled: true, unit: "points", unit_label: "pts" })))
      .toEqual({ kind: "numeric", suffix: "pts" });
    expect(estimationShape(wf({ enabled: true, unit: "custom_numeric", unit_label: "SP" })))
      .toEqual({ kind: "numeric", suffix: "SP" });
  });

  it("is an enum over the preset values (stringified) for custom_enum", () => {
    expect(estimationShape(wf({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["XS", "S", "M", "L"],
    }))).toEqual({ kind: "enum", options: ["XS", "S", "M", "L"] });
  });

  it("tolerates numeric preset values by stringifying them", () => {
    expect(estimationShape(wf({
      enabled: true,
      unit: "custom_enum",
      unit_label: "pts",
      preset_values: [1, 2, 3, 5, 8],
    }))).toEqual({ kind: "enum", options: ["1", "2", "3", "5", "8"] });
  });

  it("is an empty-option enum when custom_enum somehow has no presets", () => {
    // Defensive: the config schema requires preset_values for
    // custom_enum, but a hand-edited file could omit it. The control
    // should render (empty) rather than crash.
    expect(estimationShape(wf({ enabled: true, unit: "custom_enum", unit_label: "x" })))
      .toEqual({ kind: "enum", options: [] });
  });
});

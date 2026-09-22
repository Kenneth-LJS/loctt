import { describe, expect, it } from "vitest";

import {
  EntityColorSchema,
  isDoubleColor,
  isPaletteColorRef,
  isSingleColor,
} from "./color.js";
import { LabelDefSchema, LabelsConfigSchema } from "./labels.js";
import { StatusDefSchema, WorkflowConfigSchema } from "./workflow.js";

/**
 * K103 — the three colour shapes, and the no-migration guarantee.
 *
 * The load-bearing assertion here is the first block: every colour
 * written before K103 is a bare hex string, and it must keep parsing
 * forever with no file rewrite. If that breaks, every existing
 * tracker's workflow.yaml and labels.yaml stops loading.
 */

describe("EntityColor — bare hex stays valid (the no-migration guarantee)", () => {
  it("parses a pre-K103 6-digit hex as the single shape", () => {
    const parsed = EntityColorSchema.parse("#1e6fcb");
    expect(parsed).toBe("#1e6fcb");
    expect(isSingleColor(parsed)).toBe(true);
  });

  it("parses the other pre-K103 hex forms HexColor accepted", () => {
    // brands.ts HexColor has always allowed 3-digit, no-`#`, and
    // uppercase. All of those exist in files on disk today.
    expect(EntityColorSchema.parse("#f00")).toBe("#f00");
    expect(EntityColorSchema.parse("1e6fcb")).toBe("1e6fcb");
    expect(EntityColorSchema.parse("#1E6FCB")).toBe("#1E6FCB");
  });

  it("still parses a whole pre-K103 labels.yaml with hex colours", () => {
    const config = LabelsConfigSchema.parse({
      labels: [
        { id: "01J0LABEL0000000000000001", name: "bug", color: "#B02F17" },
        { id: "01J0LABEL0000000000000002", name: "chore" },
      ],
    });
    expect(config.labels[0]?.color).toBe("#B02F17");
  });

  it("still parses a whole pre-K103 workflow.yaml with hex colours", () => {
    const config = WorkflowConfigSchema.parse({
      key: { prefix: "T" },
      statuses: [
        { key: "todo", label: "To Do", category: "pending", default: true, color: "#5A6472" },
        { key: "done", label: "Done", category: "completed", color: "#356E1A" },
      ],
      priorities: [{ key: "high", label: "High", color: "#CC6600" }],
      task_types: [{ key: "task", label: "Task", color: "#1868B0" }],
      relationships: [],
      custom_fields: [],
    });
    expect(config.statuses[0]?.color).toBe("#5A6472");
    expect(config.priorities[0]?.color).toBe("#CC6600");
    expect(config.task_types[0]?.color).toBe("#1868B0");
  });

  it("rejects a non-hex string, as it always did", () => {
    expect(EntityColorSchema.safeParse("red").success).toBe(false);
    expect(EntityColorSchema.safeParse("#12345").success).toBe(false);
  });
});

describe("EntityColor — the three shapes discriminate unambiguously", () => {
  it("parses the double shape and narrows to it alone", () => {
    const parsed = EntityColorSchema.parse({ light: "#0F766E", dark: "#39A88F" });
    expect(parsed).toEqual({ light: "#0F766E", dark: "#39A88F" });
    expect(isDoubleColor(parsed)).toBe(true);
    expect(isPaletteColorRef(parsed)).toBe(false);
    expect(isSingleColor(parsed)).toBe(false);
  });

  it("parses the palette shape and narrows to it alone", () => {
    const parsed = EntityColorSchema.parse({ palette: "teal" });
    expect(parsed).toEqual({ palette: "teal" });
    expect(isPaletteColorRef(parsed)).toBe(true);
    expect(isDoubleColor(parsed)).toBe(false);
    expect(isSingleColor(parsed)).toBe(false);
  });

  it("rejects a hybrid object, so the two object arms cannot overlap", () => {
    // Both arms are .strict(); a value carrying both key sets must
    // match NEITHER, or the union would be ambiguous at runtime.
    expect(EntityColorSchema.safeParse({
      palette: "teal",
      light: "#0F766E",
      dark: "#39A88F",
    }).success).toBe(false);
  });

  it("rejects a half-specified pair — a double colour needs both modes", () => {
    expect(EntityColorSchema.safeParse({ light: "#0F766E" }).success).toBe(false);
    expect(EntityColorSchema.safeParse({ dark: "#39A88F" }).success).toBe(false);
  });

  it("validates the hex inside each half of a double colour", () => {
    expect(EntityColorSchema.safeParse({ light: "nonsense", dark: "#39A88F" }).success).toBe(false);
    expect(EntityColorSchema.safeParse({ light: "#0F766E", dark: "nonsense" }).success).toBe(false);
  });

  it("rejects an unknown key on a double colour", () => {
    expect(EntityColorSchema.safeParse({
      light: "#0F766E",
      dark: "#39A88F",
      dim: "#000000",
    }).success).toBe(false);
  });
});

describe("EntityColor — every entity colour field accepts all three shapes", () => {
  const shapes = [
    ["single", "#1e6fcb"],
    ["double", { light: "#0F766E", dark: "#39A88F" }],
    ["palette", { palette: "teal" }],
  ] as const;

  for (const [name, color] of shapes) {
    it(`a label takes the ${name} shape`, () => {
      const parsed = LabelDefSchema.parse({ id: "01J0L", name: "bug", color });
      expect(parsed.color).toEqual(color);
    });

    it(`a status takes the ${name} shape`, () => {
      const parsed = StatusDefSchema.parse({
        key: "todo",
        label: "To Do",
        category: "pending",
        color,
      });
      expect(parsed.color).toEqual(color);
    });
  }

  it("carries all three shapes across every workflow entity", () => {
    const config = WorkflowConfigSchema.parse({
      key: { prefix: "T" },
      statuses: [{
        key: "todo",
        label: "To Do",
        category: "pending",
        default: true,
        color: { palette: "teal" },
      }],
      priorities: [{ key: "high", label: "High", color: { light: "#CC6600", dark: "#F0A868" } }],
      task_types: [{ key: "task", label: "Task", color: "#1868B0" }],
      relationships: [{
        key: "blocks",
        label: "Blocks",
        inverse: "is_blocked_by",
        inverse_label: "Is blocked by",
        color: { palette: "red" },
      }],
      custom_fields: [{
        key: "tier",
        label: "Tier",
        type: "enum",
        multi: false,
        searchable: false,
        values: [{ key: "gold", label: "Gold", color: { light: "#B02F17", dark: "#FF8A73" } }],
      }],
    });
    expect(config.statuses[0]?.color).toEqual({ palette: "teal" });
    expect(config.priorities[0]?.color).toEqual({ light: "#CC6600", dark: "#F0A868" });
    expect(config.task_types[0]?.color).toBe("#1868B0");
    expect(config.relationships?.[0]?.color).toEqual({ palette: "red" });
    expect(config.custom_fields?.[0]?.values?.[0]?.color).toEqual({
      light: "#B02F17",
      dark: "#FF8A73",
    });
  });
});

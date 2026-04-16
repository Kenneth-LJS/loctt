import { describe, it, expect } from "vitest";
import { allocateKey, initKeyAllocation, appendKeyHistory, KeyAllocationError } from "./keys.js";
import type { LocttState } from "@loctt/contracts";

function makeState(): LocttState {
  return {
    keys: {
      task: { prefix: "T-", next_number: 10 },
    },
  };
}

describe("allocateKey", () => {
  it("returns the next key and increments next_number", () => {
    const state = makeState();
    const key1 = allocateKey(state, "task");
    expect(key1).toBe("T-10");
    expect(state.keys["task"]?.next_number).toBe(11);

    const key2 = allocateKey(state, "task");
    expect(key2).toBe("T-11");
    expect(state.keys["task"]?.next_number).toBe(12);
  });

  it("throws for unknown entity type", () => {
    const state = makeState();
    expect(() => allocateKey(state, "epic")).toThrow(KeyAllocationError);
  });
});

describe("initKeyAllocation", () => {
  it("creates a new entity type allocation", () => {
    const state = makeState();
    initKeyAllocation(state, "epic", "E-", 1);
    expect(state.keys["epic"]).toEqual({ prefix: "E-", next_number: 1 });
  });

  it("defaults start number to 1", () => {
    const state = makeState();
    initKeyAllocation(state, "bug", "B-");
    expect(state.keys["bug"]?.next_number).toBe(1);
  });

  it("throws if entity type already exists", () => {
    const state = makeState();
    expect(() => initKeyAllocation(state, "task", "T-")).toThrow(KeyAllocationError);
  });
});

describe("appendKeyHistory", () => {
  it("creates history from undefined", () => {
    const result = appendKeyHistory(undefined, "T-3");
    expect(result).toEqual(["T-3"]);
  });

  it("appends to existing history", () => {
    const result = appendKeyHistory(["T-1", "T-2"], "T-3");
    expect(result).toEqual(["T-1", "T-2", "T-3"]);
  });

  it("deduplicates existing keys", () => {
    const result = appendKeyHistory(["T-1", "T-2"], "T-2");
    expect(result).toEqual(["T-1", "T-2"]);
  });
});

import { describe, expect,it } from "vitest";

import { parseReconcileState, ReconcileStateError,serializeReconcileState } from "./reconcile.js";

describe("parseReconcileState", () => {
  it("parses the canonical reconcile state from the design doc", () => {
    const yaml = `
mode: publish
base_commit: abc123
remote_commit: def456
started_at: "2026-04-16T14:30:00Z"
`;
    const state = parseReconcileState(yaml);
    expect(state.mode).toBe("publish");
    expect(state.base_commit).toBe("abc123");
    expect(state.remote_commit).toBe("def456");
    expect(state.started_at).toBe("2026-04-16T14:30:00Z");
  });

  it("accepts sync mode", () => {
    const yaml = `
mode: sync
base_commit: aaa
remote_commit: bbb
started_at: "2026-01-01T00:00:00Z"
`;
    const state = parseReconcileState(yaml);
    expect(state.mode).toBe("sync");
  });

  it("throws on invalid mode", () => {
    const yaml = `
mode: merge
base_commit: aaa
remote_commit: bbb
started_at: "2026-01-01T00:00:00Z"
`;
    expect(() => parseReconcileState(yaml)).toThrow("must be one of: publish, sync");
  });

  it("throws on missing base_commit", () => {
    const yaml = `mode: publish\nremote_commit: x\nstarted_at: "2026-01-01T00:00:00Z"`;
    expect(() => parseReconcileState(yaml)).toThrow("base_commit must be a non-empty string");
  });

  it("throws on non-object root", () => {
    expect(() => parseReconcileState("null")).toThrow(ReconcileStateError);
  });
});

describe("serializeReconcileState", () => {
  it("round-trips through parse/serialize", () => {
    const yaml = `
mode: publish
base_commit: abc123
remote_commit: def456
started_at: "2026-04-16T14:30:00Z"
`;
    const original = parseReconcileState(yaml);
    const serialized = serializeReconcileState(original);
    const reparsed = parseReconcileState(serialized);
    expect(reparsed).toEqual(original);
  });
});

import { describe, expect,it } from "vitest";

import { parseSyncState, serializeSyncState, SyncStateError } from "./sync.js";

describe("parseSyncState", () => {
  it("parses the canonical sync state from the design doc", () => {
    const yaml = `
git:
  enabled: true
  branch: .loctt
  remote: origin
  auto_push: true
  auto_fetch: true
  last_synced_commit: abc123
`;
    const state = parseSyncState(yaml);
    expect(state.git.enabled).toBe(true);
    expect(state.git.branch).toBe(".loctt");
    expect(state.git.remote).toBe("origin");
    expect(state.git.auto_push).toBe(true);
    expect(state.git.auto_fetch).toBe(true);
    expect(state.git.last_synced_commit).toBe("abc123");
  });

  it("rejects files missing remote/auto_push/auto_fetch", () => {
    const yaml = `
git:
  enabled: true
  branch: loctt
  last_synced_commit: abc123
`;
    expect(() => parseSyncState(yaml)).toThrow(SyncStateError);
  });

  it("allows omitting last_synced_commit", () => {
    const yaml = `
git:
  enabled: false
  branch: .loctt
  remote: origin
  auto_push: true
  auto_fetch: true
`;
    const state = parseSyncState(yaml);
    expect(state.git.enabled).toBe(false);
    expect(state.git.last_synced_commit).toBeUndefined();
  });

  it("throws on missing git.enabled", () => {
    const yaml = `git:\n  branch: .loctt`;
    expect(() => parseSyncState(yaml)).toThrow(SyncStateError);
    expect(() => parseSyncState(yaml)).toThrow("git.enabled is required (expected boolean)");
  });

  it("throws on missing git.branch", () => {
    const yaml = `git:\n  enabled: true`;
    expect(() => parseSyncState(yaml)).toThrow(SyncStateError);
    expect(() => parseSyncState(yaml)).toThrow("git.branch is required (expected string)");
  });

  it("throws on wrong type for git.enabled", () => {
    const yaml = `git:\n  enabled: "yes"\n  branch: .loctt`;
    expect(() => parseSyncState(yaml)).toThrow("git.enabled must be a boolean, got: string");
  });

  it("throws on non-object root", () => {
    expect(() => parseSyncState("42")).toThrow(SyncStateError);
  });
});

describe("serializeSyncState", () => {
  it("round-trips through parse/serialize", () => {
    const yaml = `
git:
  enabled: true
  branch: .loctt
  remote: origin
  auto_push: true
  auto_fetch: true
  last_synced_commit: abc123
`;
    const original = parseSyncState(yaml);
    const serialized = serializeSyncState(original);
    const reparsed = parseSyncState(serialized);
    expect(reparsed).toEqual(original);
  });
});

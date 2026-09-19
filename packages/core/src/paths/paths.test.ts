import { resolve, sep } from "node:path";

import { describe, expect,it } from "vitest";

import {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
  getConfigDir,
  getDocsDir,
  getHistoryFilePath,
  getLocalDir,
  getQueriesConfigPath,
  getReconcileStatePath,
  getStateFilePath,
  getSyncStatePath,
  getTaskDir,
  getTaskFilePath,
  getTasksDir,
  getWorkflowConfigPath,
  isPathContained,
  resolveLocttDir,
} from "./index.js";

describe("path helpers", () => {
  const root = "/fake/project";
  const locttDir = resolveLocttDir(root);

  it("resolves .loctt directory from project root", () => {
    expect(locttDir).toBe(resolve(root, ".loctt"));
  });

  it("resolves tasks root directory", () => {
    expect(getTasksDir(locttDir)).toBe(`${locttDir}${sep}tasks`);
  });

  it("resolves task directory by id", () => {
    const result = getTaskDir(locttDir, "01HSV6TQ3Y");
    expect(result).toBe(`${locttDir}${sep}tasks${sep}01HSV6TQ3Y`);
  });

  it("resolves task.md path by id", () => {
    const result = getTaskFilePath(locttDir, "01HSV6TQ3Y");
    expect(result).toBe(`${locttDir}${sep}tasks${sep}01HSV6TQ3Y${sep}task.md`);
  });

  it("resolves config directory", () => {
    expect(getConfigDir(locttDir)).toBe(`${locttDir}${sep}config`);
  });

  it("resolves state.yaml path", () => {
    expect(getStateFilePath(locttDir)).toBe(`${locttDir}${sep}state.yaml`);
  });

  it("resolves local directory", () => {
    expect(getLocalDir(locttDir)).toBe(`${locttDir}${sep}local`);
  });

  it("resolves workflow.yaml path", () => {
    expect(getWorkflowConfigPath(locttDir)).toBe(`${locttDir}${sep}config${sep}workflow.yaml`);
  });

  it("resolves queries.yaml path", () => {
    expect(getQueriesConfigPath(locttDir)).toBe(`${locttDir}${sep}config${sep}queries.yaml`);
  });

  it("resolves sync.yaml path under local/", () => {
    expect(getSyncStatePath(locttDir)).toBe(`${locttDir}${sep}local${sep}sync.yaml`);
  });

  it("resolves reconcile.yaml path under local/", () => {
    expect(getReconcileStatePath(locttDir)).toBe(`${locttDir}${sep}local${sep}reconcile.yaml`);
  });

  it("resolves docs directory", () => {
    expect(getDocsDir(locttDir)).toBe(`${locttDir}${sep}docs`);
  });

  it("resolves _history.yaml path under task dir", () => {
    expect(getHistoryFilePath(locttDir, "T1")).toBe(
      `${locttDir}${sep}tasks${sep}T1${sep}_history.yaml`,
    );
  });

  it("resolves attachments directory under task dir", () => {
    expect(getAttachmentsDir(locttDir, "T1")).toBe(
      `${locttDir}${sep}tasks${sep}T1${sep}attachments`,
    );
  });

  it("resolves a single attachment path", () => {
    expect(getAttachmentPath(locttDir, "T1", "design.pdf")).toBe(
      `${locttDir}${sep}tasks${sep}T1${sep}attachments${sep}design.pdf`,
    );
  });

  it("rejects unsafe basenames in getAttachmentPath", () => {
    expect(() => getAttachmentPath(locttDir, "T1", "../escape")).toThrow();
    expect(() => getAttachmentPath(locttDir, "T1", "sub/file")).toThrow();
    expect(() => getAttachmentPath(locttDir, "T1", "a\\b")).toThrow();
    expect(() => getAttachmentPath(locttDir, "T1", "")).toThrow();
    expect(() => getAttachmentPath(locttDir, "T1", "..")).toThrow();
    expect(() => getAttachmentPath(locttDir, "T1", "foo\0")).toThrow();
  });

  it("assertSafeBasename accepts plain names including dotfiles", () => {
    // assertSafeBasename only cares about traversal; the higher-level
    // attach logic is what additionally rejects leading dots.
    expect(() => assertSafeBasename("file.txt")).not.toThrow();
    expect(() => assertSafeBasename(".env")).not.toThrow();
  });

  describe("isPathContained", () => {
    const container = resolve("/tmp/tracker");

    it("accepts a path inside the container, and the container itself", () => {
      expect(isPathContained(container, resolve(container, "sub/file.txt"))).toBe(true);
      expect(isPathContained(container, container)).toBe(true);
    });

    it("rejects a path outside the container", () => {
      expect(isPathContained(container, resolve("/tmp/other/file.txt"))).toBe(false);
      expect(isPathContained(container, resolve("/etc/passwd"))).toBe(false);
    });

    it("rejects a ../ escape and a sibling-prefix false positive", () => {
      expect(isPathContained(container, resolve(container, "..", "escape.txt"))).toBe(false);
      // "/tmp/tracker-evil" shares the prefix "tracker" but is NOT inside.
      expect(isPathContained(container, resolve("/tmp/tracker-evil/x"))).toBe(false);
    });
  });
});

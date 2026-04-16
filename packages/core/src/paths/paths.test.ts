import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import {
  resolveLocttDir,
  getTaskDir,
  getTaskFilePath,
  getConfigDir,
  getStateFilePath,
  getLocalDir,
} from "./index.js";

describe("path helpers", () => {
  const root = "/fake/project";
  const locttDir = resolveLocttDir(root);

  it("resolves .loctt directory from project root", () => {
    expect(locttDir).toBe(resolve(root, ".loctt"));
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
    const result = getConfigDir(locttDir);
    expect(result).toBe(`${locttDir}${sep}config`);
  });

  it("resolves state.yaml path", () => {
    const result = getStateFilePath(locttDir);
    expect(result).toBe(`${locttDir}${sep}state.yaml`);
  });

  it("resolves local directory", () => {
    const result = getLocalDir(locttDir);
    expect(result).toBe(`${locttDir}${sep}local`);
  });
});

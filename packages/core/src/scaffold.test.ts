import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect,it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("monorepo scaffold", () => {
  it("has all expected workspace directories", () => {
    const expected = [
      "packages/core",
      "packages/contracts",
      "apps/cli",
      "apps/mcp",
      "apps/web",
    ];
    for (const dir of expected) {
      expect(existsSync(resolve(ROOT, dir, "package.json")), `${dir}/package.json should exist`).toBe(true);
      expect(existsSync(resolve(ROOT, dir, "tsconfig.json")), `${dir}/tsconfig.json should exist`).toBe(true);
      expect(existsSync(resolve(ROOT, dir, "src/index.ts")), `${dir}/src/index.ts should exist`).toBe(true);
    }
  });

  it("npm recognizes all workspaces", () => {
    const output = execSync("npm ls --json --depth=0", { cwd: ROOT, encoding: "utf-8" });
    const parsed = JSON.parse(output) as { dependencies: Record<string, unknown> };
    const deps = Object.keys(parsed.dependencies);

    expect(deps).toContain("@loctt/core");
    expect(deps).toContain("@loctt/contracts");
    expect(deps).toContain("@loctt/cli");
    expect(deps).toContain("@loctt/mcp");
    expect(deps).toContain("@loctt/web");
  });

  it("typescript project references build successfully", () => {
    expect(() => {
      execSync("npx tsc --build --dry", { cwd: ROOT, encoding: "utf-8", stdio: "pipe" });
    }).not.toThrow();
  });
});

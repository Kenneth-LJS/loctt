import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect,it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("monorepo scaffold", () => {
  it("has all expected workspace directories", () => {
    const expected: { dir: string; entry: string }[] = [
      { dir: "packages/core", entry: "src/index.ts" },
      { dir: "packages/contracts", entry: "src/index.ts" },
      { dir: "apps/cli", entry: "src/index.ts" },
      { dir: "apps/mcp", entry: "src/index.ts" },
      // apps/web is split into server + client (see TEMP-WEB-TICKETS.md
      // T0.1): the server's entry is src/server/index.ts.
      { dir: "apps/web", entry: "src/server/index.ts" },
    ];
    for (const { dir, entry } of expected) {
      expect(existsSync(resolve(ROOT, dir, "package.json")), `${dir}/package.json should exist`).toBe(true);
      expect(existsSync(resolve(ROOT, dir, "tsconfig.json")), `${dir}/tsconfig.json should exist`).toBe(true);
      expect(existsSync(resolve(ROOT, dir, entry)), `${dir}/${entry} should exist`).toBe(true);
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

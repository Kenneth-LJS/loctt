import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
    // Default to node — server tests need real Node fetch/Buffer/etc.
    // Client tests opt into jsdom per-file: place
    //   // @vitest-environment jsdom
    // at the top, or match the environmentMatchGlobs pattern below.
    environment: "node",
    environmentMatchGlobs: [
      ["src/client/**/*.test.{ts,tsx}", "jsdom"],
    ],
  },
});

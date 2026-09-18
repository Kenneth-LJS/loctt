import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Don't pick up the compiled .test.js files emitted to dist/
    // alongside .test.ts sources. They duplicate the source tests
    // and become stale across schema changes.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

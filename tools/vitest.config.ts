import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "tools",
    include: ["tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

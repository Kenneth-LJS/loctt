import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      ".loctt/",
      "eslint.config.js",
      "**/tsup.config.ts",
      "temp-ui-mockups/",
      // Agent worktrees are full copies of the repo. Six of them made
      // `npm run lint` OOM the V8 heap, and the crash dump grepped
      // clean — so a broken lint reported as a passing one.
      ".claude/worktrees/",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "vitest.config.ts",
            "packages/*/vitest.config.ts",
            "apps/*/vitest.config.ts",
            "apps/*/vite.config.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Already enforced by tsc (noUnusedLocals / noUnusedParameters)
      "@typescript-eslint/no-unused-vars": "off",

      // Catch unhandled promises — important for CLI/server code
      "@typescript-eslint/no-floating-promises": "error",

      // Allow void to explicitly discard promises
      "no-void": "off",

      // Allow non-null assertions in rare justified cases (warn, not error)
      "@typescript-eslint/no-non-null-assertion": "warn",

      // Import sorting
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      // Tests often use non-null assertions for brevity
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests may use any for mocking
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // React hooks discipline for the web client. `rules-of-hooks` is an
    // error — a conditionally-called hook is a real bug (it cost a
    // render-loop once). `exhaustive-deps` is a warning: a missing effect
    // dependency is usually-but-not-always wrong, so it flags without
    // failing the gate. Scoped to the client's React files; the CLI, MCP
    // and core have no components.
    files: ["apps/web/src/client/**/*.tsx", "apps/web/src/client/**/*.ts"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // LLM runbook verify scripts share a default-export signature
    // `(root: string) => Promise<void>` so they're awaitable from the
    // runner. Many read-only scenarios have no await internally, which
    // is fine — disable require-await for this directory.
    files: ["tests/llm/verify/**/*.ts", "tests/llm/lib/runner.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
);

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
          allowDefaultProject: ["eslint.config.js", "vitest.config.ts"],
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
);

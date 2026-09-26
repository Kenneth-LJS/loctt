import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

/**
 * Unicode affordance glyphs banned from the web client (A305).
 *
 * `LITERAL_GLYPHS` are unambiguous UI affordances with no prose use; they
 * are banned in JSX text AND in string/template literals. `JSX_TEXT_GLYPHS`
 * adds the tick and the three stars, which are banned in JSX text only:
 * `ICON.star` in `ui/icons.ts` is the one sanctioned text star, and tests
 * have to be able to name a glyph to assert it is absent.
 */
const LITERAL_GLYPHS = "\u25b8\u25be\u25b4\u25bc\u25ba\u2715\u2716\u22ef\u22ee\u2714\u25cf\u25cb\u25c6\u25a0\u25a1";
const JSX_TEXT_GLYPHS = LITERAL_GLYPHS + "\u2713\u2605\u2606\u2b51";

/**
 * DELIBERATELY NOT BANNED: the arrows `\u2192\u2190\u2191\u2193` and the multiplication
 * sign `\u00d7`.
 *
 * A208 expressly kept prose arrows and keyboard-key labels literal, and
 * the tree bears that out: every one of the 19 hits a trial ban produced
 * was prose, and not one was an affordance. They are punctuation between
 * interpolations (`{start} \u2192 {end}`, `{oldKey} \u2192 {newKey}`), navigation
 * paths ("Settings \u2192 Users"), or a literal multiplication (`\u00d7{n}
 * duplicate`).
 *
 * A "standalone in a text node" narrowing was tried and does not work:
 * `{a} \u2192 {b}` yields a text node that IS just the arrow and whitespace,
 * so it is indistinguishable from an arrow used as a control. There is no
 * false-positive-free rule for these characters, and a rule carrying nine
 * suppressions is a rule that gets deleted. Catching a bare `\u2192` button is
 * left to the code-review checklist in `.claude/skills/review/SKILL.md`.
 */

const GLYPH_MESSAGE =
  "Unicode affordance glyph. Draw it with the <Icon> component from " +
  "apps/web/src/client/ui/Icon.tsx (e.g. <Icon name=\"close\" />, " +
  "name=\"chevronDown\", \"more\", \"check\", \"drag\") instead of typing the " +
  "character. See decisions.md A208/A305.";

/**
 * A312 — hand-rolled "animated glyph" spinner ban.
 *
 * A JSX element whose className carries `animate-pulse`/`animate-spin`
 * AND whose only child is a short glyph-only JSXText (no letters or
 * digits, e.g. a bare `•`, `...`, `⋯`) is a fake spinner: someone spun a
 * bullet or ellipsis with a Tailwind animation instead of using the real
 * spinner. Use `LogoSpinner` (apps/web/src/client/ui/brand/LogoSpinner.tsx)
 * directly, or `Button`'s `loading` prop / `LoadingState` for a busy
 * region — and give the busy region an accessible name (`aria-label` or
 * `aria-busy` + a `role="status"` live message), matching A307/A294.
 */
const FAKE_SPINNER_MESSAGE =
  "Hand-rolled spinner: an animated glyph is not the loading spinner. " +
  "Use LogoSpinner (apps/web/src/client/ui/brand/LogoSpinner.tsx), or " +
  "Button's `loading` prop / LoadingState for a busy region, and give " +
  "the busy region an accessible name. See decisions.md A312.";

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
    // ------------------------------------------------------------------
    // A208 / A305 — Unicode affordance glyphs are banned in the web client.
    //
    // Affordances (carets, close, kebab, reorder, checkmarks, bullets) are
    // drawn by the SVG `<Icon>` component in `ui/Icon.tsx`. Typing them as
    // characters is the defect Ken has now reported three times; the
    // `ICON` map that used to sanction them is gone, and this rule is what
    // keeps them from coming back.
    //
    // Scope is deliberately AST-based, not textual:
    //
    //  * `JSXText` and string/template literals only. Comments and
    //    docstrings are untouched — `Icon.tsx`, `icons.ts` and several
    //    call-site comments legitimately DISCUSS these characters in
    //    prose ("was `\u25be` vs `\u25bc`"), and a textual grep would fail on
    //    every one of them.
    //
    //  * Two tiers. The unambiguous affordance glyphs are banned in
    //    both JSX text and literals. `\u2713\u2605\u2606\u2b51` are banned in JSX text
    //    only, because `ICON.star` (ui/icons.ts) is the one sanctioned
    //    text star and Ken ruled it stays. The arrows and `\u00d7` are not
    //    banned at all -- see the note above the rule for why, and for
    //    the review-checklist line that covers them instead.
    // ------------------------------------------------------------------
    files: ["apps/web/src/client/**/*.ts", "apps/web/src/client/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `JSXText[value=/[${JSX_TEXT_GLYPHS}]/u]`,
          message: GLYPH_MESSAGE,
        },
        {
          selector: `Literal[value=/[${LITERAL_GLYPHS}]/u]`,
          message: GLYPH_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/[${LITERAL_GLYPHS}]/u]`,
          message: GLYPH_MESSAGE,
        },
        {
          // A312. Matches only a string-literal className (`className="…"`
          // or one Literal argument inside a `cn(...)` call, e.g.
          // `cn("animate-pulse", ...)`); it CANNOT see a class assembled by
          // string concatenation, a template literal, or a variable, so a
          // conditionally-applied `animate-pulse` in those forms is not
          // covered. Skeleton bars (`animate-pulse` with no text child, or
          // a longer/lettered child) do not match the JSXText half.
          selector: `JSXElement:has(JSXOpeningElement JSXAttribute[name.name="className"] Literal[value=/(^|\\s)animate-(pulse|spin)(\\s|$)/]) > JSXText[value=/^\\s*[^\\p{L}\\p{N}\\s]{1,3}\\s*$/u]`,
          message: FAKE_SPINNER_MESSAGE,
        },
      ],
    },
  },
  {
    // `ui/icons.ts` is the single sanctioned home for the two surviving
    // text glyphs (\u2b51 star, \u26a0 warning). Its own docstring names them, and
    // the map is what every other file imports instead of typing one.
    files: ["apps/web/src/client/ui/icons.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // `ui/iconCatalog.ts` is DATA, not UI: the emoji half of the K104
    // icon picker, where `\u2714\ufe0f` and `\u2611\ufe0f` are the user-pickable emoji
    // themselves. Banning them here would ban the feature.
    files: ["apps/web/src/client/ui/iconCatalog.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // `activity/describe.ts` holds KIND_ICONS — one distinct marker per
    // history kind, every one `aria-hidden` beside the word it decorates
    // (CMT-15). Status markers in a text stream, not control affordances.
    files: ["apps/web/src/client/activity/describe.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Tests assert on rendered text, so a test that verifies a glyph is
    // ABSENT ("the marker is an SVG, not \u2b51") has to name it. The ban's
    // own regression tests would otherwise be unwritable. Production
    // files under the same tree stay covered.
    files: ["apps/web/src/client/**/*.test.ts", "apps/web/src/client/**/*.test.tsx"],
    rules: { "no-restricted-syntax": "off" },
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

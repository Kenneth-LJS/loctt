import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CaseIndex, TestCase } from "./parse.ts";
import { formatSmokeList, resolveSmokeTests } from "./smoke.ts";

/**
 * `resolveSmokeTests` is the resolution step `npm run cases:index`
 * (K155/B50) runs on top of the plain `@verifies` tag scan to produce
 * `tests/ui/smoke.list`: which exact Playwright test does each
 * blocker-case tag belong to. Each test below names the tag shape it
 * pins down, or the failure mode (an untestable tag) it must not hide.
 */

let root: string;

function makeCase(id: string, severity: TestCase["severity"] = "blocker"): TestCase {
  return {
    id,
    tree: "ui",
    file: `tests/cases/ui-test-cases/flow-x.md`,
    line: 1,
    title: id,
    milestone: "M1",
    severity,
    principles: ["P1"],
    surfaces: ["UI"],
    resolved: false,
  };
}

function makeIndex(cases: readonly TestCase[]): CaseIndex {
  return {
    generated_from: "test",
    counts: {
      total: cases.length,
      ui: cases.length,
      surface: 0,
      resolved: 0,
    },
    cases,
  };
}

async function writeSpec(name: string, body: string): Promise<void> {
  await writeFile(path.join(root, name), body, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "loctt-smoke-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveSmokeTests", () => {
  it("resolves a tag immediately before the test( it annotates, preferring backward over a later, unrelated test", async () => {
    // The tag sits inside a multi-line test( ... ) => { signature — a
    // shape seen in this repo where a test's params wrap. A forward-only
    // search would skip past the real match (nothing between the tag and
    // the test's closing brace is a test( call) and land on the next,
    // unrelated test instead.
    await writeSpec(
      "flow-a.spec.ts",
      [
        "import { test } from \"@playwright/test\";",
        "",
        "test(\"GIT-8: does the thing\", async ({",
        "  page,",
        "}) => {",
        "  // @verifies GIT-8",
        "  expect(1).toBe(1);",
        "});",
        "",
        "test(\"an unrelated later test\", async () => {});",
      ].join("\n"),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("GIT-8")]), root);

    expect(result.unresolved).toEqual([]);
    expect(result.tests).toEqual([{ file: "flow-a.spec.ts", line: 3 }]);
  });

  it("resolves a tag on the first line INSIDE the test body it annotates", async () => {
    // The GIT-19 shape: test.describe(...) with a docblock, then the tag
    // as the first statement inside the nested test(...).
    await writeSpec(
      "flow-b.spec.ts",
      [
        "import { test } from \"@playwright/test\";",
        "",
        "test.describe(\"GIT-19 group\", () => {",
        "  test(\"the old-key URL follows\", async () => {",
        "    // @verifies GIT-19",
        "    expect(1).toBe(1);",
        "  });",
        "});",
      ].join("\n"),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("GIT-19")]), root);

    expect(result.unresolved).toEqual([]);
    expect(result.tests).toEqual([{ file: "flow-b.spec.ts", line: 4 }]);
  });

  it("expands a file-level tag (no test within either window) to every test in the file", async () => {
    await writeSpec(
      "flow-c.spec.ts",
      [
        "/**",
        " * @verifies REL-5 REL-13",
        " */",
        "",
        "import { test } from \"@playwright/test\";",
        "",
        ...Array.from({ length: 60 }, (_, i) => `// filler line ${String(i)}`),
        "",
        "test(\"first\", async () => {});",
        "test(\"second\", async () => {});",
      ].join("\n"),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("REL-5"), makeCase("REL-13")]), root);

    expect(result.unresolved).toEqual([]);
    expect(result.tests.map((t) => t.line)).toEqual([68, 69]);
  });

  it("ignores a tag naming only non-blocker cases", async () => {
    await writeSpec(
      "flow-d.spec.ts",
      ["import { test } from \"@playwright/test\";", "", "// @verifies REL-6", "test(\"minor case\", async () => {});"].join(
        "\n",
      ),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("REL-6", "minor")]), root);

    expect(result.tests).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("reports an unresolved tag rather than silently dropping it — a file-level tag with no test in it at all", async () => {
    await writeSpec(
      "flow-e.spec.ts",
      ["/**", " * @verifies GIT-8", " */", "export {};"].join("\n"),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("GIT-8")]), root);

    expect(result.tests).toEqual([]);
    expect(result.unresolved).toEqual([{ caseId: "GIT-8", file: "flow-e.spec.ts", line: 2 }]);
  });

  it("does not resolve a tag more than 8 lines behind its own test( — it must fall forward instead", async () => {
    // A tag 9+ lines before an UNRELATED test( must not bind to it; it
    // should instead find the real test ahead of it within the forward
    // window. This is the guard against the backward window crossing
    // into a previous test's trailing lines.
    await writeSpec(
      "flow-f.spec.ts",
      [
        "import { test } from \"@playwright/test\";",
        "test(\"unrelated earlier test\", async () => {});",
        ...Array.from({ length: 9 }, (_, i) => `  // body line ${String(i)}`),
        "// @verifies GIT-8",
        "test(\"GIT-8: the real one\", async () => {});",
      ].join("\n"),
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("GIT-8")]), root);

    expect(result.unresolved).toEqual([]);
    expect(result.tests).toEqual([{ file: "flow-f.spec.ts", line: 13 }]);
  });

  it("skips the fixtures/ directory", async () => {
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    await writeFile(
      path.join(root, "fixtures", "helper.spec.ts"),
      ["// @verifies GIT-8", "test(\"not a real spec\", async () => {});"].join("\n"),
      "utf8",
    );

    const result = await resolveSmokeTests(makeIndex([makeCase("GIT-8")]), root);

    expect(result.tests).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

describe("formatSmokeList", () => {
  it("writes one file:line per line, empty string for no tests", () => {
    expect(
      formatSmokeList({
        tests: [
          { file: "flow-a.spec.ts", line: 4 },
          { file: "flow-b.spec.ts", line: 10 },
        ],
        unresolved: [],
      }),
    ).toBe("flow-a.spec.ts:4\nflow-b.spec.ts:10\n");

    expect(formatSmokeList({ tests: [], unresolved: [] })).toBe("");
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

/**
 * Every query in the Relationship Filtering section of
 * query-language.md must parse. The section's previous version
 * documented a form that could not match any task, and nothing caught
 * it because no test read the doc.
 */
describe("query-language.md relationship examples", () => {
  const doc = readFileSync(
    new URL("../../../../docs/user/common/query-language.md", import.meta.url),
    "utf8",
  );
  const section = doc.slice(
    doc.indexOf("## Relationship Filtering"),
    doc.indexOf("## Saved Views"),
  );
  const block = /```\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  const examples = block
    .split("\n")
    .map(l => l.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);

  it("found the examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(6);
  });

  it.each(examples)("parses: %s", q => {
    expect(() => parseQuery(tokenize(q))).not.toThrow();
  });
});

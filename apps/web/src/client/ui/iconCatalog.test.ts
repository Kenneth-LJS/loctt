import { describe, expect, it } from "vitest";

import { EMOJI_CATALOG } from "./iconCatalog.ts";

describe("EMOJI_CATALOG", () => {
  it("has no duplicate char values", () => {
    const seen = new Map<string, number>();
    for (const entry of EMOJI_CATALOG) {
      seen.set(entry.char, (seen.get(entry.char) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  it("gives every entry at least two search keywords", () => {
    const thin = EMOJI_CATALOG.filter(entry => entry.keywords.length < 2);
    expect(thin).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { graphemeCount, isEmojiPresentation, isSingleGrapheme } from "./icon.js";
import { IconStringSchema } from "./workflow.js";

/**
 * UI-14 / K104 — the two engine built-ins that decide "is this an emoji"
 * and "is this one character".
 *
 * What these catch: the whole point of using Unicode properties instead
 * of a hand-maintained list is that the classification is CORRECT for
 * characters nobody enumerated. The table below is the measured
 * behaviour Ken's ruling was written against, so a regression here means
 * either the rule was re-implemented by hand or the wrong property was
 * chosen — both of which are silent, because the common cases (🎈, A)
 * agree under every wrong implementation.
 */
describe("isEmojiPresentation — emoji vs colourable glyph", () => {
  it("calls a colour emoji an emoji", () => {
    expect(isEmojiPresentation("🎈")).toBe(true);
    expect(isEmojiPresentation("☕")).toBe(true);
  });

  it("does NOT call a text-presentation glyph an emoji", () => {
    // The discriminating cases. `★` is Extended_Pictographic but renders
    // as TEXT in `currentColor`, so it CAN be tinted — an implementation
    // built on Extended_Pictographic would wrongly disable the colour
    // control here, and would still pass every 🎈-vs-A test.
    expect(isEmojiPresentation("★")).toBe(false);
    expect(isEmojiPresentation("✓")).toBe(false);
    expect(isEmojiPresentation("→")).toBe(false);
    expect(isEmojiPresentation("⭑")).toBe(false);
    expect(isEmojiPresentation("Ⓐ")).toBe(false);
  });

  it("treats a U+FE0F-forced glyph as an emoji", () => {
    // `✔️` = `✔` (Emoji_Presentation FALSE) + U+FE0F, which FORCES colour
    // emoji rendering. The property alone gets this wrong, which is why
    // the rule is "the property OR a trailing U+FE0F".
    expect(isEmojiPresentation("✔️")).toBe(true);
    // ...and the bare base character, without the selector, is still text.
    expect(isEmojiPresentation("✔")).toBe(false);
  });

  it("is false for the empty string", () => {
    expect(isEmojiPresentation("")).toBe(false);
  });
});

describe("graphemeCount — one character, including combined emoji", () => {
  it("counts every legitimate combined form as ONE", () => {
    // Ken: "compatible with emojis that are combined data together, and
    // all these weird emoji modifiers". Neither `.length` nor
    // `[...s].length` gets these right — 👨‍👩‍👧 is 8 UTF-16 units and 5
    // code points, but one character.
    expect(graphemeCount("🎈")).toBe(1);
    expect(graphemeCount("👨‍👩‍👧")).toBe(1); // ZWJ family
    expect(graphemeCount("👍🏽")).toBe(1); // skin-tone modifier
    expect(graphemeCount("🇬🇧")).toBe(1); // regional-indicator flag
    expect(graphemeCount("🏳️‍🌈")).toBe(1);
    expect(graphemeCount("✔️")).toBe(1);
    expect(graphemeCount("★")).toBe(1);
    expect(graphemeCount("A")).toBe(1);
  });

  it("counts every illegitimate combination as TWO or more", () => {
    // Ken: "i shouldnt be able to combine emojis with other characters,
    // or multiple emojis".
    expect(graphemeCount("🎈🎈")).toBe(2);
    expect(graphemeCount("🎈A")).toBe(2);
    expect(graphemeCount("AB")).toBe(2);
  });

  it("isSingleGrapheme accepts the combined forms and rejects the combinations", () => {
    expect(isSingleGrapheme("👨‍👩‍👧")).toBe(true);
    expect(isSingleGrapheme("🎈A")).toBe(false);
    expect(isSingleGrapheme("🎈🎈")).toBe(false);
  });
});

describe("IconStringSchema — the one-grapheme rule on a stored icon", () => {
  it("accepts a catalog-id-shaped slug of any length", () => {
    // `circle-check` is 12 graphemes and must stay valid, or every
    // existing config on disk stops parsing.
    expect(IconStringSchema.parse("circle-check")).toBe("circle-check");
    expect(IconStringSchema.parse("list-numbered")).toBe("list-numbered");
  });

  it("accepts a single emoji, including every combined form", () => {
    expect(IconStringSchema.parse("🎈")).toBe("🎈");
    expect(IconStringSchema.parse("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(IconStringSchema.parse("👍🏽")).toBe("👍🏽");
    expect(IconStringSchema.parse("🇬🇧")).toBe("🇬🇧");
    expect(IconStringSchema.parse("✔️")).toBe("✔️");
    expect(IconStringSchema.parse("★")).toBe("★");
  });

  it("REJECTS two emoji, or an emoji glued to a letter", () => {
    expect(IconStringSchema.safeParse("🎈🎈").success).toBe(false);
    expect(IconStringSchema.safeParse("🎈A").success).toBe(false);
    // A non-slug run of letters is not a catalog id and is not one
    // character either.
    expect(IconStringSchema.safeParse("🎈 balloon").success).toBe(false);
  });

  it("still rejects blank and whitespace-only icons", () => {
    expect(IconStringSchema.safeParse("").success).toBe(false);
    expect(IconStringSchema.safeParse("  ").success).toBe(false);
  });
});

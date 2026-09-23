/**
 * K104/UI-14 — telling an emoji from a colourable character, and telling
 * "one character" from "several", without a hand-maintained list.
 *
 * Ken, 2026-09-23, on why a list is not acceptable: *"as people add more
 * emojis, i dont want to keep updating this list"*. Both predicates below
 * are therefore **engine built-ins that track the Unicode version the
 * runtime ships**, not tables in this repo. A new Unicode release brings
 * new emoji with it and nothing here changes.
 *
 * Availability (checked against every target before relying on them):
 *  - `Intl.Segmenter` — Node 16+, and Baseline in every current browser.
 *    The repo's floor is `engines.node >= 20` (root/CLI/MCP package.json)
 *    and the client is an ES2022 bundle, so it is present everywhere
 *    this module runs. There is deliberately NO regex fallback: a regex
 *    cannot segment a ZWJ sequence, and a silent wrong answer here is
 *    worse than a loud absence.
 *  - `\p{Emoji_Presentation}` — a Unicode character property available to
 *    any `u`-flagged regex since ES2018.
 */

/**
 * True when `s` renders as a colour emoji, so a tint cannot apply to it.
 *
 * Ken, 2026-09-22 (UI-14): *"perhaps icons can also have colours as part
 * of it, but emojis, just use the emoji itself (because we can't add
 * colour)"*.
 *
 * ## Why `Emoji_Presentation` and NOT `Extended_Pictographic`
 *
 * These two properties disagree on exactly the characters that matter,
 * and the intuitive-sounding one is the wrong one:
 *
 * | Char | `Extended_Pictographic` | `Emoji_Presentation` | Renders as |
 * |---|---|---|---|
 * | 🎈 ☕ | true | **true** | colour emoji |
 * | ★ ✓ → ⭑ Ⓐ | true (★) / false | **false** | text, in `currentColor` |
 *
 * `★` is pictographic but has TEXT presentation by default: it paints in
 * `currentColor` and therefore *can* be tinted. A check built on
 * `Extended_Pictographic` would wrongly call it an emoji and disable the
 * colour control on a character the user can perfectly well colour.
 *
 * ## The U+FE0F edge case
 *
 * `✔️` is `✔` (U+2714, text presentation, `Emoji_Presentation` false)
 * followed by U+FE0F, the VARIATION SELECTOR-16 — which *forces* colour
 * emoji rendering. The property alone gets this wrong, so the rule is
 * `Emoji_Presentation` **OR** the string ends with U+FE0F.
 *
 * Tested against the whole table above in `icon.test.ts`.
 */
export function isEmojiPresentation(s: string): boolean {
  if (s.length === 0) return false;
  // U+FE0F anywhere at the end forces emoji presentation on the base
  // character, regardless of that character's own default.
  if (s.endsWith("\uFE0F")) return true;
  return /\p{Emoji_Presentation}/u.test(s);
}

/**
 * True when `s` is exactly ONE user-perceived character (a grapheme
 * cluster).
 *
 * Ken, 2026-09-23: *"we need to detect 'one character' but that needs to
 * also be compatible with emojis that are combined data together, and all
 * these weird emoji modifiers, but i shouldnt be able to combine emojis
 * with other characters, or multiple emojis"*.
 *
 * That is precisely the definition of a grapheme cluster, so the check is
 * `Intl.Segmenter`'s and not ours. Neither `.length` (UTF-16 units) nor
 * `[...s].length` (code points) works: 👨‍👩‍👧 is 8 code units and 5 code
 * points, yet one character.
 *
 * | Input | Graphemes | Accepted |
 * |---|---|---|
 * | 🎈 · 👨‍👩‍👧 (ZWJ) · 👍🏽 (skin tone) · 🇬🇧 (flag) · 🏳️‍🌈 · ✔️ · ★ · A | 1 | yes |
 * | 🎈🎈 (two emoji) · 🎈A (emoji+letter) · AB | 2 | no |
 *
 * Every legitimate combined form counts as one; every illegitimate
 * combination counts as two or more. That is the whole rule.
 */
export function graphemeCount(s: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;
}

/** True when `s` is exactly one grapheme cluster. See {@link graphemeCount}. */
export function isSingleGrapheme(s: string): boolean {
  return graphemeCount(s) === 1;
}

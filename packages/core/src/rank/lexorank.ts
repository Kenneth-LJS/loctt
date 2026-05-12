/**
 * Minimal lexorank-style ordering for ranks expressed as base-36
 * lowercase strings. The algorithm is intentionally narrower than
 * Atlassian's published version: we don't expose the bucket prefix
 * (Atlassian uses `0|`, `1|`, `2|` to allow a "move to a fresh
 * bucket" rebalance shortcut). For LocTT's scale (handful to
 * hundreds of items per ordering context), a pure string ordering
 * with periodic local rebalance is sufficient.
 *
 * Properties
 *  - Ranks compare lexicographically, matching their string sort.
 *  - `MIN` and `MAX` bound the value space so inserts at the start
 *    or end always have room to compute a midpoint.
 *  - `between(a, b)` returns a string strictly between `a` and `b`,
 *    growing in length only when adjacent ranks have no integer gap
 *    at their existing precision.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;          // 36
const LAST = ALPHABET.charAt(BASE - 1); // 'z'

/** The lower bound. No rank ever equals MIN — it's a sentinel. */
export const MIN = "0";
/** The upper bound. No rank ever equals MAX — it's a sentinel. */
export const MAX = "z";

/**
 * Returns the lexorank for a fresh insert at the very end of an
 * empty ordering. Spaced midway so two more inserts at the end
 * still produce short strings.
 */
export const INITIAL = "u";

function digitValue(ch: string): number {
  if (ch === "") return 0;
  const v = ALPHABET.indexOf(ch);
  if (v === -1) {
    throw new Error(`invalid lexorank digit: ${ch}`);
  }
  return v;
}

/**
 * Compares two ranks lexicographically. Identical to native string
 * compare; provided as a named export for clarity at call sites.
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Computes a string strictly between `a` and `b` in the lexorank
 * ordering. `a` must be lexicographically less than `b`. Pass
 * `MIN` for "before everything" and `MAX` for "after everything".
 *
 * The output is the shortest possible midpoint. When the inputs
 * are at the same length and have no integer gap, the algorithm
 * recursively descends one digit at a time, growing the string by
 * a single character per descent.
 *
 * Examples
 *  - between("a", "c") → "b"
 *  - between("a", "b") → "am"  (no integer gap; appends midpoint of next digit)
 *  - between(MIN, "a") → "0i"  (recurse from the empty prefix)
 *  - between("y", MAX) → "yi"  (avoid landing on "z" itself)
 *
 * Postcondition: the result is non-empty, strictly greater than
 * `a`, strictly less than `b`, and never ends in `'0'` (a trailing
 * zero is a "phantom min" that breaks future descents into
 * matching zero pads).
 */
export function between(a: string, b: string): string {
  if (compare(a, b) >= 0) {
    throw new Error(`between: lower bound must be less than upper bound (${a} >= ${b})`);
  }
  const result = betweenInner(a, b);
  // Defense-in-depth: the algorithm's recursive descent assumes
  // results never trail in '0' (otherwise future between(prev, "..0")
  // descends into matching zeros forever). Belt-and-braces assertions.
  if (result.length === 0 || result.endsWith("0")) {
    throw new Error(
      `between(${a}, ${b}) produced an invalid rank "${result}"`,
    );
  }
  if (compare(a, result) >= 0 || compare(result, b) >= 0) {
    throw new Error(
      `between(${a}, ${b}) produced "${result}" which is not strictly between the bounds`,
    );
  }
  return result;
}

function betweenInner(a: string, b: string): string {

  // Walk both strings in lockstep, building the result digit by
  // digit. When digits diverge, take the midpoint of the gap.
  let i = 0;
  let result = "";
  while (true) {
    const aDigit = i < a.length ? digitValue(a.charAt(i)) : 0;        // pad with 0
    const bDigit = i < b.length ? digitValue(b.charAt(i)) : BASE;     // pad with one-past-max

    if (aDigit === bDigit) {
      // Same digit at this position — copy and descend.
      result += ALPHABET[aDigit];
      i += 1;
      continue;
    }

    // There's a gap between aDigit and bDigit (possibly equal to 1).
    if (bDigit - aDigit > 1) {
      const mid = aDigit + Math.floor((bDigit - aDigit) / 2);
      result += ALPHABET[mid];
      return result;
    }

    // Adjacent digits, no integer gap. Take aDigit + descend into
    // the rest of `a`, treating its remaining suffix as the lower
    // bound (since b's remaining suffix is "0000..." conceptually).
    result += ALPHABET[aDigit];
    i += 1;
    // Append a midpoint between the rest of `a` (or empty) and the
    // top of the digit space. This always produces a digit > 0
    // (because we're past `aDigit`), so the new rank is strictly
    // greater than `a` and strictly less than `b`.
    const aRest = i < a.length ? a.slice(i) : "";
    return result + midpointAfter(aRest);
  }
}

/**
 * Returns the shortest string `s` such that `aRest + ANY === aRest`
 * lexicographically and `(prefix) + s` is still less than `(prefix) + (next-digit) + 0...`.
 *
 * In practice: if `aRest` is empty, return the midpoint digit `i`.
 * Otherwise we need to step one digit further than `aRest` allows.
 */
function midpointAfter(aRest: string): string {
  if (aRest === "") {
    return "i"; // midpoint of full digit space
  }
  // Find the first digit in aRest that isn't already at the top
  // of the alphabet. Append that-plus-one (or descend recursively).
  let i = 0;
  let prefix = "";
  while (i < aRest.length) {
    const d = digitValue(aRest.charAt(i));
    if (d < BASE - 1) {
      const mid = d + Math.floor((BASE - d) / 2);
      return prefix + ALPHABET[mid];
    }
    prefix += LAST;
    i += 1;
  }
  // `aRest` was all 'z's — append a fresh midpoint digit.
  return prefix + "i";
}

/**
 * Default rank length threshold. Reorders that produce ranks
 * longer than this are followed by a local rebalance of the
 * surrounding window.
 */
export const REBALANCE_LENGTH_THRESHOLD = 24;

/**
 * Spreads `count` items evenly across the lexorank space. Used by
 * `rebalanceRanks` to redistribute a window after it grows long.
 *
 * The chosen ranks are simple: `M0...0`, `M0...1`, etc. — short
 * strings spaced by one digit. They span roughly the middle 1/3
 * of the value space so subsequent inserts at either end have
 * plenty of room.
 */
export function evenlySpacedRanks(count: number): string[] {
  if (count < 1) return [];
  // Single-item case: align with INITIAL so a freshly-rebalanced
  // singleton matches a fresh insert into an empty ordering.
  if (count === 1) return [INITIAL];
  // Use the middle of the alphabet as the base, spread items so
  // their first-digit positions stay distinct.
  const out: string[] = [];
  if (count <= BASE - 2) {
    // Pick digits centered in the alphabet so we leave room before
    // and after for future inserts.
    const start = Math.floor((BASE - count) / 2);
    // Defensive: start must be ≥ 1 so we never produce a rank of
    // '0', which is a phantom prefix of any longer rank starting
    // with the same first digit. Given the `count <= BASE - 2`
    // guard above, `start` is always ≥ 1 — but assert so a future
    // tweak to the bound can't silently regress this.
    if (start < 1) {
      throw new Error(`evenlySpacedRanks: derived start=${start} < 1 (count=${count}, BASE=${BASE})`);
    }
    for (let i = 0; i < count; i += 1) {
      out.push(ALPHABET.charAt(start + i));
    }
    return out;
  }
  // Wider counts: fall back to two-digit ranks. Layout: aa, ab,
  // ac, … reserving aa-style spacing.
  const totalSlots = BASE * BASE;
  if (count > totalSlots) {
    throw new Error(`evenlySpacedRanks: count too large (${count} > ${totalSlots})`);
  }
  const stride = Math.floor(totalSlots / count);
  for (let i = 0; i < count; i += 1) {
    const slot = i * stride + Math.floor(stride / 2);
    const hi = Math.floor(slot / BASE);
    let lo = slot % BASE;
    // Avoid a trailing '0' digit. A two-digit rank ending in '0'
    // is a phantom prefix of any longer rank starting with the
    // same hi digit and would break `between` descents into
    // matching zero pads. Clamp to 1 (effectively "halfway through
    // the slot, not at its boundary").
    if (lo === 0) lo = 1;
    out.push(ALPHABET.charAt(hi) + ALPHABET.charAt(lo));
  }
  return out;
}

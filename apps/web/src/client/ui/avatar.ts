/**
 * Avatar presentation helpers shared by the header avatar, the user
 * switcher menu, and (later) assignee cells.
 *
 * The mockup assigns each user one of five tonal avatar palettes
 * (`avatar--a` … `avatar--e`) deterministically from their id, so the
 * same user always gets the same colour across the app. We reproduce
 * that here as Tailwind class strings rather than the mockup's CSS
 * classes, keeping styling in-utility.
 */

/**
 * Up to two uppercase initials from a display name. A single-word name
 * uses its first two letters ("Madonna" → "MA"); a multi-word name
 * uses the first letter of its first and last words ("Ken Loh" → "KL").
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return "?";
  const last = parts[parts.length - 1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/**
 * The five avatar palettes from the mockup (`avatar--a` … `--e`),
 * as `[bg, fg]` Tailwind arbitrary-value classes. Dark mode is handled
 * by the tokens layer for surfaces; these tonal chips read fine on
 * both themes (light tints with dark text), matching the mockup which
 * keeps avatar tints constant across themes.
 */
const PALETTES = [
  "bg-[#DBEAFE] text-[#1E40AF]", // a — blue
  "bg-[#FEE2E2] text-[#991B1B]", // b — red
  "bg-[#DCFCE7] text-[#14532D]", // c — green
  "bg-[#FEF3C7] text-[#78350F]", // d — amber
  "bg-[#F3E8FF] text-[#5B21B6]", // e — purple
] as const;

/**
 * Deterministically maps a user id to one of the five palettes. Uses a
 * simple DJB2-style hash so the choice is stable and well-spread
 * across ids without pulling in a hashing dependency.
 */
export function avatarPalette(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTES[hash % PALETTES.length] ?? PALETTES[0];
}

// `PALETTES[0]` is statically known to exist (the tuple is non-empty),
// so the `?? PALETTES[0]` fallback above always yields a string.

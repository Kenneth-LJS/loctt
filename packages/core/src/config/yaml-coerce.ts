/**
 * Coerces YAML-parsed values into a shape that the contract zod
 * schemas expect:
 *
 * - Date objects become YYYY-MM-DD strings (YAML can parse
 *   `2026-01-01` either as a string or as a Date depending on
 *   stringifier flavour; we always end up with a string).
 *
 * Walks objects/arrays recursively. Returns the same value for
 * non-mapped types.
 */
export function coerceYaml(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) {
    return value.map(coerceYaml);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = coerceYaml(v);
    }
    return out;
  }
  return value;
}

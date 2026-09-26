/**
 * Narrows `T | null | undefined` to `T`, failing the test by name when
 * the value is missing.
 *
 * Replaces the non-null assertion (`x!`) in specs: `x!` fails later and
 * obliquely (`undefined < "u"` is simply `false`, a `null` box throws a
 * TypeError on `.width`), while this fails at the read, saying which
 * value was absent. Inside `expect(...).toPass()` the throw is retried
 * like any other failed assertion.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be defined, got ${String(value)}`);
  }
  return value;
}

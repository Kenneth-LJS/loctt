import { parse as parseYaml } from "yaml";

/**
 * Thrown by config-loaders when the underlying YAML text fails to
 * parse (unterminated string, malformed flow, tab indentation,
 * etc.). Keeping this as a distinct error class lets callers
 * disambiguate "file unparseable" from "file parsed but failed
 * schema validation" (which surfaces as the loader's own *ConfigError).
 *
 * Includes the wrapped library error's message so the line/column
 * hint from the `yaml` package isn't lost.
 */
export class YamlSyntaxError extends Error {
  constructor(label: string, cause: unknown) {
    const inner = cause instanceof Error ? cause.message : String(cause);
    super(`${label}: malformed YAML: ${inner}`);
    this.name = "YamlSyntaxError";
  }
}

/**
 * Parses YAML text, rethrowing any parser error as a
 * {@link YamlSyntaxError} tagged with the provided file label. Use
 * this instead of `yaml.parse` directly in config loaders so a
 * corrupt file produces a clean, attributed error rather than a
 * raw library exception.
 */
export function safeParseYaml(yamlContent: string, fileLabel: string): unknown {
  try {
    return parseYaml(yamlContent);
  } catch (err) {
    throw new YamlSyntaxError(fileLabel, err);
  }
}

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

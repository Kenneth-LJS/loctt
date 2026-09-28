/**
 * `${…}` references in case files.
 *
 * - `${task.<slug>.key}` / `${task.<slug>.id}` — a seed task, from
 *   `seed-index.json` (the seed's ids are not deterministic, so cases
 *   never hard-code one). The same shape works for every seed section:
 *   `user`, `label`, `milestone`, `sprint`, `project`, `view`, `comment`.
 * - `${var.<name>}` / `${var.<name>.key}` — a value captured by an
 *   earlier step (see `capture` in schema.ts).
 * - `${root}` — the temp tracker's root directory.
 *
 * An unknown reference is an error, never an empty string: a typo that
 * interpolated to "" would make `task_absent: ""` pass vacuously.
 */

export type SeedIndex = Record<string, unknown> & {
  readonly current_user: string;
  readonly task: Record<string, { id: string; key: string; title: string }>;
};

export interface VarContext {
  readonly seed: SeedIndex;
  readonly vars: Record<string, string | Record<string, string>>;
  readonly root: string;
}

function lookup(expr: string, ctx: VarContext): string {
  if (expr === "root") return ctx.root;
  const parts = expr.split(".");
  let cur: unknown = parts[0] === "var" ? ctx.vars : ctx.seed;
  const walk = parts[0] === "var" ? parts.slice(1) : parts;
  for (const p of walk) {
    if (cur === null || typeof cur !== "object" || !(p in cur)) {
      throw new Error(`unknown reference \${${expr}}`);
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === "string" || typeof cur === "number") return String(cur);
  if (cur !== null && typeof cur === "object" && "key" in cur) return String((cur as { key: unknown }).key);
  if (cur !== null && typeof cur === "object" && "id" in cur) return String((cur as { id: unknown }).id);
  throw new Error(`reference \${${expr}} is not a value`);
}

export function interpolate<T>(value: T, ctx: VarContext): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => lookup(expr.trim(), ctx)) as T;
  }
  if (Array.isArray(value)) return (value as unknown[]).map(v => interpolate(v, ctx)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, ctx)])) as T;
  }
  return value;
}

/**
 * Splits a command line into argv, shell-style: whitespace separates,
 * single quotes are literal, double quotes allow `\"` and `\\`, and a
 * backslash outside quotes escapes the next character. No globbing, no
 * variables — `${…}` is resolved per token afterwards, so a value with
 * spaces never needs re-quoting.
 */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inToken = false;
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null; else cur += ch;
      continue;
    }
    if (quote === "\"") {
      if (ch === "\"") { quote = null; continue; }
      if (ch === "\\" && (line[i + 1] === "\"" || line[i + 1] === "\\")) { cur += line[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch; inToken = true; continue; }
    if (ch === "\\" && i + 1 < line.length) { cur += line[++i]; inToken = true; continue; }
    if (/\s/.test(ch)) {
      if (inToken) { out.push(cur); cur = ""; inToken = false; }
      continue;
    }
    cur += ch;
    inToken = true;
  }
  if (quote !== null) throw new Error(`unterminated ${quote} in command line: ${line}`);
  if (inToken) out.push(cur);
  return out;
}

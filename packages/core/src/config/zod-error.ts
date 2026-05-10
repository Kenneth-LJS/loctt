import type { z } from "zod";

/**
 * Renders a zod ZodError into the same shape as the previous
 * hand-rolled assertion errors: a single sentence with a path and
 * a message, semicolon-separated for multi-issue errors.
 *
 *   labels[0].key must be a slug (...), got: 1bad; labels[1].label must be a non-empty string
 *
 * `prefix` is what to call the root in the error if a top-level
 * issue happens (e.g. "labels config", "task frontmatter").
 */
export function formatZodIssues(prefix: string, err: z.ZodError): string {
  if (err.issues.length === 0) return `${prefix} is invalid`;
  return err.issues
    .map(issue => {
      const path = issue.path.length === 0 ? prefix : issue.path
        .map(seg => (typeof seg === "number" ? `[${seg}]` : `.${String(seg)}`))
        .join("")
        .replace(/^\./, "");
      return `${path} ${issue.message}`;
    })
    .join("; ");
}

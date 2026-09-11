import { z } from "zod";

import { SlugKey } from "./brands.js";
import { BrokenEntrySchema } from "./health.js";

/**
 * A single project definition. A LocTT tracker can host multiple
 * projects, each with its own task-key prefix and counter. Tasks
 * belong to exactly one project (via `TaskFrontmatter.project`,
 * which holds the project's ULID).
 *
 *  - `id` is a ULID generated at creation, immutable, never shown
 *    to users. Tasks reference projects by id.
 *  - `name` is the human display name. Editable. Not unique
 *    (disambiguated by id when ambiguous).
 *  - `slug` is the stable user-facing handle that URLs carry
 *    (`?project=web`) and that the CLI and MCP accept wherever they
 *    accept a project. Unique across projects, generated from the
 *    name at creation, and **immutable thereafter** — see K3 and
 *    decisions.md A60. Optional because trackers created before the
 *    slug existed have none on disk; `projectSlug()` derives a
 *    display value for those, and resolution still accepts the ULID.
 *  - `prefix` is the task-key prefix (e.g. `BACKEND-`, `WEB-`).
 *    Unique across projects. Not editable through `editProject`,
 *    because changing it has to rename every task in the project —
 *    `setProjectPrefix` does that as one transaction.
 *  - `archived` hides the project; hard-delete (with explicit
 *    remap) moves the counter to LocttState.retired_keys.
 */
export const ProjectDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: SlugKey.optional(),
  prefix: z.string().min(1),
  archived: z.boolean().optional(),
}).strict();
export type ProjectDef = z.infer<typeof ProjectDefSchema>;

/**
 * The full projects.yaml shape.
 *
 * `default` (when present) is a project id. Stale references are
 * rejected at parse time so the file always reflects a coherent state.
 */
export const ProjectsConfigSchema = z.object({
  // XS-62 wants the constraint *and* the fix. A tracker with no
  // project cannot allocate a key, so this is not a preference — and
  // the user editing `projects.yaml` by hand is exactly who needs to
  // be told what to add rather than only what is wrong.
  projects: z.array(ProjectDefSchema).min(
    1,
    "at least one project is required — add one to projects.yaml, "
    + "or run 'loctt project create'",
  ),
  default: z.string().optional(),
  /**
   * Per-entry corruption, if any — a project whose fields no longer
   * validate (a hand edit, most often) becomes a `BrokenEntry` rather
   * than blanking the whole projects surface (north-star principle 5,
   * the VUE-22 pattern generalized). Omitted (not `[]`) when every entry
   * parsed, so a consumer reading only `projects` is unaffected and "no
   * broken projects" stays distinct from "not inspected". A load-time
   * diagnostic only — never serialized back to disk. The loader parses
   * the file through a separate raw schema that has no `broken` key, so
   * a stray `broken:` in a hand-edited file is still rejected.
   *
   * Attached by `parseProjectsConfig` after the fact, not by this
   * schema's own validation: object-fatal problems (not a list, unknown
   * keys, duplicate ids/prefixes/slugs, an archived default) still throw.
   */
  broken: z.array(BrokenEntrySchema).optional(),
}).strict().superRefine((cfg, ctx) => {
  const seenIds = new Set<string>();
  // Name the *first* holder of a duplicated value, not just the second
  // one: XS-63 wants both entries that carry it, so the user can tell
  // which two lines of the file to reconcile.
  const firstByPrefix = new Map<string, ProjectDef>();
  const firstBySlug = new Map<string, ProjectDef>();
  for (const [i, p] of cfg.projects.entries()) {
    if (seenIds.has(p.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate project id: ${p.id}`, path: ["projects", i, "id"] });
    }
    seenIds.add(p.id);
    const priorPrefix = firstByPrefix.get(p.prefix);
    if (priorPrefix) {
      ctx.addIssue({
        code: "custom",
        message:
          `duplicate project prefix: ${p.prefix} — prefixes must be unique so task keys are unambiguous. `
          + `Held by "${priorPrefix.name}" and "${p.name}"`,
        path: ["projects", i, "prefix"],
      });
    } else {
      firstByPrefix.set(p.prefix, p);
    }
    if (p.slug !== undefined) {
      const priorSlug = firstBySlug.get(p.slug);
      if (priorSlug) {
        ctx.addIssue({
          code: "custom",
          message:
            `duplicate project slug: ${p.slug} — slugs must be unique so a URL names one project. `
            + `Held by "${priorSlug.name}" and "${p.name}"`,
          path: ["projects", i, "slug"],
        });
      } else {
        firstBySlug.set(p.slug, p);
      }
    }
  }
  // K23: a `default:` naming a project that no longer exists is NOT a
  // parse-time rejection. It is out-of-band drift — a rename or a
  // hand-edit left the pointer stale — and per north-star principle 5
  // one bad value must not blank the whole projects surface. A ghost
  // default is tolerated at load; resolution ignores it and falls
  // through to the unique-single-project rung, then to NEW-19's ask
  // state, and the drift is surfaced as a notice (see
  // `projectDefaultIsGhost` in core, and the `default_drift` field on
  // GET /api/projects). This matches VUE-22 (a broken saved view is
  // listed, not fatal) and PRU-25 (a dangling user ref degrades).
  //
  // Note the deliberate asymmetry with the archived case below: an
  // *archived* default names a project that DOES exist but is hidden
  // from every picker — new tasks would silently land somewhere the
  // user cannot see. That is a live, resolvable destination pointed at
  // wrongly, so it stays a hard error. A ghost default resolves to
  // nothing and is caught by the resolver's existence check instead.
  const defaultProject = cfg.projects.find(p => p.id === cfg.default);
  if (defaultProject?.archived === true) {
    ctx.addIssue({
      code: "custom",
      // The error formatter prepends the failing key's path ("default"),
      // so the message must NOT begin with "default project" or it reads
      // "default default project …" (the doubling this wording avoids).
      message:
        `names the archived project '${defaultProject.name}' — new tasks would `
        + `land in a project hidden from every picker. Unarchive it or pick another default.`,
      path: ["default"],
    });
  }
});
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

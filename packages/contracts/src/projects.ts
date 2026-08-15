import { z } from "zod";

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
  projects: z.array(ProjectDefSchema).min(1, "at least one project is required"),
  default: z.string().optional(),
}).strict().superRefine((cfg, ctx) => {
  const ids = new Set(cfg.projects.map(p => p.id));
  const seenIds = new Set<string>();
  const seenPrefixes = new Set<string>();
  for (const [i, p] of cfg.projects.entries()) {
    if (seenIds.has(p.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate project id: ${p.id}`, path: ["projects", i, "id"] });
    }
    seenIds.add(p.id);
    if (seenPrefixes.has(p.prefix)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate project prefix: ${p.prefix} — prefixes must be unique so task keys are unambiguous`,
        path: ["projects", i, "prefix"],
      });
    }
    seenPrefixes.add(p.prefix);
  }
  if (cfg.default !== undefined && !ids.has(cfg.default)) {
    ctx.addIssue({
      code: "custom",
      message: `default project '${cfg.default}' is not in the projects list`,
      path: ["default"],
    });
  }
});
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

import { z } from "zod";

import { SlugKey } from "./brands.js";

/**
 * A single project definition. A LocTT tracker can host multiple
 * projects, each with its own key prefix and counter. Tasks belong
 * to exactly one project (via `TaskFrontmatter.project`).
 *
 *  - `key` is the immutable internal identifier (slug).
 *  - `label` is the human display name; editable.
 *  - `prefix` is the task-key prefix (e.g. `BACKEND-`, `WEB-`);
 *    immutable after creation.
 *  - `archived` hides the project; hard-delete (with explicit
 *    remap) moves the counter to LocttState.retired_keys.
 */
export const ProjectDefSchema = z.object({
  key: SlugKey,
  label: z.string().min(1),
  prefix: z.string().min(1),
  archived: z.boolean().optional(),
}).strict();
export type ProjectDef = z.infer<typeof ProjectDefSchema>;

/** The full projects.yaml shape. */
export const ProjectsConfigSchema = z.object({
  projects: z.array(ProjectDefSchema).min(1, "at least one project is required"),
  default: z.string().optional(),
}).strict().superRefine((cfg, ctx) => {
  const keys = new Set(cfg.projects.map(p => p.key));
  // Uniqueness checks.
  const seenKeys = new Set<string>();
  const seenPrefixes = new Set<string>();
  for (const [i, p] of cfg.projects.entries()) {
    if (seenKeys.has(p.key)) {
      ctx.addIssue({ code: "custom", message: `duplicate project key: ${p.key}`, path: ["projects", i, "key"] });
    }
    seenKeys.add(p.key);
    if (seenPrefixes.has(p.prefix)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate project prefix: ${p.prefix} — prefixes must be unique so task keys are unambiguous`,
        path: ["projects", i, "prefix"],
      });
    }
    seenPrefixes.add(p.prefix);
  }
  if (cfg.default !== undefined && !keys.has(cfg.default)) {
    ctx.addIssue({
      code: "custom",
      message: `default project '${cfg.default}' is not in the projects list`,
      path: ["default"],
    });
  }
});
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

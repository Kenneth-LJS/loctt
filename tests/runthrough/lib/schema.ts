/**
 * The runthrough case format (K144), as a zod schema.
 *
 * Every case file is validated against this on load; an unknown key is
 * an error (strict objects throughout), so a misspelt check cannot
 * silently check nothing.
 *
 * Any string anywhere in a case may carry `${…}` references — see
 * `vars.ts` for the namespaces.
 */

import { z } from "zod";

const Ref = z.string().min(1);
const Json = z.unknown();

/** A comparison used by the field-shaped checks. Exactly one must be set. */
const Comparison = {
  equals: Json.optional(),
  contains: Json.optional(),
  absent: z.literal(true).optional(),
  matches: z.string().optional(),
};

function exactlyOneComparison(v: object): boolean {
  const rec = v as Record<string, unknown>;
  // `equals: null` counts as given: null is a legitimate expectation.
  return ["equals", "contains", "absent", "matches"].filter(k => rec[k] !== undefined).length === 1;
}

const FieldCheck = z.strictObject({
  task: Ref,
  /** A frontmatter key (`status`), `fields.<key>` for a custom field, or `body`. */
  field: z.string().min(1),
  ...Comparison,
}).refine(exactlyOneComparison, "field: give exactly one of equals / contains / absent / matches");

const WhereValue = z.union([
  z.strictObject({ in: z.array(Json) }),
  z.strictObject({ absent: z.literal(true) }),
  z.strictObject({ present: z.literal(true) }),
  Json,
]);

export const CheckSchema = z.union([
  z.strictObject({ task_exists: Ref }),
  z.strictObject({ task_absent: Ref }),
  z.strictObject({ field: FieldCheck }),
  z.strictObject({
    relationship: z.strictObject({
      task: Ref,
      type: z.string().min(1),
      target: Ref,
      present: z.boolean().default(true),
    }),
  }),
  z.strictObject({
    relationship_order: z.strictObject({
      task: Ref,
      type: z.string().min(1),
      targets: z.array(Ref).min(1),
    }),
  }),
  z.strictObject({ bilateral: Ref }),
  z.strictObject({
    count: z.strictObject({
      where: z.record(z.string(), WhereValue).default({}),
      archived: z.enum(["exclude", "include", "only"]).default("exclude"),
      equals: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    comment: z.strictObject({
      task: Ref,
      id: z.string().optional(),
      contains: z.string().optional(),
      author: z.string().optional(),
      mentions: z.array(z.string()).optional(),
      edited: z.boolean().optional(),
      present: z.boolean().default(true),
    }),
  }),
  z.strictObject({ comment_count: z.strictObject({ task: Ref, equals: z.number().int().nonnegative() }) }),
  z.strictObject({
    attachment: z.strictObject({
      task: Ref,
      name: z.string().min(1),
      present: z.boolean().default(true),
      content: z.string().optional(),
    }),
  }),
  z.strictObject({
    entity: z.strictObject({
      kind: z.enum(["project", "label", "milestone", "sprint", "user", "view"]),
      name: z.string().min(1),
      present: z.boolean().default(true),
      fields: z.record(z.string(), Json).optional(),
    }),
  }),
  z.strictObject({
    yaml: z.strictObject({
      /** Relative to `.loctt/`. */
      file: z.string().min(1),
      /** Dotted path; `[k=v]` selects a list element by a field. */
      path: z.string().default(""),
      ...Comparison,
    }).refine(exactlyOneComparison, "yaml: give exactly one of equals / contains / absent / matches"),
  }),
  z.strictObject({ file_unchanged: z.string().min(1) }),
  z.strictObject({ tracker_unchanged: z.literal(true) }),
  z.strictObject({
    output: z.strictObject({
      /** Only on this surface (outputs differ: CLI prints text, MCP JSON). */
      surface: z.enum(["cli", "mcp"]).optional(),
      contains: z.array(z.string()).optional(),
      not_contains: z.array(z.string()).optional(),
      in_order: z.array(z.string()).min(2).optional(),
      /** The task keys the result lists, as a set. */
      keys: z.array(z.string()).optional(),
    }),
  }),
]);
export type Check = z.infer<typeof CheckSchema>;

export const McpCallSchema = z.strictObject({
  tool: z.string().min(1),
  args: z.record(z.string(), Json).default({}),
});
export type McpCall = z.infer<typeof McpCallSchema>;

const McpSchema = z.strictObject({
  call: z.union([McpCallSchema, z.array(McpCallSchema).min(1)]),
});

const CaptureSchema = z.union([
  /** The task that did not exist before this step (optionally by title). */
  z.strictObject({ new_task: z.strictObject({ title: z.string().optional() }) }),
  /** The comment on `task` that did not exist before this step. */
  z.strictObject({ new_comment: z.strictObject({ task: Ref }) }),
  /** A label/milestone/sprint/project/user/view by name: captures its id. */
  z.strictObject({
    entity: z.strictObject({
      kind: z.enum(["project", "label", "milestone", "sprint", "user", "view"]),
      name: z.string().min(1),
    }),
  }),
  /** The first group of a regex over the action's output. */
  z.strictObject({ output: z.string().min(1) }),
]);
export type Capture = z.infer<typeof CaptureSchema>;

const ExpectErrorSchema = z.strictObject({
  cli: z.strictObject({
    exit_code: z.number().int().positive().default(1),
    message: z.string().optional(),
  }).optional(),
  mcp: z.strictObject({
    message: z.string().optional(),
  }).optional(),
});
export type ExpectError = z.infer<typeof ExpectErrorSchema>;

const Surface = z.enum(["cli", "mcp"]);
export type SurfaceName = z.infer<typeof Surface>;

/** One action on the tracker plus what must hold afterwards. */
const StepFields = {
  cli: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  mcp: McpSchema.optional(),
  capture: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), CaptureSchema).optional(),
  post: z.array(CheckSchema).default([]),
  expect_error: ExpectErrorSchema.optional(),
};

export const StepSchema = z.strictObject({
  name: z.string().min(1),
  ...StepFields,
});
export type Step = z.infer<typeof StepSchema>;

const Base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id: lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  surfaces: z.array(Surface).min(1).default(["cli", "mcp"]),
  /** Files written under the temp root before `pre` (path → content). */
  setup_files: z.record(z.string(), z.string()).optional(),
  /**
   * Text edits to the seed copy before `pre` — for states no loctt
   * command can produce (a one-sided link for the repair tests). `file`
   * is relative to `.loctt/`; `find` must occur exactly once.
   */
  setup_patch: z.array(z.strictObject({
    file: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
  })).optional(),
  /**
   * Doctor findings a known product bug produces. Matching findings do
   * not fail the step; a pattern that matches nothing in the whole case
   * DOES fail it ("fixed? remove this entry"), so the list cannot rot.
   */
  known_doctor_findings: z.array(z.strictObject({
    match: z.string().min(1),
    bug: z.string().min(1),
  })).optional(),
  pre: z.array(CheckSchema).default([]),
  /** A `.ts` module (relative to the case file) exporting `(tracker, ctx) => void`. */
  check_script: z.string().optional(),
  /**
   * Known product bug: the case is expected to FAIL on these surfaces
   * until the bug is fixed (reported, not fixed, by the harness). The
   * runner marks it expected-to-fail, so it turns red once it passes.
   */
  known_bug: z.partialRecord(Surface, z.string().min(1)).optional(),
};

export const CaseSchema = z.union([
  z.strictObject({ ...Base, ...StepFields }),
  z.strictObject({ ...Base, steps: z.array(StepSchema).min(1), post: z.array(CheckSchema).default([]) }),
]);
export type CaseFile = z.infer<typeof CaseSchema>;

/** A case after normalisation: always a list of steps. */
export interface Case {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly surfaces: readonly SurfaceName[];
  readonly setupFiles: Readonly<Record<string, string>>;
  readonly setupPatch: ReadonlyArray<{ file: string; find: string; replace: string }>;
  readonly knownDoctorFindings: ReadonlyArray<{ match: string; bug: string }>;
  readonly pre: readonly Check[];
  readonly steps: readonly Step[];
  readonly checkScript?: string;
  readonly knownBug: Partial<Record<SurfaceName, string>>;
  readonly scenario: boolean;
  /** Absolute path of the YAML file, for messages and `check_script`. */
  readonly file: string;
}

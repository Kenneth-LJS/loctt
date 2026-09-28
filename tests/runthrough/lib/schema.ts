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
  /** A file or directory under the temp root (not `.loctt/`) exists or not. */
  z.strictObject({ path: z.strictObject({ path: z.string().min(1), exists: z.boolean() }) }),
  /**
   * A git ref in the tracker's repository (`repo: local`, the default) or
   * its bare remote (`repo: remote`) resolves — or, with `exists: false`,
   * does not. `not_equals` also requires its commit to differ from a
   * captured one (a branch that advanced).
   */
  z.strictObject({
    git: z.strictObject({
      ref: z.string().min(1),
      repo: z.enum(["local", "remote"]).default("local"),
      exists: z.boolean().default(true),
      not_equals: z.string().optional(),
    }),
  }),
  /** `git show <spec>` in the tracker's repository contains the text. */
  z.strictObject({ git_show: z.strictObject({ spec: z.string().min(1), contains: z.string() }) }),
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
      /** How many output lines match `matches` (a regex). */
      line_count: z.strictObject({ matches: z.string().min(1), equals: z.number().int().nonnegative() }).optional(),
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
  /** The commit a git ref points at in the tracker's repository. */
  z.strictObject({ git_rev: z.string().min(1) }),
]);
export type Capture = z.infer<typeof CaptureSchema>;

const ExpectErrorSchema = z.strictObject({
  cli: z.strictObject({
    exit_code: z.number().int().positive().default(1),
    message: z.string().optional(),
    /**
     * The command changed some tasks and exited non-zero for the rest (a
     * bulk op reporting per-task failures, K153): the tracker is *not*
     * asserted unchanged; `post` says what changed.
     */
    partial: z.boolean().optional(),
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
  /**
   * Run this step on one surface whatever surface the case is running
   * on — a scenario that writes through one surface and reads through
   * the other (the CLI ⇄ MCP interop journey). `via: mcp` starts the MCP
   * session for the case even on its `cli` run.
   */
  via: z.enum(["cli", "mcp"]).optional(),
  /**
   * An action no loctt command can perform (a push to the remote from
   * another clone): a `.ts` module, relative to the case file, whose
   * default export `({ root, vars }) => Promise<string | void>` runs
   * instead of `cli` / `mcp`. Its return value is the step's output.
   */
  script: z.string().min(1).optional(),
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
  /**
   * Which seed the case starts from. `current` (the default) is the
   * checked-in seed at the code's format; `0.1.0` is the frozen copy at
   * format 0.1.0 (`tests/fixtures/trackers/seed-0.1.0/`), for the upgrade
   * cases (B41). Same ids, keys and index either way. `empty` is a
   * tracker `loctt init` just made (prefix `T`, no tasks), and `none` an
   * empty directory — for the journeys folded in from `tests/e2e` (B43),
   * which start from nothing and name their own keys.
   */
  seed: z.enum(["current", "0.1.0", "empty", "none"]).default("current"),
  /**
   * Make the temp root a git repository (`local`), and also give it a
   * bare `origin` (`remote`, at `${var.remote}`), before `pre` — for the
   * git-backed journeys. The loctt tracker itself comes from `seed`.
   */
  git: z.enum(["local", "remote"]).optional(),
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
  readonly seed: "current" | "0.1.0" | "empty" | "none";
  readonly git?: "local" | "remote";
  readonly steps: readonly Step[];
  readonly checkScript?: string;
  readonly knownBug: Partial<Record<SurfaceName, string>>;
  readonly scenario: boolean;
  /** Absolute path of the YAML file, for messages and `check_script`. */
  readonly file: string;
}

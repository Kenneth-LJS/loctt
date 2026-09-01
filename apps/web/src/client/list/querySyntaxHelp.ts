/**
 * Content for the advanced editor's syntax-help popover (VUE-9).
 *
 * Kept as data rather than JSX so the grammar it claims to document can
 * be asserted against the real tokenizer in a test. Every operator here
 * is a value of core's `OP_TOKEN_MAP`, and every example is required to
 * parse — a help popover that documents a grammar the parser does not
 * accept is worse than none, because the user trusts it.
 *
 * `relationship.*` is deliberately absent. It was removed in `1a2b77d`
 * and `validate.ts` now rejects it by name, pointing at `has_link(…)`
 * instead. Offering it here would teach a grammar the parser refuses.
 */

export interface SyntaxHelpEntry {
  /** The construct, shown in monospace. */
  readonly syntax: string;
  /** What it does, in one line. */
  readonly meaning: string;
  /**
   * A complete query demonstrating it. Asserted to parse, so these
   * double as executable documentation.
   */
  readonly example: string;
}

export interface SyntaxHelpSection {
  readonly title: string;
  readonly entries: readonly SyntaxHelpEntry[];
}

export const QUERY_SYNTAX_HELP: readonly SyntaxHelpSection[] = [
  {
    title: "Operators",
    entries: [
      { syntax: "=", meaning: "equals", example: "status = done" },
      { syntax: "!=", meaning: "does not equal", example: "status != done" },
      { syntax: "<", meaning: "less than", example: "priority < 3" },
      { syntax: "<=", meaning: "at most", example: "due_date <= today" },
      { syntax: ">", meaning: "greater than", example: "priority > 1" },
      { syntax: ">=", meaning: "at least", example: "priority >= 3" },
      { syntax: "~", meaning: "contains (case-insensitive)", example: 'title ~ "login"' },
      { syntax: "in", meaning: "matches any of a list", example: "status in (backlog, done)" },
      { syntax: "not in", meaning: "matches none of a list", example: "status not in (done)" },
    ],
  },
  {
    title: "Combining",
    entries: [
      { syntax: "and", meaning: "both must hold", example: "status = done and priority = high" },
      { syntax: "or", meaning: "either may hold", example: "status = done or status = backlog" },
      { syntax: "not", meaning: "negates a condition", example: "not (status = done)" },
      { syntax: "( )", meaning: "groups conditions", example: "(status = done or priority = high) and assignee = alice" },
    ],
  },
  {
    title: "Aliases",
    entries: [
      { syntax: "text", meaning: "searches title, description and body", example: 'text ~ "spike"' },
      { syntax: "today", meaning: "today's date in the workspace timezone", example: "due_date <= today" },
      { syntax: "parent", meaning: "the task's parent, by key", example: "parent = T-5" },
    ],
  },
  {
    title: "Relationships",
    entries: [
      {
        syntax: "has_link(kind?, target?)",
        meaning: "the task has a matching link; both arguments test a single edge",
        example: 'has_link("blocks")',
      },
      {
        syntax: "link_count(kind?)",
        meaning: "how many links the task has — must be compared to a number",
        example: 'link_count("blocks") > 1',
      },
    ],
  },
  {
    title: "Fields",
    entries: [
      {
        syntax: "fields.<key>",
        meaning: "a custom field from workflow.yaml",
        example: "fields.squad = platform",
      },
      {
        syntax: "status.category",
        meaning: "the status's category, so a query survives renamed statuses",
        example: "status.category not in (completed, discarded)",
      },
    ],
  },
];

/** Flattened examples, for the test that asserts each one parses. */
export const SYNTAX_HELP_EXAMPLES: readonly string[]
  = QUERY_SYNTAX_HELP.flatMap(s => s.entries.map(e => e.example));

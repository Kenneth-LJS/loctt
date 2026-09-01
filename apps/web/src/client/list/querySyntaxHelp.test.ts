import { parseQuery, tokenize, validateQuery } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { QUERY_SYNTAX_HELP, SYNTAX_HELP_EXAMPLES } from "./querySyntaxHelp.ts";

/**
 * The syntax-help popover's *content* (VUE-9). The popover's behaviour
 * (Esc dismissal, preserving the query) is a UI test; what belongs here
 * is the claim the content makes about the grammar, checked against the
 * real tokenizer rather than against the ticket.
 */

const syntaxes = QUERY_SYNTAX_HELP.flatMap(s => s.entries.map(e => e.syntax));

describe("syntax help documents the grammar the parser actually accepts", () => {
  // @verifies VUE-9
  it("every documented example parses", () => {
    expect(SYNTAX_HELP_EXAMPLES.length).toBeGreaterThan(0);
    for (const ex of SYNTAX_HELP_EXAMPLES) {
      expect(() => parseQuery(tokenize(ex)), `example: ${ex}`).not.toThrow();
    }
  });

  // @verifies VUE-9
  it("covers every operator, the connectives, parentheses and the three aliases", () => {
    // The operator list is core's OP_TOKEN_MAP, transcribed. If core
    // grows an operator this test does not fail — but a *documented*
    // operator that core dropped shows up in the example test above.
    for (const op of ["=", "!=", "<", "<=", ">", ">=", "~", "in", "not in"]) {
      expect(syntaxes, `operator ${op}`).toContain(op);
    }
    for (const kw of ["and", "or", "not", "( )"]) {
      expect(syntaxes, `keyword ${kw}`).toContain(kw);
    }
    for (const alias of ["text", "today", "parent"]) {
      expect(syntaxes, `alias ${alias}`).toContain(alias);
    }
  });

  // @verifies VUE-9
  it("covers has_link, link_count, fields.* and status.category", () => {
    expect(syntaxes).toContain("has_link(kind?, target?)");
    expect(syntaxes).toContain("link_count(kind?)");
    expect(syntaxes).toContain("fields.<key>");
    expect(syntaxes).toContain("status.category");
  });

  // @verifies VUE-9
  it("does not offer the removed relationship.* grammar", () => {
    const all = JSON.stringify(QUERY_SYNTAX_HELP);

    // POSITIVE CONTROL. "no relationship.* anywhere" is trivially true
    // of empty content, so first prove the content is populated and
    // does talk about relationships — then that it uses the new form.
    expect(syntaxes.length).toBeGreaterThanOrEqual(20);
    expect(all).toContain("has_link");

    expect(all).not.toContain("relationship.");

    // The constraint is live, not stale: core still rejects the old
    // grammar and still points at has_link. If core ever re-admitted
    // it, this assertion fails and the omission above becomes a
    // deliberate choice to re-examine rather than an inherited one.
    expect(() => validateQuery(parseQuery(tokenize("relationship.type = blocks"))))
      .toThrow(/has_link/);
  });
});

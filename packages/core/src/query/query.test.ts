import { describe, expect,it } from "vitest";

import type { QueryNode } from "./parser.js";
import { ParseError,parseQuery } from "./parser.js";
import { tokenize, TokenizeError } from "./tokenizer.js";

describe("tokenizer", () => {
  it("tokenizes a simple comparison", () => {
    const tokens = tokenize('status = done');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: "FIELD", value: "status" });
    expect(tokens[1]).toMatchObject({ type: "OP_EQ" });
    expect(tokens[2]).toMatchObject({ type: "FIELD", value: "done" });
  });

  it("tokenizes quoted strings", () => {
    const tokens = tokenize('text ~ "hello world"');
    expect(tokens).toHaveLength(3);
    expect(tokens[2]).toMatchObject({ type: "STRING", value: "hello world" });
  });

  it("tokenizes numbers", () => {
    const tokens = tokenize("priority >= 2");
    expect(tokens[2]).toMatchObject({ type: "NUMBER", value: "2" });
  });

  it("tokenizes dates", () => {
    const tokens = tokenize("due_date < 2026-04-16");
    expect(tokens[2]).toMatchObject({ type: "DATE", value: "2026-04-16" });
  });

  it("tokenizes ISO dates with time", () => {
    const tokens = tokenize("created_at > 2026-04-16T14:30:00Z");
    expect(tokens[2]).toMatchObject({ type: "DATE", value: "2026-04-16T14:30:00Z" });
  });

  it("tokenizes boolean literals", () => {
    const tokens = tokenize("archived = true");
    expect(tokens[2]).toMatchObject({ type: "BOOLEAN", value: "true" });
  });

  it("tokenizes today literal", () => {
    const tokens = tokenize("due_date < today");
    expect(tokens[2]).toMatchObject({ type: "TODAY" });
  });

  it("tokenizes and/or/not", () => {
    const tokens = tokenize("status = done and priority = high");
    expect(tokens[3]).toMatchObject({ type: "AND" });
  });

  it("tokenizes not in", () => {
    const tokens = tokenize("status not in (done, blocked)");
    expect(tokens[1]).toMatchObject({ type: "OP_NOT_IN", value: "not in" });
  });

  it("tokenizes in with list", () => {
    const tokens = tokenize('status in (done, blocked)');
    expect(tokens[1]).toMatchObject({ type: "OP_IN" });
    expect(tokens[2]).toMatchObject({ type: "LPAREN" });
  });

  it("tokenizes != and ~", () => {
    const tokens = tokenize('status != done');
    expect(tokens[1]).toMatchObject({ type: "OP_NEQ" });

    const tokens2 = tokenize('title ~ "init"');
    expect(tokens2[1]).toMatchObject({ type: "OP_CONTAINS" });
  });

  it("throws on unterminated string", () => {
    expect(() => tokenize('"hello')).toThrow(TokenizeError);
  });

  it("throws on unexpected character", () => {
    expect(() => tokenize("status @ done")).toThrow(TokenizeError);
  });
});

describe("parser", () => {
  function parse(input: string): QueryNode {
    return parseQuery(tokenize(input));
  }

  it("parses simple comparison", () => {
    const node = parse("status = done");
    expect(node).toEqual({
      type: "comparison",
      field: "status",
      op: "=",
      value: { type: "string", value: "done" },
    });
  });

  it("parses comparison with quoted string", () => {
    const node = parse('title ~ "init flow"');
    expect(node).toEqual({
      type: "comparison",
      field: "title",
      op: "~",
      value: { type: "string", value: "init flow" },
    });
  });

  it("parses comparison with number", () => {
    const node = parse("priority >= 2");
    expect(node).toEqual({
      type: "comparison",
      field: "priority",
      op: ">=",
      value: { type: "number", value: 2 },
    });
  });

  it("parses comparison with date", () => {
    const node = parse("due_date < 2026-04-16");
    expect(node).toEqual({
      type: "comparison",
      field: "due_date",
      op: "<",
      value: { type: "date", value: "2026-04-16" },
    });
  });

  it("parses comparison with today", () => {
    const node = parse("due_date <= today");
    expect(node).toEqual({
      type: "comparison",
      field: "due_date",
      op: "<=",
      value: { type: "today" },
    });
  });

  it("parses and", () => {
    const node = parse("status = done and priority = high");
    expect(node.type).toBe("and");
  });

  it("parses or", () => {
    const node = parse("status = done or status = blocked");
    expect(node.type).toBe("or");
  });

  it("parses not", () => {
    const node = parse("not status = done");
    expect(node.type).toBe("not");
  });

  it("parses in with list", () => {
    const node = parse("status in (done, blocked, not_started)");
    expect(node).toEqual({
      type: "comparison",
      field: "status",
      op: "in",
      value: {
        type: "list",
        values: [
          { type: "string", value: "done" },
          { type: "string", value: "blocked" },
          { type: "string", value: "not_started" },
        ],
      },
    });
  });

  it("parses not in with list", () => {
    const node = parse("status not in (done)");
    expect(node).toEqual({
      type: "comparison",
      field: "status",
      op: "not in",
      value: { type: "list", values: [{ type: "string", value: "done" }] },
    });
  });

  it("parses parenthesized grouping", () => {
    const node = parse("(status = done or status = blocked) and priority = high");
    expect(node.type).toBe("and");
    if (node.type === "and") {
      expect(node.left.type).toBe("or");
    }
  });

  it("respects operator precedence (and binds tighter than or)", () => {
    const node = parse("a = 1 or b = 2 and c = 3");
    // Should parse as: a=1 or (b=2 and c=3)
    expect(node.type).toBe("or");
    if (node.type === "or") {
      expect(node.right.type).toBe("and");
    }
  });

  it("parses the canonical queries from design doc", () => {
    // recent-open
    const n1 = parse("archived != true and status != done");
    expect(n1.type).toBe("and");

    // blocked
    const n2 = parse("archived != true and status = blocked");
    expect(n2.type).toBe("and");

    // text search
    const n3 = parse('text ~ "init"');
    expect(n3.type).toBe("comparison");
  });

  it("throws on empty query", () => {
    expect(() => parseQuery([])).toThrow(ParseError);
  });

  it("throws on unexpected token", () => {
    expect(() => parse("status")).toThrow(ParseError);
  });
});

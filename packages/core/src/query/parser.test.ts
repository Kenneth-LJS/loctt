import { describe, expect,it } from "vitest";

import { ParseError,parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("parseQuery", () => {
  it("parses a simple equality comparison", () => {
    const tokens = tokenize("status = done");
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "status",
      op: "=",
      value: { type: "string", value: "done" },
    });
  });

  it("parses contains operator", () => {
    const tokens = tokenize('text ~ "init"');
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "text",
      op: "~",
      value: { type: "string", value: "init" },
    });
  });

  it("parses boolean value", () => {
    const tokens = tokenize("archived != true");
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "archived",
      op: "!=",
      value: { type: "boolean", value: true },
    });
  });

  it("parses today literal", () => {
    const tokens = tokenize("due_date < today");
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "due_date",
      op: "<",
      value: { type: "today" },
    });
  });

  it("parses AND expression", () => {
    const tokens = tokenize("archived != true and status != done");
    const ast = parseQuery(tokens);
    expect(ast.type).toBe("and");
  });

  it("parses OR expression", () => {
    const tokens = tokenize("status = done or status = blocked");
    const ast = parseQuery(tokens);
    expect(ast.type).toBe("or");
  });

  it("AND binds tighter than OR", () => {
    const tokens = tokenize("a = 1 or b = 2 and c = 3");
    const ast = parseQuery(tokens);
    // Should be: a=1 OR (b=2 AND c=3)
    expect(ast.type).toBe("or");
    if (ast.type === "or") {
      expect(ast.right.type).toBe("and");
    }
  });

  it("parses NOT expression", () => {
    const tokens = tokenize("not status = done");
    const ast = parseQuery(tokens);
    expect(ast.type).toBe("not");
  });

  it("parses parenthesized expression", () => {
    const tokens = tokenize("(a = 1 or b = 2) and c = 3");
    const ast = parseQuery(tokens);
    expect(ast.type).toBe("and");
    if (ast.type === "and") {
      expect(ast.left.type).toBe("or");
    }
  });

  it("parses IN expression", () => {
    const tokens = tokenize("status in (done, blocked)");
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "status",
      op: "in",
      value: {
        type: "list",
        values: [
          { type: "string", value: "done" },
          { type: "string", value: "blocked" },
        ],
      },
    });
  });

  it("parses NOT IN expression", () => {
    const tokens = tokenize("status not in (done)");
    const ast = parseQuery(tokens);
    expect(ast).toEqual({
      type: "comparison",
      field: "status",
      op: "not in",
      value: {
        type: "list",
        values: [{ type: "string", value: "done" }],
      },
    });
  });

  it("parses complex canonical queries", () => {
    // From design doc
    const tokens1 = tokenize("archived != true and status != done");
    const ast1 = parseQuery(tokens1);
    expect(ast1.type).toBe("and");

    const tokens2 = tokenize("archived != true and status = blocked");
    const ast2 = parseQuery(tokens2);
    expect(ast2.type).toBe("and");

    const tokens3 = tokenize('text ~ "init"');
    const ast3 = parseQuery(tokens3);
    expect(ast3.type).toBe("comparison");
  });

  it("throws on empty token array", () => {
    expect(() => parseQuery([])).toThrow(ParseError);
  });

  it("throws on unexpected token", () => {
    const tokens = tokenize("and");
    expect(() => parseQuery(tokens)).toThrow(ParseError);
  });
});

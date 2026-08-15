import { describe, expect,it } from "vitest";

import { ParseError,parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("parseQuery", () => {
  it("parses a simple equality comparison", () => {
    const tokens = tokenize("status = done");
    const ast = parseQuery(tokens);
    expect(ast).toMatchObject({
      type: "comparison",
      field: "status",
      op: "=",
      value: { type: "string", value: "done" },
    });
  });

  it("parses contains operator", () => {
    const tokens = tokenize('text ~ "init"');
    const ast = parseQuery(tokens);
    expect(ast).toMatchObject({
      type: "comparison",
      field: "text",
      op: "~",
      value: { type: "string", value: "init" },
    });
  });

  it("parses boolean value", () => {
    const tokens = tokenize("archived != true");
    const ast = parseQuery(tokens);
    expect(ast).toMatchObject({
      type: "comparison",
      field: "archived",
      op: "!=",
      value: { type: "boolean", value: true },
    });
  });

  it("parses today literal", () => {
    const tokens = tokenize("due_date < today");
    const ast = parseQuery(tokens);
    expect(ast).toMatchObject({
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
    expect(ast).toMatchObject({
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
    expect(ast).toMatchObject({
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

describe("function-call syntax (has_link / link_count)", () => {
  const p = (s: string) => parseQuery(tokenize(s));

  it("parses has_link with 0, 1 and 2 arguments", () => {
    expect(p("has_link()")).toEqual({ type: "has_link", position: 0 });
    expect(p('has_link("blocks")')).toMatchObject({ type: "has_link", kind: "blocks" });
    expect(p('has_link("blocks", "T-2")')).toMatchObject({
      type: "has_link", kind: "blocks", target: "T-2",
    });
  });

  it("accepts unquoted kind names too", () => {
    // Convenience for the common case; quoting is what makes an
    // arbitrary kind name safe, not what makes it parse.
    expect(p("has_link(blocks)")).toMatchObject({ type: "has_link", kind: "blocks" });
  });

  it("rejects too many arguments, naming the arity", () => {
    expect(() => p('has_link("a", "b", "c")')).toThrow(/takes 0–2 argument/);
    expect(() => p('link_count("a", "b") > 1')).toThrow(/takes 0–1 argument/);
  });

  it("parses link_count as a comparison with a call on the left", () => {
    expect(p('link_count("child") > 3')).toMatchObject({
      type: "comparison",
      field: "link_count",
      op: ">",
      call: { name: "link_count", kind: "child" },
      value: { type: "number", value: 3 },
    });
  });

  it("requires link_count to be compared", () => {
    expect(() => p('link_count("child")')).toThrow(/must be compared/);
  });

  it("rejects an unknown function by name", () => {
    expect(() => p('has_links("x")')).toThrow(/unknown function "has_links"/);
  });

  it("composes with and / or / not", () => {
    const node = p('has_link("blocks") and not has_link("parent")');
    expect(node.type).toBe("and");
  });

  it("does not mistake a parenthesised group for a call", () => {
    // `(status = done)` starts with LPAREN, not FIELD LPAREN.
    expect(p("(status = done)").type).toBe("comparison");
    // A field followed by a space and an operator is still a field.
    expect(p("status = done").type).toBe("comparison");
  });
});

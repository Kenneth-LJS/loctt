import { describe, expect,it } from "vitest";

import { tokenize, TokenizeError } from "./tokenizer.js";

describe("tokenize", () => {
  it("tokenizes a simple comparison", () => {
    const tokens = tokenize('status = done');
    expect(tokens).toEqual([
      { type: "FIELD", value: "status", position: 0 },
      { type: "OP_EQ", value: "=", position: 7 },
      { type: "FIELD", value: "done", position: 9 },
    ]);
  });

  it("tokenizes all comparison operators", () => {
    const ops = [
      { input: "=", type: "OP_EQ" },
      { input: "!=", type: "OP_NEQ" },
      { input: "<", type: "OP_LT" },
      { input: "<=", type: "OP_LTE" },
      { input: ">", type: "OP_GT" },
      { input: ">=", type: "OP_GTE" },
      { input: "~", type: "OP_CONTAINS" },
    ] as const;

    for (const { input, type } of ops) {
      const tokens = tokenize(`x ${input} y`);
      expect(tokens[1]?.type).toBe(type);
    }
  });

  it("tokenizes quoted strings", () => {
    const tokens = tokenize('title ~ "hello world"');
    expect(tokens[2]).toEqual({ type: "STRING", value: "hello world", position: 8 });
  });

  it("tokenizes single-quoted strings", () => {
    const tokens = tokenize("title = 'value'");
    expect(tokens[2]).toEqual({ type: "STRING", value: "value", position: 8 });
  });

  it("tokenizes boolean literals", () => {
    const tokens = tokenize("archived = true");
    expect(tokens[2]).toEqual({ type: "BOOLEAN", value: "true", position: 11 });
  });

  it("tokenizes today literal", () => {
    const tokens = tokenize("due_date < today");
    expect(tokens[2]).toEqual({ type: "TODAY", value: "today", position: 11 });
  });

  it("tokenizes numbers", () => {
    const tokens = tokenize("priority > 5");
    expect(tokens[2]).toEqual({ type: "NUMBER", value: "5", position: 11 });
  });

  it("tokenizes and/or/not", () => {
    const tokens = tokenize("a = 1 and b = 2 or not c = 3");
    expect(tokens.map(t => t.type)).toEqual([
      "FIELD", "OP_EQ", "NUMBER",
      "AND",
      "FIELD", "OP_EQ", "NUMBER",
      "OR",
      "NOT",
      "FIELD", "OP_EQ", "NUMBER",
    ]);
  });

  it("tokenizes 'not in' as a single operator", () => {
    const tokens = tokenize("status not in (a, b)");
    expect(tokens[1]).toEqual({ type: "OP_NOT_IN", value: "not in", position: 7 });
  });

  it("tokenizes 'in' operator", () => {
    const tokens = tokenize("status in (a, b)");
    expect(tokens[1]?.type).toBe("OP_IN");
  });

  it("tokenizes parentheses", () => {
    const tokens = tokenize("(a = 1)");
    expect(tokens[0]?.type).toBe("LPAREN");
    expect(tokens[4]?.type).toBe("RPAREN");
  });

  it("throws on unterminated string", () => {
    expect(() => tokenize('"hello')).toThrow(TokenizeError);
  });

  it("throws on unexpected character", () => {
    expect(() => tokenize("a = @")).toThrow(TokenizeError);
  });

  it("handles the canonical queries from the design doc", () => {
    const tokens1 = tokenize('archived != true and status != done');
    expect(tokens1.length).toBeGreaterThan(0);

    const tokens2 = tokenize('text ~ "init"');
    expect(tokens2.length).toBe(3);
  });
});

describe("tokenize — unexpected characters name the fix, not just the character", () => {
  /**
   * `status in [a, b]` is the single most-repeated mistake in this
   * repo's history: it shipped three times on three separate code paths.
   * The catch-all said `unexpected character "["` and nothing else, so a
   * user who wrote a list the way most languages write one got no hint
   * that this DSL uses parentheses.
   */

  it("tells the user lists use parentheses", () => {
    let msg = "";
    try {
      tokenize("status in [backlog, done]");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/\[/);
    expect(msg).toMatch(/parenthes/i);
  });

  it("still reports the position", () => {
    let pos = -1;
    try {
      tokenize("status in [a]");
    } catch (err) {
      pos = (err as TokenizeError).position;
    }
    expect(pos).toBe(10);
  });

  it("leaves other unexpected characters reported plainly", () => {
    // The hint is specific to bracket lists; a stray `@` should not
    // claim parentheses would fix it.
    let msg = "";
    try {
      tokenize("status = @");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/@/);
    expect(msg).not.toMatch(/parenthes/i);
  });
});

import type { Token, TokenType } from "./tokenizer.js";

export type ComparisonOp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "~" | "in" | "not in";

export type QueryNode =
  | { type: "comparison"; field: string; op: ComparisonOp; value: QueryValue }
  | { type: "and"; left: QueryNode; right: QueryNode }
  | { type: "or"; left: QueryNode; right: QueryNode }
  | { type: "not"; operand: QueryNode };

export type QueryValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "today" }
  | { type: "list"; values: readonly QueryValue[] };

export class ParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} at position ${position}`);
    this.name = "ParseError";
  }
}

const OP_TOKEN_MAP: Partial<Record<TokenType, ComparisonOp>> = {
  OP_EQ: "=",
  OP_NEQ: "!=",
  OP_LT: "<",
  OP_LTE: "<=",
  OP_GT: ">",
  OP_GTE: ">=",
  OP_CONTAINS: "~",
  OP_IN: "in",
  OP_NOT_IN: "not in",
};

class Parser {
  private pos = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): QueryNode {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing) {
      throw new ParseError(`unexpected token "${trailing.value}"`, trailing.position);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Position of the last token, for error messages at end-of-input. */
  private endPosition(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.position : 0;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) {
      throw new ParseError("unexpected end of query", this.endPosition());
    }
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.advance();
    if (tok.type !== type) {
      throw new ParseError(`expected ${type} but got "${tok.value}"`, tok.position);
    }
    return tok;
  }

  private parseOr(): QueryNode {
    let left = this.parseAnd();
    while (this.peek()?.type === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): QueryNode {
    let left = this.parseNot();
    while (this.peek()?.type === "AND") {
      this.advance();
      const right = this.parseNot();
      left = { type: "and", left, right };
    }
    return left;
  }

  private parseNot(): QueryNode {
    if (this.peek()?.type === "NOT") {
      this.advance();
      const operand = this.parseNot();
      return { type: "not", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const tok = this.peek();
    if (!tok) {
      throw new ParseError("unexpected end of query", this.endPosition());
    }

    if (tok.type === "LPAREN") {
      this.advance();
      const node = this.parseOr();
      this.expect("RPAREN");
      return node;
    }

    // Must be a comparison: field op value
    if (tok.type === "FIELD") {
      return this.parseComparison();
    }

    throw new ParseError(`expected field name or "(" but got "${tok.value}"`, tok.position);
  }

  private parseComparison(): QueryNode {
    const fieldTok = this.advance();
    const opTok = this.advance();

    const op = OP_TOKEN_MAP[opTok.type];
    if (op === undefined) {
      throw new ParseError(`expected operator but got "${opTok.value}"`, opTok.position);
    }

    const value = this.parseValue(op);
    return { type: "comparison", field: fieldTok.value, op, value };
  }

  private parseValue(op: ComparisonOp): QueryValue {
    if (op === "in" || op === "not in") {
      return this.parseList();
    }
    return this.parseSingleValue();
  }

  private parseSingleValue(): QueryValue {
    const tok = this.advance();
    switch (tok.type) {
      case "STRING":
        return { type: "string", value: tok.value };
      case "NUMBER":
        return { type: "number", value: Number(tok.value) };
      case "BOOLEAN":
        return { type: "boolean", value: tok.value.toLowerCase() === "true" };
      case "DATE":
        return { type: "date", value: tok.value };
      case "TODAY":
        return { type: "today" };
      case "FIELD":
        // Bare word treated as string value
        return { type: "string", value: tok.value };
      default:
        throw new ParseError(`expected value but got "${tok.value}"`, tok.position);
    }
  }

  private parseList(): QueryValue {
    this.expect("LPAREN");
    const values: QueryValue[] = [];
    if (this.peek()?.type !== "RPAREN") {
      values.push(this.parseSingleValue());
      while (this.peek()?.type === "COMMA") {
        this.advance();
        values.push(this.parseSingleValue());
      }
    }
    this.expect("RPAREN");
    return { type: "list", values };
  }
}

/** Parses a token array into a QueryNode AST. */
export function parseQuery(tokens: readonly Token[]): QueryNode {
  if (tokens.length === 0) {
    throw new ParseError("empty query", 0);
  }
  return new Parser(tokens).parse();
}

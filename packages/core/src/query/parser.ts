import { LocttError } from "../errors.js";
import type { DateFn, DateOffset } from "./dates.js";
import { dateFnFromWord, isBoundaryFn, offsetError, parseOffset } from "./dates.js";
import type { Token, TokenType } from "./tokenizer.js";

export type ComparisonOp =
  | "=" | "!=" | "<" | "<=" | ">" | ">=" | "~" | "in" | "not in"
  // K77: presence tests. Postfix — no right-hand value; the value slot
  // carries the `{ type: "empty" }` sentinel so the comparison node shape
  // is uniform.
  | "is empty" | "is not empty";

export type QueryNode =
  // `position` is the offset of the field token, carried so semantic
  // validation (validateQuery) can point at the offending field the
  // same way TokenizeError/ParseError point at syntax problems.
  // Optional so hand-built ASTs in tests don't have to fake offsets.
  | {
      type: "comparison";
      field: string;
      op: ComparisonOp;
      value: QueryValue;
      position?: number;
      /**
       * Set when the left-hand side is `link_count(kind)` rather than a
       * frontmatter field. `field` is then the literal `"link_count"`,
       * which is not a queryable field name, so an evaluator that
       * ignores this reads no value rather than a wrong one.
       */
      call?: { readonly name: "link_count"; readonly kind?: string };
    }
  /**
   * `has_link()` / `has_link(kind)` / `has_link(kind, target)`.
   *
   * Arity picks the question: no args tests "any link at all", one
   * tests existence of a kind, two test a **single edge** matching
   * both. There is deliberately no way to express kind and target as
   * separate conditions — that is what let
   * `relationship.type = blocks and relationship.target = T-10` match
   * two *different* edges while reading as though it matched one.
   *
   * Kind names sit in quoted value position, never as field or
   * sub-field names, so a workspace may name a relationship `type`,
   * `target` or `count` without colliding with the grammar.
   */
  | { type: "has_link"; kind?: string; target?: string; position?: number }
  | { type: "and"; left: QueryNode; right: QueryNode }
  | { type: "or"; left: QueryNode; right: QueryNode }
  | { type: "not"; operand: QueryNode };

export type QueryValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "today" }
  // K80: `currentUser()` — resolved to the querying user's id at
  // evaluation time (see EvalContext.currentUserId).
  | { type: "current_user" }
  // K80: a date function — `now()`, `startOf/endOf Day/Week/Month`, with
  // an optional signed offset (`endOfWeek("+1w")`). Resolved against the
  // evaluator's clock (`ctx.today`/`ctx.now`) and `ctx.weekStartsOn`.
  | { type: "date_fn"; fn: DateFn; offset?: DateOffset | undefined }
  | { type: "list"; values: readonly QueryValue[] }
  // K77: the RHS placeholder for `is empty` / `is not empty`, which take
  // no value. Kept in the value union so a comparison node is uniform.
  | { type: "empty" };

export class ParseError extends LocttError {
  constructor(message: string, public readonly position: number) {
    // A mistyped query is a known, nameable cause — the position and
    // any suggestions are right here. Left as a bare `Error` it reached
    // a surface as `unknown`, which ERR-31 forbids: the generic handler
    // is for causes that genuinely cannot be determined, not a
    // convenience for ones nobody wired up.
    super("validation_failed", `${message} at position ${position}`, {
      field: "query",
      recovery: { kind: "retry" },
    });
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

    // Must be a comparison: field op value, or a function call.
    if (tok.type === "FIELD") {
      // A FIELD immediately followed by `(` is a call, not a field.
      // The tokenizer already emits FIELD LPAREN … RPAREN for these,
      // so no tokenizer change is needed.
      if (this.tokens[this.pos + 1]?.type === "LPAREN") {
        return this.parseCall();
      }
      return this.parseComparison();
    }

    throw new ParseError(`expected field name or "(" but got "${tok.value}"`, tok.position);
  }

  /**
   * `has_link(...)` — a predicate in its own right — or
   * `link_count(...)`, which yields a number and must be compared.
   */
  private parseCall(): QueryNode {
    const nameTok = this.advance();
    const name = nameTok.value;

    if (name === "has_link") {
      const args = this.parseCallArgs(name, 0, 2);
      const [kind, target] = args;
      return {
        type: "has_link",
        ...(kind !== undefined ? { kind } : {}),
        ...(target !== undefined ? { target } : {}),
        position: nameTok.position,
      };
    }

    if (name === "link_count") {
      const args = this.parseCallArgs(name, 0, 1);
      const [kind] = args;
      // Check for end-of-input first: `advance()` would raise its own
      // "unexpected end of query", losing the guidance about what this
      // function needs.
      const opTok = this.peek();
      if (opTok === undefined) {
        throw new ParseError(
          `${name}(...) yields a number and must be compared, e.g. ${name}("child") > 3`,
          this.endPosition(),
        );
      }
      this.advance();
      const op = OP_TOKEN_MAP[opTok.type];
      if (op === undefined) {
        throw new ParseError(
          `${name}(...) yields a number and must be compared, e.g. ${name}("child") > 3`,
          opTok.position,
        );
      }
      const value = this.parseValue(op);
      return {
        type: "comparison",
        field: name,
        op,
        value,
        position: nameTok.position,
        call: { name: "link_count", ...(kind !== undefined ? { kind } : {}) },
      };
    }

    throw new ParseError(
      `unknown function "${name}". Available: has_link(kind?, target?), link_count(kind?)`,
      nameTok.position,
    );
  }

  /**
   * Parses `( "a", "b" )` into its string arguments.
   *
   * Arguments are names: a quoted string, or a bare word the tokenizer
   * emitted as FIELD. Both are accepted, and `has_link(blocks)` works
   * exactly as `has_link("blocks")` does — measured.
   *
   * Numbers and booleans are rejected, because a relationship kind is
   * always a name.
   *
   * This comment used to say bare words were rejected, on the argument
   * that they would "put relationship kind names back into identifier
   * position". The code has always accepted FIELD tokens, so the
   * docstring described a stricter parser than the one below it —
   * which is the dangerous direction: a reader trusts it and quotes
   * defensively, or files a bug when the bare form works.
   */
  private parseCallArgs(fn: string, min: number, max: number): string[] {
    this.expect("LPAREN");
    const args: string[] = [];
    if (this.peek()?.type !== "RPAREN") {
      for (;;) {
        const tok = this.advance();
        if (tok.type !== "STRING" && tok.type !== "FIELD") {
          throw new ParseError(
            `${fn}(...) takes quoted names, got "${tok.value}"`,
            tok.position,
          );
        }
        args.push(tok.value);
        if (this.peek()?.type !== "COMMA") break;
        this.advance();
      }
    }
    const close = this.peek();
    this.expect("RPAREN");
    if (args.length < min || args.length > max) {
      throw new ParseError(
        `${fn}(...) takes ${min === max ? `${min}` : `${min}–${max}`} argument(s), got ${args.length}`,
        close?.position ?? this.endPosition(),
      );
    }
    return args;
  }

  private parseComparison(): QueryNode {
    const fieldTok = this.advance();
    const opTok = this.advance();

    // K77: `is empty` / `is not empty` are postfix — no right-hand value.
    if (opTok.type === "OP_IS_EMPTY" || opTok.type === "OP_IS_NOT_EMPTY") {
      const op: ComparisonOp = opTok.type === "OP_IS_EMPTY" ? "is empty" : "is not empty";
      return {
        type: "comparison",
        field: fieldTok.value,
        op,
        value: { type: "empty" },
        position: fieldTok.position,
      };
    }

    const op = OP_TOKEN_MAP[opTok.type];
    if (op === undefined) {
      throw new ParseError(`expected operator but got "${opTok.value}"`, opTok.position);
    }

    const value = this.parseValue(op);
    // K77: `field = null` / `field != null` (and `= none`) are the presence
    // test people reach for, but `null` here is just a string value, so the
    // filter silently matched everything (the original bug). Reject with a
    // pointer to the real operator.
    if ((op === "=" || op === "!=") && value.type === "string") {
      const v = value.value.toLowerCase();
      if (v === "null" || v === "none") {
        const suggestion = op === "=" ? "is empty" : "is not empty";
        throw new ParseError(
          `use "${fieldTok.value} ${suggestion}" to test for an ${op === "=" ? "unset" : "set"} field — `
          + `"${op} ${value.value}" compares against the literal text "${value.value}"`,
          opTok.position,
        );
      }
    }
    return { type: "comparison", field: fieldTok.value, op, value, position: fieldTok.position };
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
      case "CURRENT_USER":
        // Accept and discard an optional `()` — `currentUser` and
        // `currentUser()` both mean the same value. Only a bare `(` with
        // no closing `)` is an error, caught by `expect`.
        if (this.peek()?.type === "LPAREN") {
          this.advance();
          this.expect("RPAREN");
        }
        return { type: "current_user" };
      case "FIELD": {
        // K80: a date function in value position — `startOfWeek("+1w")`
        // arrives as FIELD LPAREN STRING? RPAREN. Only when the word names
        // a date function AND a `(` follows: a bare `startOfWeek` (or any
        // other word) stays a plain string value, unchanged.
        const fn = dateFnFromWord(tok.value);
        if (fn !== null && this.peek()?.type === "LPAREN") {
          return this.parseDateFn(fn, tok.position);
        }
        // Bare word treated as string value
        return { type: "string", value: tok.value };
      }
      default:
        throw new ParseError(`expected value but got "${tok.value}"`, tok.position);
    }
  }

  /**
   * Parses a date function's `( "offset"? )` after its name token was
   * consumed. `now()` takes no offset; the boundary functions take an
   * optional signed offset string (`"+1w"`). Bad offsets and a stray
   * argument raise `ParseError` at the argument's position.
   */
  private parseDateFn(fn: DateFn, fnPosition: number): QueryValue {
    this.expect("LPAREN");
    if (this.peek()?.type === "RPAREN") {
      this.advance();
      return { type: "date_fn", fn };
    }
    // A non-empty argument list: only a single quoted offset is allowed,
    // and only on a boundary function.
    const arg = this.advance();
    if (arg.type !== "STRING") {
      throw new ParseError(
        `${fn}() takes a quoted offset like "+1w", not "${arg.value}"`,
        arg.position,
      );
    }
    if (!isBoundaryFn(fn)) {
      throw new ParseError(`now() takes no offset`, fnPosition);
    }
    const problem = offsetError(arg.value);
    if (problem !== null) throw new ParseError(problem, arg.position);
    this.expect("RPAREN");
    return { type: "date_fn", fn, offset: parseOffset(arg.value) };
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

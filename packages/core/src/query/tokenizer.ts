import { LocttError } from "../errors.js";
export type TokenType =
  | "FIELD"
  | "STRING"
  | "NUMBER"
  | "DATE"
  | "BOOLEAN"
  | "TODAY"
  | "OP_EQ"
  | "OP_NEQ"
  | "OP_LT"
  | "OP_LTE"
  | "OP_GT"
  | "OP_GTE"
  | "OP_CONTAINS"
  | "OP_IN"
  | "OP_NOT_IN"
  | "AND"
  | "OR"
  | "NOT"
  | "LPAREN"
  | "RPAREN"
  | "COMMA";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
}

export class TokenizeError extends LocttError {
  constructor(message: string, public readonly position: number) {
    // As ParseError: a known cause with a position, so it must not
    // reach a surface as `unknown` (ERR-31).
    super("validation_failed", `${message} at position ${position}`, {
      field: "query",
      recovery: { kind: "retry" },
    });
    this.name = "TokenizeError";
  }
}

const KEYWORD_MAP: Record<string, TokenType> = {
  and: "AND",
  or: "OR",
  not: "NOT",
  in: "OP_IN",
  true: "BOOLEAN",
  false: "BOOLEAN",
  today: "TODAY",
};

const TWO_CHAR_OPS: Record<string, TokenType> = {
  "!=": "OP_NEQ",
  "<=": "OP_LTE",
  ">=": "OP_GTE",
};

const ONE_CHAR_OPS: Record<string, TokenType> = {
  "=": "OP_EQ",
  "<": "OP_LT",
  ">": "OP_GT",
  "~": "OP_CONTAINS",
  "(": "LPAREN",
  ")": "RPAREN",
  ",": "COMMA",
};

function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_.\-]/.test(ch);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input.charAt(i);

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = "";
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          i++;
          value += input[i];
        } else {
          value += input[i];
        }
        i++;
      }
      if (i >= input.length) {
        throw new TokenizeError(`unterminated string`, start);
      }
      i++; // skip closing quote
      tokens.push({ type: "STRING", value, position: start });
      continue;
    }

    // Two-character operators
    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      const twoCharType = TWO_CHAR_OPS[twoChar];
      if (twoCharType) {
        tokens.push({ type: twoCharType, value: twoChar, position: i });
        i += 2;
        continue;
      }
    }

    // One-character operators
    const oneCharType = ONE_CHAR_OPS[ch];
    if (oneCharType) {
      tokens.push({ type: oneCharType, value: ch, position: i });
      i++;
      continue;
    }

    // Numbers and dates (both start with digits)
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < input.length && /[0-9]/.test(input.charAt(i + 1)))) {
      const start = i;
      if (ch === "-") i++;
      while (i < input.length && /[0-9.\-T:Z]/.test(input.charAt(i))) {
        i++;
      }
      const raw = input.slice(start, i);
      // Date pattern: YYYY-MM-DD with optional time
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        // Shape is not validity. `2024-13-45` matched the regex, became
        // a DATE token, and then compared against nothing — so a typo'd
        // date returned an empty result that reads as a real answer.
        const [y, m, d] = raw.slice(0, 10).split("-").map(Number) as [number, number, number];
        const probe = new Date(Date.UTC(y, m - 1, d));
        if (
          probe.getUTCFullYear() !== y
          || probe.getUTCMonth() !== m - 1
          || probe.getUTCDate() !== d
        ) {
          throw new TokenizeError(`'${raw.slice(0, 10)}' is not a real date`, start);
        }
        tokens.push({ type: "DATE", value: raw, position: start });
      } else {
        tokens.push({ type: "NUMBER", value: raw, position: start });
      }
      continue;
    }

    // Words (field names, keywords)
    if (isWordChar(ch)) {
      const start = i;
      while (i < input.length && isWordChar(input.charAt(i))) {
        i++;
      }
      const word = input.slice(start, i);
      const lower = word.toLowerCase();

      // "not in" is a two-word operator
      if (lower === "not") {
        // Peek ahead for "in"
        let j = i;
        while (j < input.length && (input.charAt(j) === " " || input.charAt(j) === "\t")) {
          j++;
        }
        if (j < input.length) {
          const nextStart = j;
          let nextEnd = j;
          while (nextEnd < input.length && isWordChar(input.charAt(nextEnd))) {
            nextEnd++;
          }
          if (input.slice(nextStart, nextEnd).toLowerCase() === "in") {
            tokens.push({ type: "OP_NOT_IN", value: "not in", position: start });
            i = nextEnd;
            continue;
          }
        }
      }

      const keywordType = KEYWORD_MAP[lower];
      if (keywordType) {
        tokens.push({ type: keywordType, value: word, position: start });
      } else {
        tokens.push({ type: "FIELD", value: word, position: start });
      }
      continue;
    }

    // `status in [a, b]` is the most-repeated mistake against this DSL —
    // it shipped three times on three separate code paths. The bare
    // "unexpected character" told a user who wrote a list the way most
    // languages write one nothing about how to write it here.
    if (ch === "[" || ch === "]") {
      throw new TokenizeError(
        `unexpected character "${ch}" — lists use parentheses, e.g. status in (backlog, done)`,
        i,
      );
    }

    // The C-style boolean operators are what most people reach for
    // first, and a bare "unexpected character" gives them nothing to
    // act on — the DSL spells them as words.
    const BOOLEAN_ALIASES: Record<string, string> = {
      "&": "and", "|": "or", "!": "not",
    };
    const wordForm = BOOLEAN_ALIASES[ch];
    if (wordForm !== undefined) {
      const doubled = input.slice(i, i + 2);
      const typed = doubled === "&&" || doubled === "||" ? doubled : ch;
      throw new TokenizeError(
        `unexpected character "${typed}" — use '${wordForm}', e.g. `
        + `status = done ${wordForm === "not" ? "and not (…)" : `${wordForm} priority = high`}`,
        i,
      );
    }

    throw new TokenizeError(`unexpected character "${ch}"`, i);
  }

  return tokens;
}

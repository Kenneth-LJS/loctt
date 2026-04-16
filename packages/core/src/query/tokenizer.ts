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

export class TokenizeError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} at position ${position}`);
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
    const ch = input[i]!;

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
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < input.length && /[0-9]/.test(input[i + 1]!))) {
      const start = i;
      if (ch === "-") i++;
      while (i < input.length && /[0-9.\-T:Z]/.test(input[i]!)) {
        i++;
      }
      const raw = input.slice(start, i);
      // Date pattern: YYYY-MM-DD with optional time
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        tokens.push({ type: "DATE", value: raw, position: start });
      } else {
        tokens.push({ type: "NUMBER", value: raw, position: start });
      }
      continue;
    }

    // Words (field names, keywords)
    if (isWordChar(ch)) {
      const start = i;
      while (i < input.length && isWordChar(input[i]!)) {
        i++;
      }
      const word = input.slice(start, i);
      const lower = word.toLowerCase();

      // "not in" is a two-word operator
      if (lower === "not") {
        // Peek ahead for "in"
        let j = i;
        while (j < input.length && (input[j] === " " || input[j] === "\t")) {
          j++;
        }
        if (j < input.length) {
          const nextStart = j;
          let nextEnd = j;
          while (nextEnd < input.length && isWordChar(input[nextEnd]!)) {
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

    throw new TokenizeError(`unexpected character "${ch}"`, i);
  }

  return tokens;
}

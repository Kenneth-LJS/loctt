/**
 * Reads the `Cases:` lines out of TEMP-WEB-TICKETS.md.
 *
 * Phase 1 of the autonomous plan moves case selection out of build time: each
 * ticket declares the cases it is responsible for, and `cases:coverage
 * --require` reads that line rather than a list the building agent chose for
 * itself. This module is the reader; `main.ts` is the gate over it.
 *
 * Strict for the same reason the case-index parser is: a `Cases:` line that
 * does not parse is an error, not a skipped ticket. A silently dropped ticket
 * takes its whole case list out of the completeness check, and the gate would
 * then pass by covering less.
 */

export interface Ticket {
  /** Ticket ID as written in the heading, e.g. "M2.1". */
  readonly id: string;
  /** Title text after the ID, e.g. "Task detail — read shell". */
  readonly title: string;
  /** 1-indexed line of the `###` heading. */
  readonly line: number;
  /** Case IDs from the ticket's `Cases:` line. Empty when it has none. */
  readonly cases: readonly string[];
  /** True when a `Cases:` line was present at all (even if empty). */
  readonly declared: boolean;
}

export interface Unplaceable {
  readonly id: string;
  readonly reason: string;
  readonly line: number;
}

export interface Partition {
  readonly tickets: readonly Ticket[];
  /**
   * Cases the partitioning agent could not assign, from the `## Unplaceable
   * cases` section. Listing one is a legitimate outcome; omitting it silently
   * is what the gate exists to catch.
   */
  readonly unplaceable: readonly Unplaceable[];
}

/** `### M2.1 · Task detail — read shell ⬜` */
const TICKET_HEADING = /^###\s+(M\d+\.\d+)\s+·\s+(.+?)\s*$/;
/** `Cases: TSK-1, TSK-2, TSK-3` */
const CASES_LINE = /^Cases:\s*(.*)$/;
/** `- LST-7 — needs a decision on whether pinning is M1 or M4` */
const UNPLACEABLE_LINE = /^-\s+([A-Z0-9]+-C?\d+)\s+—\s+(.+?)\s*$/;
const UNPLACEABLE_HEADING = /^##\s+Unplaceable cases\s*$/;
/** Trailing status glyphs are part of the heading, not the title. */
const STATUS_GLYPHS = /[⬜🔵⚠️✅🚦]/gu;

export function parsePartition(source: string): Partition {
  const lines = source.split("\n");
  const tickets: Ticket[] = [];
  const unplaceable: Unplaceable[] = [];

  let current: { id: string; title: string; line: number } | undefined;
  let cases: string[] | undefined;
  let inUnplaceable = false;

  const flush = (): void => {
    if (current === undefined) return;
    tickets.push({
      id: current.id,
      title: current.title,
      line: current.line,
      cases: cases ?? [],
      declared: cases !== undefined,
    });
    current = undefined;
    cases = undefined;
  };

  for (const [i, raw] of lines.entries()) {
    const line = raw.trimEnd();
    const lineNo = i + 1;

    if (UNPLACEABLE_HEADING.test(line)) {
      flush();
      inUnplaceable = true;
      continue;
    }

    const heading = TICKET_HEADING.exec(line);
    if (heading !== null) {
      const [, id = "", title = ""] = heading;
      flush();
      inUnplaceable = false;
      current = { id, title: title.replace(STATUS_GLYPHS, "").trim(), line: lineNo };
      continue;
    }

    // A `##` heading ends the current ticket; `###` is handled above.
    if (line.startsWith("## ")) {
      flush();
      inUnplaceable = false;
      continue;
    }

    if (inUnplaceable) {
      const entry = UNPLACEABLE_LINE.exec(line);
      if (entry !== null) {
        const [, id = "", reason = ""] = entry;
        unplaceable.push({ id, reason, line: lineNo });
      }
      continue;
    }

    const declared = CASES_LINE.exec(line);
    if (declared !== null && current !== undefined) {
      if (cases !== undefined) {
        throw new Error(
          `${current.id} (line ${String(lineNo)}): a second "Cases:" line. ` +
            `One ticket declares its cases once — two lines means one of them ` +
            `is not being read by the gate.`,
        );
      }
      cases = (declared[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  flush();
  return { tickets, unplaceable };
}

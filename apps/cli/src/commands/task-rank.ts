import { boardMove, reorderBoardRank, reorderRelationship, resolveLocttDir } from "@loctt/core";

import { getArg, rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";

/**
 * `loctt rerank <source> <relationship> <target>` — re-order one
 * sibling among a relationship's targets. Pass at most one of
 * `--before` or `--after`; without either, the edge moves to the end.
 */
/**
 * Accepted flags per command. `getArg`/`hasFlag` are pure extractors and
 * cannot notice a flag nobody asked about, so without this an unknown
 * option is silently dropped and the command runs without it.
 */
const RERANK_FLAGS: readonly string[] = ["--after", "--before"];
const BOARD_RERANK_FLAGS: readonly string[] = ["--after", "--before"];
const BOARD_MOVE_FLAGS: readonly string[] = ["--after", "--before", "--status"];

export async function rerank(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, RERANK_FLAGS);
  const source = args[1];
  const relationship = args[2];
  const target = args[3];
  if (!source || !relationship || !target) {
    throw new UsageError(
      "missing source, relationship, or target",
      "loctt rerank <source> <relationship> <target> [--before <task>] [--after <task>]",
    );
  }
  const before = getArg(args, "--before");
  const after = getArg(args, "--after");
  if (before !== undefined && after !== undefined) {
    throw new UsageError("--before and --after are mutually exclusive; pass at most one");
  }
  const result = await reorderRelationship({
    locttDir: resolveLocttDir(root),
    sourceRef: source,
    relationshipType: relationship,
    targetRef: target,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
  console.log(`Reranked ${target} under ${source}/${relationship} (rank=${result.rank})`);
  if (result.rebalanced) {
    console.log(`(also rebalanced sibling ranks)`);
  }
}

/**
 * `loctt board-rerank <task>` — re-order a task within its board
 * column. Same `--before` / `--after` mutex as `rerank`.
 */
export async function boardRerank(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, BOARD_RERANK_FLAGS);
  const task = args[1];
  if (!task) {
    throw new UsageError(
      "missing task",
      "loctt board-rerank <task> [--before <task>] [--after <task>]",
    );
  }
  const before = getArg(args, "--before");
  const after = getArg(args, "--after");
  if (before !== undefined && after !== undefined) {
    throw new UsageError("--before and --after are mutually exclusive; pass at most one");
  }
  const result = await reorderBoardRank({
    locttDir: resolveLocttDir(root),
    taskRef: task,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
  console.log(`Reranked ${task} on board (rank=${result.rank})`);
  if (result.rebalanced) {
    console.log(`(also rebalanced sibling ranks)`);
  }
}

/**
 * `loctt board-move <task> --status <status>` — move a card to
 * another board column and position it there, in **one** write.
 *
 * K11: `boardMove` lived in core with only the web calling it. A CLI
 * user crossing a column boundary had to run `loctt set <task> status`
 * and then `loctt board-rerank <task>` — two writes, and a failure
 * between them leaves the card in a column whose stored status
 * contradicts it. That non-atomicity is the whole reason `boardMove`
 * exists (BRD-41, XS-9), so the CLI could not express the operation
 * the core op was built for.
 *
 * Unlike `board-rerank`, `--before` and `--after` are **not** mutually
 * exclusive here: a drop lands between two neighbours, and BRD-32
 * requires the rank to be interpolated against the pair the user saw.
 * `board-rerank` keeps its mutex because `reorderBoardRank` refuses
 * both; this command routes to `boardMove`, which takes them as
 * bounds.
 */
export async function boardMoveCmd(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, BOARD_MOVE_FLAGS);
  const task = args[1];
  if (!task) {
    throw new UsageError(
      "missing task",
      "loctt board-move <task> [--status <status>] [--before <task>] [--after <task>]",
    );
  }
  const status = getArg(args, "--status");
  const before = getArg(args, "--before");
  const after = getArg(args, "--after");
  const result = await boardMove({
    locttDir: resolveLocttDir(root),
    taskRef: task,
    ...(status !== undefined ? { status } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
  const where = status === undefined
    ? "within its column"
    : `to ${result.task.frontmatter.status}`;
  console.log(`Moved ${task} ${where} (rank=${result.rank})`);
  if (result.rebalanced) {
    console.log(`(also rebalanced sibling ranks)`);
  }
}

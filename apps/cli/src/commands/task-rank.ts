import { reorderBoardRank, reorderRelationship, resolveLocttDir } from "@loctt/core";

import { getArg } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";

/**
 * `loctt rerank <source> <relationship> <target>` — re-order one
 * sibling among a relationship's targets. Pass at most one of
 * `--before` or `--after`; without either, the edge moves to the end.
 */
export async function rerank(args: string[], root: string): Promise<void> {
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

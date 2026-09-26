/**
 * Rank-reorder tools — both adjust a lexorank string. The
 * `before`/`after` mutex is enforced here (at the boundary) so
 * the agent gets a clearer error than letting core's reorder
 * functions sort it out.
 *
 * Domain errors from core surface as `errorResult` via the
 * dispatcher's outer catch (isKnownDomainError covers
 * ReorderError); the explicit try/catch in the legacy handlers
 * was redundant.
 */

import { boardMove, reorderBoardRank, reorderRelationship } from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "reorder_relationship",
    description: "Reorder a relationship target within one source task's links of a given type. Pass exactly one of `before` or `after` to position the target relative to a sibling, or neither to move it to the end.",
    inputSchema: {
      source: z.string().describe("Source task key or ID"),
      type: z.string().describe("Relationship type (e.g. parent)"),
      target: z.string().describe("Target task key or ID being moved"),
      before: z.string().optional().describe("Sibling target to position before"),
      after: z.string().optional().describe("Sibling target to position after"),
    },
    handler: async ({ locttDir }, args) => {
      const before = args["before"] as string | undefined;
      const after = args["after"] as string | undefined;
      if (before !== undefined && after !== undefined) {
        return errorResult("`before` and `after` are mutually exclusive; pass at most one");
      }
      const result = await reorderRelationship({
        locttDir,
        sourceRef: args["source"] as string,
        relationshipType: args["type"] as string,
        targetRef: args["target"] as string,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "reorder_board",
    description: "Reorder a task's position on the board (its `board_rank`). Pass exactly one of `before` or `after` to position the task relative to a sibling, or neither to move it to the end of its column. The board column is implicit: the task stays in its current status; this only changes its order within that column. A column is a group of tickets, not a status: where `workflow.yaml`'s `boards` block collapses several statuses into one column, `before`/`after` accept any task in that column whatever its status. Each column is its own sequence, so \"the end\" means the end of that column.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      before: z.string().optional().describe("Sibling task to position before"),
      after: z.string().optional().describe("Sibling task to position after"),
    },
    handler: async ({ locttDir }, args) => {
      const before = args["before"] as string | undefined;
      const after = args["after"] as string | undefined;
      if (before !== undefined && after !== undefined) {
        return errorResult("`before` and `after` are mutually exclusive; pass at most one");
      }
      const result = await reorderBoardRank({
        locttDir,
        taskRef: args["ref"] as string,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "move_board_card",
    description: "Move a task to another board column AND position it there in a SINGLE write. Prefer this over calling `update_task` for `status` followed by `reorder_board`: those are two writes, and a failure between them leaves the task in a column its stored status contradicts. Pass `status` to cross a column boundary; omit it to reposition within the task's current column. `before` is the task the moved task lands ABOVE, `after` the one it lands BELOW; unlike `reorder_board` these are NOT mutually exclusive. Passing both interpolates a rank between that pair. Passing neither appends to the end of the destination column. A column is a group of tickets, not a status: where `workflow.yaml`'s `boards` block collapses several statuses into one column, the anchors may carry any status in that column.",
    inputSchema: {
      ref: z.string().describe("Task key or ID being moved"),
      status: z.string().optional().describe("Destination status. Omit for an intra-column reposition, which writes `board_rank` only and leaves `status` untouched."),
      before: z.string().optional().describe("Task the moved task lands above"),
      after: z.string().optional().describe("Task the moved task lands below"),
    },
    handler: async ({ locttDir }, args) => {
      const status = args["status"] as string | undefined;
      const before = args["before"] as string | undefined;
      const after = args["after"] as string | undefined;
      const result = await boardMove({
        locttDir,
        taskRef: args["ref"] as string,
        ...(status !== undefined ? { status } : {}),
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      // The whole task would bury the two fields that changed in
      // forty lines of frontmatter; the agent asked to move a card.
      return text(JSON.stringify({
        key: result.task.frontmatter.key,
        status: result.task.frontmatter.status,
        board_rank: result.rank,
        rebalanced: result.rebalanced,
      }, null, 2));
    },
  },
];

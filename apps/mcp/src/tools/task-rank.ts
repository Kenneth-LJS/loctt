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

import { reorderBoardRank, reorderRelationship } from "@loctt/core";
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
    description: "Reorder a task's position on the board (its `board_rank`). Pass exactly one of `before` or `after` to position the task relative to a sibling, or neither to move it to the end of its column. The board column is implicit — the task stays in its current status; this only changes its order within that column. A column is a group of tickets, not a status: where `workflow.yaml`'s `boards` block collapses several statuses into one column, `before`/`after` accept any task in that column whatever its status. Each column is its own sequence, so \"the end\" means the end of that column.",
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
];

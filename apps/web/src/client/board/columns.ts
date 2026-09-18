/**
 * Board column derivation — re-exported from core.
 *
 * The implementation moved to `@loctt/core` under K8: a column is a
 * group of tickets, and `board_rank` is ordered within a column, so
 * core's write path has to derive columns the same way the board
 * draws them. See `packages/core/src/board/columns.ts` for why.
 *
 * Imported from the module directly, **not** through `@loctt/core`'s
 * barrel: the barrel pulls in core's filesystem paths module, and
 * `node:path` has no browser build — routing this through it fails the
 * client bundle with `"resolve" is not exported by
 * "__vite-browser-external"`. `board/columns.js` is pure logic over
 * types and imports nothing from node.
 */
export type { BoardColumn, ColumnKind, ColumnTask } from "@loctt/core/board/columns.js";
export {
  bucketTasks,
  deriveColumns,
  ORPHAN_COLUMN_ID,
  sortColumn,
  UNCOVERED_COLUMN_ID,
} from "@loctt/core/board/columns.js";

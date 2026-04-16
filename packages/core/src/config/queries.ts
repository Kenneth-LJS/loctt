import { readFile } from "node:fs/promises";

import type { QueriesConfig } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";

import { getQueriesConfigPath } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";

export class QueriesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, QueriesConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, QueriesConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, QueriesConfigError);
}

const VALID_SORT_DIRECTIONS = new Set(["asc", "desc"]);

/**
 * Parses and validates raw YAML content into a QueriesConfig.
 * Throws QueriesConfigError for invalid data.
 */
export function parseQueriesConfig(yamlContent: string): QueriesConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "queries config");

  const queries = raw["queries"];
  assertArray(queries, "queries");

  return {
    queries: queries.map((item, i) => {
      assertObject(item, `queries[${i}]`);
      assertString(item["name"], `queries[${i}].name`);
      assertString(item["query"], `queries[${i}].query`);

      const sort = item["sort"];
      let parsedSort: QueriesConfig["queries"][number]["sort"];

      if (sort !== undefined) {
        assertArray(sort, `queries[${i}].sort`);
        parsedSort = sort.map((s, j) => {
          assertObject(s, `queries[${i}].sort[${j}]`);
          assertString(s["field"], `queries[${i}].sort[${j}].field`);
          assertString(s["direction"], `queries[${i}].sort[${j}].direction`);
          if (!VALID_SORT_DIRECTIONS.has(s["direction"])) {
            throw new QueriesConfigError(
              `queries[${i}].sort[${j}].direction must be one of: asc, desc`
            );
          }
          return {
            field: s["field"],
            direction: s["direction"] as "asc" | "desc",
          };
        });
      }

      return {
        name: item["name"],
        query: item["query"],
        ...(parsedSort ? { sort: parsedSort } : {}),
      };
    }),
  };
}

/**
 * Loads and parses queries.yaml from the given .loctt directory.
 * Throws if file doesn't exist or content is invalid.
 */
export async function loadQueriesConfig(locttDir: string): Promise<QueriesConfig> {
  const filePath = getQueriesConfigPath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseQueriesConfig(content);
}

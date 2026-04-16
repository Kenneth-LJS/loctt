import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { QueriesConfig } from "@loctt/contracts";
import { getQueriesConfigPath } from "../paths/index.js";

export class QueriesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new QueriesConfigError(`${path} must be a non-empty string`);
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new QueriesConfigError(`${path} must be an array`);
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new QueriesConfigError(`${path} must be an object`);
  }
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

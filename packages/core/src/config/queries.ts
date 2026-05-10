import { readFile } from "node:fs/promises";

import type { QueriesConfig } from "@loctt/contracts";
import { ulid } from "ulid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getQueriesConfigPath } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";

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

  const seenIds = new Set<string>();
  return {
    queries: queries.map((item, i) => {
      assertObject(item, `queries[${i}]`);
      assertString(item["name"], `queries[${i}].name`);
      assertString(item["query"], `queries[${i}].query`);

      // Auto-assign an id when missing — old queries.yaml files
      // pre-date Phase 11. The id won't change across reads as
      // long as the file is rewritten back via saveQueriesConfig
      // (which round-trips through this parser).
      let id: string;
      if (item["id"] !== undefined) {
        assertString(item["id"], `queries[${i}].id`);
        id = item["id"];
        if (seenIds.has(id)) {
          throw new QueriesConfigError(`duplicate query id: ${id}`);
        }
      } else {
        id = ulid();
      }
      seenIds.add(id);

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
        id,
        name: item["name"],
        query: item["query"],
        ...(parsedSort ? { sort: parsedSort } : {}),
      };
    }),
  };
}

/** Serializes a QueriesConfig to YAML with stable key order. */
export function serializeQueriesConfig(config: QueriesConfig): string {
  return stringifyYaml({
    queries: config.queries.map(q => ({
      id: q.id,
      name: q.name,
      query: q.query,
      ...(q.sort !== undefined ? {
        sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
      } : {}),
    })),
  });
}

/** Atomically writes queries.yaml. */
export async function saveQueriesConfig(
  locttDir: string,
  config: QueriesConfig,
): Promise<void> {
  // Round-trip via parse for validation.
  const validated = parseQueriesConfig(serializeQueriesConfig(config));
  await writeYamlAtomically(getQueriesConfigPath(locttDir), {
    queries: validated.queries.map(q => ({
      id: q.id,
      name: q.name,
      query: q.query,
      ...(q.sort !== undefined ? {
        sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
      } : {}),
    })),
  });
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

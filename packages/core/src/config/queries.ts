import { readFile } from "node:fs/promises";

import type { QueriesConfig, SavedQuery } from "@loctt/contracts";
import { QuerySortSchema } from "@loctt/contracts";
import { ulid } from "ulid";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getQueriesConfigPath } from "../paths/index.js";
import { ParseError, parseQuery } from "../query/parser.js";
import { tokenize, TokenizeError } from "../query/tokenizer.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class QueriesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesConfigError";
  }
}

/**
 * Schema used while parsing on-disk YAML. Differs from the
 * exported `SavedQuerySchema` in two ways:
 *  - `id` is optional (older files pre-date stable ids; we
 *    auto-assign one before returning).
 *  - the `query` field is additionally validated via the DSL
 *    parser so unrunnable views fail at load time.
 */
const RawSavedQuerySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  query: z.string().min(1),
  sort: z.array(QuerySortSchema).optional(),
  archived: z.boolean().optional(),
}).strict();

const RawQueriesConfigSchema = z.object({
  queries: z.array(RawSavedQuerySchema),
}).strict();

export function parseQueriesConfig(yamlContent: string): QueriesConfig {
  const raw: unknown = safeParseYaml(yamlContent, "queries.yaml");
  let parsed: z.infer<typeof RawQueriesConfigSchema>;
  try {
    parsed = RawQueriesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new QueriesConfigError(formatZodIssues("queries config", err));
    }
    throw err;
  }

  const seenIds = new Set<string>();
  const queries: SavedQuery[] = parsed.queries.map((item, i) => {
    // DSL validation. Bad query strings are user-fixable and
    // shouldn't crash the rest of the load.
    try {
      parseQuery(tokenize(item.query));
    } catch (err) {
      if (err instanceof TokenizeError || err instanceof ParseError) {
        throw new QueriesConfigError(
          `queries[${i}].query is not a valid query: ${err.message}`,
        );
      }
      throw err;
    }

    const id = item.id ?? ulid();
    if (seenIds.has(id)) {
      throw new QueriesConfigError(`duplicate query id: ${id}`);
    }
    seenIds.add(id);

    return {
      id,
      name: item.name,
      query: item.query,
      ...(item.sort !== undefined ? { sort: item.sort } : {}),
      ...(item.archived === true ? { archived: true } : {}),
    };
  });

  return { queries };
}

export function serializeQueriesConfig(config: QueriesConfig): string {
  return stringifyYaml({
    queries: config.queries.map(q => ({
      id: q.id,
      name: q.name,
      query: q.query,
      ...(q.sort !== undefined ? {
        sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
      } : {}),
      ...(q.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function saveQueriesConfig(
  locttDir: string,
  config: QueriesConfig,
): Promise<void> {
  const validated = parseQueriesConfig(serializeQueriesConfig(config));
  await writeYamlAtomically(getQueriesConfigPath(locttDir), {
    queries: validated.queries.map(q => ({
      id: q.id,
      name: q.name,
      query: q.query,
      ...(q.sort !== undefined ? {
        sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
      } : {}),
      ...(q.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadQueriesConfig(locttDir: string): Promise<QueriesConfig> {
  const filePath = getQueriesConfigPath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseQueriesConfig(content);
}

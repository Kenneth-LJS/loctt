
import type { QueriesConfig, SavedQuery } from "@loctt/contracts";
import { SavedQuerySchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getQueriesConfigPath } from "../paths/index.js";
import { ParseError, parseQuery } from "../query/parser.js";
import { tokenize, TokenizeError } from "../query/tokenizer.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class QueriesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesConfigError";
  }
}

const RawQueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
}).strict();

export function parseQueriesConfig(yamlContent: string): QueriesConfig {
  const raw: unknown = safeParseYaml(yamlContent, "queries.yaml");
  let parsed: z.infer<typeof RawQueriesConfigSchema>;
  try {
    parsed = RawQueriesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new QueriesConfigError(`queries.yaml is not valid: ${formatZodIssues("queries config", err)}`);
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

    if (seenIds.has(item.id)) {
      throw new QueriesConfigError(`duplicate query id: ${item.id}`);
    }
    seenIds.add(item.id);

    return {
      id: item.id,
      name: item.name,
      query: item.query,
      ...(item.sort !== undefined ? { sort: item.sort } : {}),
      ...(item.display !== undefined ? { display: item.display } : {}),
      ...(item.archived === true ? { archived: true } : {}),
    };
  });

  return { queries };
}

/** Build a plain serializable object for one SavedQuery. */
function serializeSavedQuery(q: QueriesConfig["queries"][number]): Record<string, unknown> {
  return {
    id: q.id,
    name: q.name,
    query: q.query,
    ...(q.sort !== undefined ? {
      sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
    } : {}),
    ...(q.display !== undefined ? { display: serializeDisplay(q.display) } : {}),
    ...(q.archived === true ? { archived: true } : {}),
  };
}

function serializeDisplay(d: NonNullable<QueriesConfig["queries"][number]["display"]>): Record<string, unknown> {
  return {
    ...(d.mode !== undefined ? { mode: d.mode } : {}),
    ...(d.columns !== undefined ? { columns: d.columns } : {}),
    ...(d.group_by !== undefined ? { group_by: d.group_by } : {}),
    ...(d.zoom !== undefined ? { zoom: d.zoom } : {}),
    ...(d.grouping !== undefined ? { grouping: d.grouping } : {}),
    ...(d.show_arrows !== undefined ? { show_arrows: d.show_arrows } : {}),
  };
}

export function serializeQueriesConfig(config: QueriesConfig): string {
  return stringifyYaml({
    queries: config.queries.map(serializeSavedQuery),
  });
}

export async function saveQueriesConfig(
  locttDir: string,
  config: QueriesConfig,
): Promise<void> {
  const validated = parseQueriesConfig(serializeQueriesConfig(config));
  await writeYamlAtomically(getQueriesConfigPath(locttDir), {
    queries: validated.queries.map(serializeSavedQuery),
  });
}

export async function loadQueriesConfig(locttDir: string): Promise<QueriesConfig> {
  const filePath = getQueriesConfigPath(locttDir);
  // Rethrown as a named cause rather than a bare errno: these throw on
  // absence too (deliberately — the file is required), so the caller
  // needs to know which file and why.
  const file = await readFileState(filePath);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT", path: filePath });
  }
  return parseQueriesConfig(file.content);
}

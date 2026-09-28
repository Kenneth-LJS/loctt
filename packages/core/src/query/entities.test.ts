import type { QueriesConfig, Task } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { EntityDirectory } from "./entities.js";
import { resolveQueryEntities } from "./entities.js";
import { buildListContext, listTasks } from "./list.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { QueryValidationError } from "./validate.js";

/**
 * @verifies QRY-C7
 *
 * K148: a query may name a label, user, milestone, sprint or project;
 * the name is resolved to the ID the tasks store. The runthrough pins
 * `labels = urgent` end to end on both surfaces; this pins the rules.
 */
const URGENT = "01M3JSJ8DMF2F12MVBFA3R09Q1";
const FRONT = "01M3JSJ7J3QBTDKH0VT5THF6ET";
const TWIN_A = "01M3JSJ7V0JT57NNCCSGH9XV73";
const TWIN_B = "01M3JSJ84E9HFQPW32EER1RWTQ";
const BEA = "01M3JSJ6CXR6KBVE6HJQ1BDAN5";

const directory: EntityDirectory = {
  label: [{ id: URGENT, name: "urgent" }, { id: FRONT, name: "frontend" }, { id: TWIN_A, name: "twin" }, { id: TWIN_B, name: "twin" }],
  user: [{ id: BEA, name: "Bea" }],
};

const parse = (q: string) => parseQuery(tokenize(q));

function task(key: string, labels: string[], assignee?: string): Task {
  return {
    frontmatter: {
      id: `id-${key}`, key, title: key,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      labels,
      ...(assignee !== undefined ? { assignee } : {}),
    },
    body: "",
  };
}

const tasks = [task("T-1", [URGENT], BEA), task("T-2", [FRONT]), task("T-3", [])];
const keys = (ts: readonly Task[]): string[] => ts.map(t => t.frontmatter.key);

describe("resolveQueryEntities (K148)", () => {
  it("resolves names to IDs, in lists too, and keeps IDs as given", () => {
    const node = resolveQueryEntities(parse(`labels in (urgent, ${FRONT}) and assignee = bea`), directory);
    expect(node).toMatchObject({
      type: "and",
      left: { field: "labels", value: { type: "list", values: [{ value: URGENT }, { value: FRONT }] } },
      right: { field: "assignee", value: { value: BEA } },
    });
  });

  it("refuses a name matching nothing, and an ambiguous one listing each ID", () => {
    expect(() => resolveQueryEntities(parse("labels = nope"), directory))
      .toThrow("No label named 'nope' at position 0");
    expect(() => resolveQueryEntities(parse("status = done and labels = twin"), directory))
      .toThrow(`'twin' matches 2 labels: twin (${TWIN_A}), twin (${TWIN_B}). Use the ID at position 18`);
  });

  it("keeps an ID that no entity holds any more: a task may still store it", () => {
    const gone = "01M3JSJ9ADABA1DAAX7Z2PCXME";
    expect(resolveQueryEntities(parse(`labels = ${gone}`), directory))
      .toMatchObject({ value: { value: gone } });
  });

  it("leaves other operators, other fields and unloaded kinds alone", () => {
    for (const q of ["labels ~ urg", "title = urgent", "milestone = GA", "labels is empty"]) {
      const node = parse(q);
      expect(resolveQueryEntities(node, directory)).toEqual(node);
    }
  });
});

describe("listTasks with names (K148)", () => {
  const ctx = { ...buildListContext(tasks), entities: directory };

  it("`labels = urgent` matches the tasks labelled urgent", () => {
    expect(keys(listTasks({ tasks, options: { query: "labels = urgent" }, ctx }))).toEqual(["T-1"]);
    // Before K148 the name was compared with the stored IDs: nothing.
    expect(listTasks({ tasks, options: { query: "labels = urgent" }, ctx: buildListContext(tasks) })).toEqual([]);
  });

  it("an ad hoc query naming nothing is refused", () => {
    expect(() => listTasks({ tasks, options: { query: "labels = nope" }, ctx }))
      .toThrow(QueryValidationError);
  });

  it("a saved view naming nothing warns and still runs", () => {
    const queriesConfig: QueriesConfig = {
      queries: [{ id: "v1", name: "stale", filters: [{ kind: "advanced", query: "labels = gone" }] }],
    };
    const warnings: string[] = [];
    const result = listTasks({
      tasks, options: { view: "v1" }, queriesConfig, ctx,
      onWarning: err => warnings.push(err.message),
    });
    expect(result).toEqual([]);
    expect(warnings).toEqual(["No label named 'gone' at position 0"]);
  });
});

describe("an unquoted ID is a query value (K148)", () => {
  it("tokenizes as one value, not a number and a word", () => {
    expect(parse(`labels in (urgent, ${FRONT})`)).toMatchObject({
      value: { type: "list", values: [{ value: "urgent" }, { value: FRONT }] },
    });
  });
});

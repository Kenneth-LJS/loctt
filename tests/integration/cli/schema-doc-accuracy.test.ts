import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LabelDefSchema,
  MilestoneDefSchema,
  ProjectDefSchema,
  SprintDefSchema,
} from "@loctt/contracts";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @verifies MSL-C3
 *
 * `schema-reference.md` documented labels, milestones, sprints and
 * projects as `key`/`label` long after the code moved to `id`/`name`.
 * Anyone writing one of those files by hand from the docs produced a
 * file the loader rejects, and anyone reading the docs to understand
 * task references learned the wrong identity model (invariants P-1, P-2).
 *
 * Checked against the Zod schemas rather than a hardcoded list, so the
 * doc cannot drift from the shape without this failing.
 */

/** Field names a Zod object schema actually declares. */
function fieldsOf(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape);
}

/**
 * Extracts the field names from a markdown table under `### \`<name>\``.
 * The first column is the field, in backticks.
 */
function documentedFields(doc: string, heading: string): string[] {
  const start = doc.indexOf(`### \`${heading}\``);
  if (start === -1) throw new Error(`no section for ${heading} in schema-reference.md`);
  const rest = doc.slice(start);
  const end = rest.indexOf("\n---");
  const section = end === -1 ? rest : rest.slice(0, end);

  const fields: string[] = [];
  for (const m of section.matchAll(/^\| `([a-z_]+)` \|/gm)) {
    if (m[1] !== undefined) fields.push(m[1]);
  }
  return fields;
}

const CASES: Array<{ heading: string; schema: { shape: Record<string, unknown> } }> = [
  { heading: "labels[]", schema: LabelDefSchema },
  { heading: "milestones[]", schema: MilestoneDefSchema },
  { heading: "sprints[]", schema: SprintDefSchema },
  { heading: "projects[]", schema: ProjectDefSchema },
];

describe("schema-reference.md matches the shipped schemas", () => {
  it.each(CASES)("documents exactly $heading's real fields", async ({ heading, schema }) => {
    const doc = await readFile(path.join(repoRoot, "docs/dev/reference/schema-reference.md"), "utf-8");
    const documented = documentedFields(doc, heading);
    // Guard the extractor: an empty result would make every assertion
    // below vacuously true.
    expect(documented.length).toBeGreaterThan(0);

    expect([...documented].sort()).toEqual([...fieldsOf(schema)].sort());
  });

  it("does not describe these entities as keyed by `key`", async () => {
    const doc = await readFile(path.join(repoRoot, "docs/dev/reference/schema-reference.md"), "utf-8");

    // The specific stale sentence MSL-C3 names. `workflow.yaml` genuinely
    // uses key/label, so this is scoped to the four id/name entities
    // rather than banning the word outright.
    for (const heading of ["labels[]", "milestones[]", "sprints[]", "projects[]"]) {
      const fields = documentedFields(doc, heading);
      expect(fields, `${heading} still documents a 'key' field`).not.toContain("key");
      expect(fields, `${heading} still documents a 'label' field`).not.toContain("label");
      expect(fields).toContain("id");
      expect(fields).toContain("name");
    }
  });

  it("shows id/name in the worked YAML examples, not key/label", async () => {
    const doc = await readFile(path.join(repoRoot, "docs/dev/reference/schema-reference.md"), "utf-8");

    // The tables can be right while the copy-pasteable example above
    // them is still wrong — which is the half a reader actually uses.
    //
    // Scoped to the four id/name files: `workflow.yaml` genuinely keys
    // its statuses and task_types, so a repo-wide ban on `key:` would
    // fail on correct documentation.
    for (const file of ["labels.yaml", "milestones.yaml", "sprints.yaml", "projects.yaml"]) {
      const start = doc.indexOf(`## ${file}`);
      expect(start, `no section for ${file}`).toBeGreaterThan(-1);
      const rest = doc.slice(start);
      const end = rest.indexOf("\n---");
      const section = end === -1 ? rest : rest.slice(0, end);

      const example = section.slice(section.indexOf("```yaml"), section.indexOf("```", section.indexOf("```yaml") + 7));
      expect(example.length).toBeGreaterThan(0);
      expect(example, `${file}'s example still uses \`key:\``).not.toMatch(/^\s*- key:/m);
      expect(example, `${file}'s example still uses \`label:\``).not.toMatch(/^\s*label:/m);
      expect(example).toMatch(/^\s*- id:/m);
    }
  });
});

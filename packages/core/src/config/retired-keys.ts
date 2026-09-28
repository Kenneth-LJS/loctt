import { readFile } from "node:fs/promises";

import { RETIRED_RELATIONSHIP_KEYS } from "@loctt/contracts";
import { isMap, isSeq, parseDocument } from "yaml";

import { getWorkflowConfigPath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

/**
 * Settings that no longer do anything, left in a user's workflow.yaml.
 *
 * `ranked` on a relationship is the one today (K143): every kind is
 * ordered since format 0.3.0. The schema drops it on read, so it never
 * breaks loading; `loctt doctor` reports it (a `warn`, "remove the
 * line"), and the 0.1.0 → 0.3.0 upgrade removes it.
 */

/** A retired key found on a relationship definition. */
export interface RetiredRelationshipKey {
  /** The relationship's `key`, or its position when it has none. */
  readonly relationship: string;
  readonly setting: string;
}

async function readWorkflowDoc(locttDir: string): Promise<ReturnType<typeof parseDocument> | undefined> {
  let raw: string;
  try {
    raw = await readFile(getWorkflowConfigPath(locttDir), "utf-8");
  } catch {
    return undefined;
  }
  const doc = parseDocument(raw);
  // A file that doesn't parse is the workflow.yaml check's to report.
  return doc.errors.length > 0 ? undefined : doc;
}

function relationshipItems(doc: ReturnType<typeof parseDocument>): unknown[] {
  const rels: unknown = doc.get("relationships", true);
  return isSeq(rels) ? rels.items : [];
}

/** Lists every retired key set on a relationship in workflow.yaml. */
export async function findRetiredRelationshipKeys(
  locttDir: string,
): Promise<RetiredRelationshipKey[]> {
  const doc = await readWorkflowDoc(locttDir);
  if (doc === undefined) return [];
  const out: RetiredRelationshipKey[] = [];
  relationshipItems(doc).forEach((item, index) => {
    if (!isMap(item)) return;
    const key = item.get("key");
    const name = typeof key === "string" ? key : `#${String(index + 1)}`;
    for (const setting of RETIRED_RELATIONSHIP_KEYS) {
      if (item.has(setting)) out.push({ relationship: name, setting });
    }
  });
  return out;
}

/**
 * Removes every retired key from workflow.yaml's relationships, leaving
 * the rest of the file (comments, order, other settings) as it was.
 * Returns how many were removed; writes nothing when there are none.
 * Lock-free: called by the upgrade step under the migration lock.
 */
export async function stripRetiredRelationshipKeys(locttDir: string): Promise<number> {
  const doc = await readWorkflowDoc(locttDir);
  if (doc === undefined) return 0;
  let removed = 0;
  for (const item of relationshipItems(doc)) {
    if (!isMap(item)) continue;
    for (const setting of RETIRED_RELATIONSHIP_KEYS) {
      if (item.delete(setting)) removed += 1;
    }
  }
  if (removed > 0) await writeFileAtomically(getWorkflowConfigPath(locttDir), doc.toString());
  return removed;
}

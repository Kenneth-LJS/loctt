/**
 * Reads a tracker straight off disk.
 *
 * K144: the checks read the tracker files directly — plain YAML, no
 * `@loctt/core` import — so a core bug cannot vouch for itself. This
 * module is the only place that knows the on-disk layout, and it knows
 * only what `docs/dev/reference/schema-reference.md` documents.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

export interface Relationship {
  readonly type: string;
  readonly target: string;
  readonly rank?: string;
}

export interface TaskRecord {
  readonly id: string;
  readonly key: string;
  /** Path of `task.md` relative to the tracker root. */
  readonly file: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

export interface RelationshipDef {
  readonly key: string;
  readonly inverse?: string;
  readonly kind?: string;
}

/**
 * Splits a `task.md` into its frontmatter and body. Throws naming the
 * file when the frontmatter block is missing or does not parse, so a
 * corrupt write shows up as a check failure with a path, not as a
 * confusing "task not found".
 */
export function parseTaskFile(text: string, file: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: no YAML frontmatter block`);
  const fm: unknown = parseYaml(match[1] ?? "");
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    throw new Error(`${file}: frontmatter is not a mapping`);
  }
  return { frontmatter: fm as Record<string, unknown>, body: match[2] ?? "" };
}

export class TrackerView {
  /** `root` is the directory holding `.loctt/`. */
  constructor(readonly root: string) {}

  get locttDir(): string {
    return path.join(this.root, ".loctt");
  }

  /** Absolute path of a file given relative to `.loctt/`. */
  abs(rel: string): string {
    return path.join(this.locttDir, rel);
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  readText(rel: string): string {
    return readFileSync(this.abs(rel), "utf-8");
  }

  /** Parses a YAML file under `.loctt/`; `undefined` when it is absent. */
  readYaml(rel: string): unknown {
    if (!this.exists(rel)) return undefined;
    return parseYaml(this.readText(rel));
  }

  /** Every task on disk, archived or not. */
  tasks(): TaskRecord[] {
    const dir = this.abs("tasks");
    if (!existsSync(dir)) return [];
    const out: TaskRecord[] = [];
    for (const name of readdirSync(dir).sort()) {
      const file = path.join("tasks", name, "task.md");
      if (!existsSync(this.abs(file))) continue;
      const { frontmatter, body } = parseTaskFile(this.readText(file), file);
      out.push({
        id: String(frontmatter["id"]),
        key: String(frontmatter["key"]),
        file,
        frontmatter,
        body,
      });
    }
    return out;
  }

  /**
   * Resolves a task reference the way a user means it: its id, its
   * current key, or a retired key in `key_history`. Current keys win
   * over retired ones, so a reused key cannot shadow its new owner.
   */
  findTask(ref: string): TaskRecord | undefined {
    const all = this.tasks();
    return all.find(t => t.id === ref)
      ?? all.find(t => t.key === ref)
      ?? all.find(t => asStringArray(t.frontmatter["key_history"]).includes(ref));
  }

  task(ref: string): TaskRecord {
    const t = this.findTask(ref);
    if (!t) throw new Error(`no task on disk matches "${ref}" (by id, key or key_history)`);
    return t;
  }

  relationships(task: TaskRecord): Relationship[] {
    const raw = task.frontmatter["relationships"];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r: unknown) => {
      if (r === null || typeof r !== "object") return [];
      const rec = r as Record<string, unknown>;
      const rel: Relationship = {
        type: String(rec["type"]),
        target: String(rec["target"]),
        ...(typeof rec["rank"] === "string" ? { rank: rec["rank"] } : {}),
      };
      return [rel];
    });
  }

  /** The relationship definitions from workflow.yaml. */
  relationshipDefs(): RelationshipDef[] {
    const wf = this.readYaml("config/workflow.yaml") as { relationships?: unknown } | undefined;
    const list = Array.isArray(wf?.relationships) ? wf.relationships : [];
    return list.flatMap((r: unknown) => {
      if (r === null || typeof r !== "object") return [];
      const rec = r as Record<string, unknown>;
      if (typeof rec["key"] !== "string") return [];
      return [{
        key: rec["key"],
        ...(typeof rec["inverse"] === "string" ? { inverse: rec["inverse"] } : {}),
        ...(typeof rec["kind"] === "string" ? { kind: rec["kind"] } : {}),
      }];
    });
  }

  /**
   * The type that must appear on the target's side for an edge of
   * `type`, or `undefined` for a one-way type (directional, no inverse).
   */
  inverseOf(type: string): string | undefined {
    for (const def of this.relationshipDefs()) {
      if (def.kind === "symmetric" && def.key === type) return type;
      if (def.key === type) return def.inverse;
      if (def.inverse === type) return def.key;
    }
    return undefined;
  }

  /** A task's comments from `_comments.yaml` (empty when absent). */
  comments(task: TaskRecord): Array<Record<string, unknown>> {
    const rel = path.join(path.dirname(task.file), "_comments.yaml");
    const doc = this.readYaml(rel) as { comments?: unknown } | undefined;
    return Array.isArray(doc?.comments) ? doc.comments as Array<Record<string, unknown>> : [];
  }

  attachmentsDir(task: TaskRecord): string {
    return path.join(path.dirname(task.file), "attachments");
  }

  /** Every user profile, keyed by nothing — order is directory order. */
  users(): Array<Record<string, unknown>> {
    const dir = this.abs("users");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort().flatMap(id => {
      const rel = path.join("users", id, "profile.yaml");
      const doc = this.readYaml(rel);
      return doc && typeof doc === "object" ? [doc as Record<string, unknown>] : [];
    });
  }
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : [];
}

/**
 * Every file under `dir`, as sorted paths relative to it. Used for the
 * "nothing changed" snapshot.
 */
export function listFiles(dir: string, rel = ""): string[] {
  const here = path.join(dir, rel);
  if (!existsSync(here)) return [];
  const out: string[] = [];
  for (const name of readdirSync(here).sort()) {
    const childRel = rel === "" ? name : path.join(rel, name);
    if (statSync(path.join(dir, childRel)).isDirectory()) out.push(...listFiles(dir, childRel));
    else out.push(childRel);
  }
  return out;
}

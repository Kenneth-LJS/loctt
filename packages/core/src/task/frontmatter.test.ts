import { describe, expect,it } from "vitest";

import { assembleTaskFile, parseFrontmatter, renderRawText, serializeFrontmatter, splitTaskFile, TaskParseError } from "./frontmatter.js";

const CANONICAL_TASK = `---
id: 01HSV6TQ3Y7M8K9N4R5S6A7B8C
key: T-123
title: Add loctt init flow
created_at: "2026-04-16T14:30:00Z"
updated_at: "2026-04-16T14:30:00Z"
status: in_progress
status_updated_at: "2026-04-16T14:30:00Z"
task_type: task
priority: medium
relationships:
  - type: parent
    target: 01HSV71FJ1M3R4K8V2N6P7T9AB
  - type: blocks
    target: 01HSV70CX2M4R8P1N9J3K5Q6WW
fields:
  sprint: sprint_2
  owner_team: platform
---
Implement the initial \`loctt init\` experience.

[2026-04-16 14:30] Created task and started outlining init behavior.
`;

describe("splitTaskFile", () => {
  it("splits frontmatter from body", () => {
    const { rawYaml, body } = splitTaskFile(CANONICAL_TASK);
    expect(rawYaml).toContain("id: 01HSV6TQ3Y7M8K9N4R5S6A7B8C");
    expect(body).toContain("Implement the initial");
  });

  it("handles empty body", () => {
    const content = "---\nid: abc\n---\n";
    const { rawYaml, body } = splitTaskFile(content);
    expect(rawYaml).toBe("id: abc");
    expect(body).toBe("");
  });

  it("throws on missing frontmatter", () => {
    expect(() => splitTaskFile("just markdown")).toThrow(TaskParseError);
  });
});

describe("parseFrontmatter", () => {
  it("parses the canonical task frontmatter (clean → no health)", () => {
    const { rawYaml } = splitTaskFile(CANONICAL_TASK);
    const { frontmatter: fm, health } = parseFrontmatter(rawYaml);

    expect(health).toHaveLength(0);
    expect(fm.id).toBe("01HSV6TQ3Y7M8K9N4R5S6A7B8C");
    expect(fm.key).toBe("T-123");
    expect(fm.title).toBe("Add loctt init flow");
    expect(fm.status).toBe("in_progress");
    expect(fm.task_type).toBe("task");
    expect(fm.priority).toBe("medium");
    expect(fm.relationships).toHaveLength(2);
    expect(fm.relationships?.[0]).toEqual({
      type: "parent",
      target: "01HSV71FJ1M3R4K8V2N6P7T9AB",
    });
    expect(fm.fields).toEqual({ sprint: "sprint_2", owner_team: "platform" });
  });

  it("parses minimal frontmatter with only required fields", () => {
    const yaml = `
id: abc123
key: T-1
title: Minimal task
created_at: "2026-04-16T14:30:00Z"
updated_at: "2026-04-16T14:30:00Z"
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.id).toBe("abc123");
    expect(fm.status).toBeUndefined();
    expect(fm.relationships).toBeUndefined();
    expect(fm.fields).toBeUndefined();
  });

  it("handles ISO date strings that yaml parses as Date objects", () => {
    const yaml = `
id: abc
key: T-1
title: Dates
created_at: 2026-04-16T14:30:00Z
updated_at: 2026-04-16T14:30:00Z
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.created_at).toMatch(/2026-04-16/);
    expect(fm.updated_at).toMatch(/2026-04-16/);
  });

  it("parses key_history", () => {
    const yaml = `
id: abc
key: T-5
title: Rekeyed
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
key_history:
  - T-3
  - T-4
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.key_history).toEqual(["T-3", "T-4"]);
  });

  it("parses archived fields", () => {
    const yaml = `
id: abc
key: T-1
title: Archived
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
archived: true
archived_at: "2026-04-16T14:30:00Z"
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.archived).toBe(true);
    expect(fm.archived_at).toMatch(/2026-04-16/);
  });

  it("throws on missing required id (object-fatal — id addresses the task)", () => {
    const yaml = `key: T-1\ntitle: X\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"`;
    expect(() => parseFrontmatter(yaml)).toThrow(TaskParseError);
    expect(() => parseFrontmatter(yaml)).toThrow("id is required (expected string)");
  });

  it("throws on missing required key (object-fatal — key addresses the task)", () => {
    const yaml = `id: abc\ntitle: X\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"`;
    expect(() => parseFrontmatter(yaml)).toThrow(TaskParseError);
    expect(() => parseFrontmatter(yaml)).toThrow("key is required (expected string)");
  });

  // K26: title is field-LOCAL now, not object-fatal. A missing/blank
  // title degrades into `health` (kind missing_required) and the rest of
  // the task loads — it no longer throws. (This assertion replaces the
  // pre-K26 "throws on missing required title" test, which encoded the
  // boundary K26 deliberately shrank to {id, key}.)
  it("degrades a missing title into health rather than throwing (K26)", () => {
    const yaml = `id: abc\nkey: T-1\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"`;
    const { frontmatter: fm, health } = parseFrontmatter(yaml);
    expect(fm.id).toBe("abc");
    expect(fm.key).toBe("T-1");
    expect(fm.title).toBeUndefined();
    const entry = health.find(h => h.field === "title");
    expect(entry?.kind).toBe("missing_required");
    expect(entry?.repair).toBe("set");
  });

  it("degrades a wrong-typed due_date into health, lifting it off frontmatter", () => {
    const yaml = `id: abc\nkey: T-1\ntitle: T\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"\ndue_date: 42`;
    const { frontmatter: fm, health } = parseFrontmatter(yaml);
    // The corrupt value is NOT on frontmatter (healthy fields only).
    expect(fm.due_date).toBeUndefined();
    const entry = health.find(h => h.field === "due_date");
    expect(entry?.kind).toBe("wrong_type");
    expect(entry?.raw).toBe(42);
    expect(entry?.rawText).toBe("42");
    expect(entry?.repair).toBe("set_or_remove");
    // Zod reports the type mismatch (a number where a string is required)
    // before the date-format regex runs, so the message is about type.
    expect(entry?.error).toMatch(/string|number|expected/i);
  });

  it("moves an unrecognised top-level key into health (kind unrecognised)", () => {
    const yaml = `id: abc\nkey: T-1\ntitle: T\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"\njira_id: ABC-1`;
    const { frontmatter: fm, health } = parseFrontmatter(yaml);
    // Not on frontmatter — it travels in health.
    expect((fm as unknown as Record<string, unknown>)["jira_id"]).toBeUndefined();
    const entry = health.find(h => h.field === "jira_id");
    expect(entry?.kind).toBe("unrecognised");
    expect(entry?.raw).toBe("ABC-1");
    expect(entry?.repair).toBe("remove");
  });

  it("fails closed when a fault mixes with an object-fatal id fault", () => {
    // due_date is degradable, but a bad id is object-fatal, so the whole
    // parse throws rather than half-degrading.
    const yaml = `key: T-1\ntitle: T\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"\ndue_date: 42`;
    expect(() => parseFrontmatter(yaml)).toThrow(TaskParseError);
  });

  it("treats YAML null (~) as undefined for optional fields", () => {
    const yaml = `
id: abc
key: T-1
title: Null fields
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
assignee: ~
milestone: null
labels: ~
archived: ~
start_date: ~
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.assignee).toBeUndefined();
    expect(fm.milestone).toBeUndefined();
    expect(fm.labels).toBeUndefined();
    expect(fm.archived).toBeUndefined();
    expect(fm.start_date).toBeUndefined();
  });

  it("parses the project field", () => {
    const yaml = `
id: abc
key: BACKEND-1
project: backend
title: Test
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
`;
    const { frontmatter: fm } = parseFrontmatter(yaml);
    expect(fm.project).toBe("backend");
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through parse/serialize", () => {
    const { rawYaml } = splitTaskFile(CANONICAL_TASK);
    const { frontmatter: fm } = parseFrontmatter(rawYaml);
    const serialized = serializeFrontmatter(fm);
    const { frontmatter: reparsed } = parseFrontmatter(serialized);
    expect(reparsed).toEqual(fm);
  });

  it("omits undefined optional fields", () => {
    const { frontmatter: fm } = parseFrontmatter(`
id: abc
key: T-1
title: Minimal
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
`);
    const serialized = serializeFrontmatter(fm);
    expect(serialized).not.toContain("status:");
    expect(serialized).not.toContain("relationships:");
    expect(serialized).not.toContain("fields:");
  });

  it("preserves unknown frontmatter keys across parse → serialize (via health)", () => {
    // The schema uses .passthrough(), but unrecognised keys now travel in
    // `health` rather than on `frontmatter`. They must still survive a
    // round-trip rather than silently disappearing on the next edit —
    // `serializeFrontmatter(fm, health)` re-emits them.
    const input = `
id: abc
key: T-1
title: Has extras
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
plugin_owner: alice
custom_metric: 42
experimental_flag: true
`.trimStart();
    const { frontmatter: fm, health } = parseFrontmatter(input);
    const serialized = serializeFrontmatter(fm, health);
    expect(serialized).toContain("plugin_owner: alice");
    expect(serialized).toContain("custom_metric: 42");
    expect(serialized).toContain("experimental_flag: true");

    // And the round-trip must be value-stable.
    const { frontmatter: reparsed, health: reHealth } = parseFrontmatter(serialized);
    const byField = new Map(reHealth.map(h => [h.field, h.raw]));
    expect((reparsed as unknown as Record<string, unknown>)["plugin_owner"]).toBeUndefined();
    expect(byField.get("plugin_owner")).toBe("alice");
    expect(byField.get("custom_metric")).toBe(42);
    expect(byField.get("experimental_flag")).toBe(true);
  });

  it("does NOT emit an unrecognised key when health is not passed (it is off frontmatter)", () => {
    // Mutation guard: without threading `health`, an unrecognised key
    // that was lifted off frontmatter would be dropped. This documents
    // that the raw value lives only in health, so a writer that forgets
    // `health` loses it — which is why assembleTaskFile takes a Task.
    const input = `
id: abc
key: T-1
title: X
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
jira_id: ABC-1
`.trimStart();
    const { frontmatter: fm, health } = parseFrontmatter(input);
    expect(serializeFrontmatter(fm)).not.toContain("jira_id");
    expect(serializeFrontmatter(fm, health)).toContain("jira_id: ABC-1");
  });

  it("emits unknown keys after the canonical known fields", () => {
    const { frontmatter: fm, health } = parseFrontmatter(`
id: abc
key: T-1
title: Ordering
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
plugin_zzz: last
status: in_progress
`.trimStart());
    const serialized = serializeFrontmatter(fm, health);
    // status (known) appears before plugin_zzz (unknown), regardless
    // of source order.
    expect(serialized.indexOf("status:")).toBeLessThan(serialized.indexOf("plugin_zzz:"));
  });

  it("re-emits a preserved corrupt value unless the field is overwritten", () => {
    const { frontmatter: fm, health } = parseFrontmatter(`
id: abc
key: T-1
title: X
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
due_date: 42
`.trimStart());
    // Preserve-others: the raw 42 comes back.
    expect(serializeFrontmatter(fm, health)).toMatch(/due_date: 42\b/);
    // Override wins: a healthy value on fm supersedes the health raw.
    const repaired = { ...fm, due_date: "2026-03-01" };
    const out = serializeFrontmatter(repaired, health);
    expect(out).toContain("due_date: 2026-03-01");
    expect(out).not.toMatch(/due_date: 42\b/);
  });
});

describe("renderRawText", () => {
  it("renders scalars and structures to a stable string", () => {
    expect(renderRawText(42)).toBe("42");
    expect(renderRawText("hi")).toBe("hi");
    // stringifyYaml renders an array in block form; the point is it is a
    // stable, non-empty rendering all surfaces share, not a specific form.
    expect(renderRawText([1, 2])).toContain("1");
    expect(renderRawText([1, 2])).toContain("2");
    expect(renderRawText(undefined)).toBe("");
  });
});

describe("required-identity null handling", () => {
  // YAML `~` clears a value to null. For an OPTIONAL field we treat that
  // as absent. For the object-fatal identity fields id/key we keep the
  // null and throw. For the degradable-required title/timestamps we keep
  // the null and record it in `health` (K26) rather than throwing.
  const valid = {
    id: "01HSV6TQ3Y7M8K9N4R5S6A7B8C",
    key: "T-1",
    title: "ok",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  function withField(field: string, value: string): string {
    return Object.entries({ ...valid, [field]: value })
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  }

  // id / key stay object-fatal (K26).
  for (const field of ["id", "key"]) {
    it(`reports ${field}: ~ as a type error mentioning the field`, () => {
      expect(() => parseFrontmatter(withField(field, "~"))).toThrow(
        new RegExp(field),
      );
    });
  }

  // title / created_at / updated_at degrade (K26): the null lands in
  // health rather than throwing.
  for (const field of ["title", "created_at", "updated_at"]) {
    it(`degrades ${field}: ~ into a missing_required health finding (K26)`, () => {
      const { health } = parseFrontmatter(withField(field, "~"));
      const entry = health.find(h => h.field === field);
      expect(entry?.kind).toBe("missing_required");
    });
  }
});

describe("assembleTaskFile", () => {
  it("creates a valid task.md with frontmatter and body", () => {
    const { frontmatter: fm } = parseFrontmatter(`
id: abc
key: T-1
title: Test
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
`);
    const body = "Some markdown content.\n";
    const result = assembleTaskFile({ frontmatter: fm, body });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain("id: abc");
    expect(result).toMatch(/---\nSome markdown content\.\n$/);

    // Should be re-parseable
    const { rawYaml, body: reparsedBody } = splitTaskFile(result);
    const { frontmatter: reparsedFm } = parseFrontmatter(rawYaml);
    expect(reparsedFm.id).toBe("abc");
    expect(reparsedBody).toBe("Some markdown content.\n");
  });

  it("re-emits health raw values through the Task it takes (§ 13.2 B2)", () => {
    const raw = `---
id: abc
key: T-1
title: T
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
due_date: 42
jira_id: ABC-1
---
Body.
`;
    const { rawYaml, body } = splitTaskFile(raw);
    const { frontmatter, health } = parseFrontmatter(rawYaml);
    const out = assembleTaskFile({ frontmatter, body, health });
    expect(out).toMatch(/due_date: 42\b/);
    expect(out).toContain("jira_id: ABC-1");
  });
});

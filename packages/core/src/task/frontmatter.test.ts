import { describe, it, expect } from "vitest";
import { splitTaskFile, parseFrontmatter, serializeFrontmatter, assembleTaskFile, TaskParseError } from "./frontmatter.js";

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
  it("parses the canonical task frontmatter", () => {
    const { rawYaml } = splitTaskFile(CANONICAL_TASK);
    const fm = parseFrontmatter(rawYaml);

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
    const fm = parseFrontmatter(yaml);
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
    const fm = parseFrontmatter(yaml);
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
    const fm = parseFrontmatter(yaml);
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
    const fm = parseFrontmatter(yaml);
    expect(fm.archived).toBe(true);
    expect(fm.archived_at).toMatch(/2026-04-16/);
  });

  it("throws on missing required id", () => {
    const yaml = `key: T-1\ntitle: X\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"`;
    expect(() => parseFrontmatter(yaml)).toThrow("id must be a non-empty string");
  });

  it("throws on missing required title", () => {
    const yaml = `id: abc\nkey: T-1\ncreated_at: "2026-01-01T00:00:00Z"\nupdated_at: "2026-01-01T00:00:00Z"`;
    expect(() => parseFrontmatter(yaml)).toThrow("title must be a non-empty string");
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through parse/serialize", () => {
    const { rawYaml } = splitTaskFile(CANONICAL_TASK);
    const fm = parseFrontmatter(rawYaml);
    const serialized = serializeFrontmatter(fm);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed).toEqual(fm);
  });

  it("omits undefined optional fields", () => {
    const fm = parseFrontmatter(`
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
});

describe("assembleTaskFile", () => {
  it("creates a valid task.md with frontmatter and body", () => {
    const fm = parseFrontmatter(`
id: abc
key: T-1
title: Test
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
`);
    const body = "Some markdown content.\n";
    const result = assembleTaskFile(fm, body);

    expect(result).toMatch(/^---\n/);
    expect(result).toContain("id: abc");
    expect(result).toMatch(/---\nSome markdown content\.\n$/);

    // Should be re-parseable
    const { rawYaml, body: reparsedBody } = splitTaskFile(result);
    const reparsedFm = parseFrontmatter(rawYaml);
    expect(reparsedFm.id).toBe("abc");
    expect(reparsedBody).toBe("Some markdown content.\n");
  });
});

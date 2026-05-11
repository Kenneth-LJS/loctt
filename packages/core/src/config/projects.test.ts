import { describe, expect, it } from "vitest";

import {
  parseProjectsConfig,
  ProjectsConfigError,
  serializeProjectsConfig,
} from "./projects.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

describe("parseProjectsConfig", () => {
  it("parses a minimal valid config", () => {
    const yaml = `
projects:
  - key: task
    label: Task
    prefix: "T-"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0]).toEqual({ key: "task", label: "Task", prefix: "T-" });
    expect(cfg.default).toBeUndefined();
  });

  it("parses multiple projects with a default", () => {
    const yaml = `
projects:
  - key: backend
    label: Backend
    prefix: "BACKEND-"
  - key: web
    label: Web
    prefix: "WEB-"
default: backend
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(2);
    expect(cfg.default).toBe("backend");
  });

  it("rejects an empty projects list", () => {
    expect(() => parseProjectsConfig("projects: []")).toThrow(ProjectsConfigError);
  });

  it("rejects duplicate keys", () => {
    const yaml = `
projects:
  - key: x
    label: X
    prefix: "X-"
  - key: x
    label: Y
    prefix: "Y-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project key/);
  });

  it("rejects duplicate prefixes", () => {
    const yaml = `
projects:
  - key: a
    label: A
    prefix: "T-"
  - key: b
    label: B
    prefix: "T-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project prefix/);
  });

  it("rejects keys with invalid characters", () => {
    const yaml = `
projects:
  - key: "Bad Key"
    label: X
    prefix: "X-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/slug starting with a letter/);
  });

  it("rejects a leading-digit key", () => {
    const yaml = `
projects:
  - key: 1bad
    label: X
    prefix: "X-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(ProjectsConfigError);
    expect(() => parseProjectsConfig(yaml)).toThrow(/slug starting with a letter/);
  });

  it("rejects an empty projects array", () => {
    expect(() => parseProjectsConfig(`projects: []`)).toThrow(ProjectsConfigError);
    expect(() => parseProjectsConfig(`projects: []`)).toThrow(/at least one/);
  });

  it("rejects unknown top-level keys", () => {
    const yaml = `projects:
  - key: x
    label: X
    prefix: "X-"
extra: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects unknown per-project keys", () => {
    const yaml = `projects:
  - key: x
    label: X
    prefix: "X-"
    description: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects an empty prefix", () => {
    const yaml = `
projects:
  - key: x
    label: X
    prefix: ""
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(ProjectsConfigError);
    expect(() => parseProjectsConfig(yaml)).toThrow("projects[0].prefix must be a non-empty string");
  });

  it("rejects a default that doesn't reference any project", () => {
    const yaml = `
projects:
  - key: x
    label: X
    prefix: "X-"
default: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/not in the projects list/);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseProjectsConfig("{ projects: [")).toThrow(YamlSyntaxError);
    expect(() => parseProjectsConfig("{ projects: [")).toThrow(/projects\.yaml/);
  });
});

describe("serializeProjectsConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      projects: [
        { key: "task", label: "Task", prefix: "T-" },
        { key: "bug", label: "Bug", prefix: "B-" },
      ],
      default: "task",
    };
    const yaml = serializeProjectsConfig(cfg);
    const parsed = parseProjectsConfig(yaml);
    expect(parsed).toEqual(cfg);
  });

  it("omits default when not set", () => {
    const cfg = {
      projects: [{ key: "task", label: "Task", prefix: "T-" }],
    };
    const yaml = serializeProjectsConfig(cfg);
    expect(yaml).not.toContain("default:");
  });
});

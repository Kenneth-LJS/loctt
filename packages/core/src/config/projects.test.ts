import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseProjectsConfig,
  ProjectsConfigError,
  saveProjectsConfig,
  serializeProjectsConfig,
} from "./projects.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

describe("parseProjectsConfig", () => {
  it("parses a minimal valid config", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Tasks
    prefix: "T-"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0]).toEqual({ id: "01HX0000000000000000000001", name: "Tasks", prefix: "T-" });
    expect(cfg.default).toBeUndefined();
  });

  it("parses multiple projects with a default", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000010
    name: Backend
    prefix: "BACKEND-"
  - id: 01HX0000000000000000000020
    name: Web
    prefix: "WEB-"
default: 01HX0000000000000000000010
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(2);
    expect(cfg.default).toBe("01HX0000000000000000000010");
  });

  it("rejects an empty projects list", () => {
    expect(() => parseProjectsConfig("projects: []")).toThrow(ProjectsConfigError);
  });

  it("rejects duplicate ids", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000099
    name: X
    prefix: "X-"
  - id: 01HX0000000000000000000099
    name: Y
    prefix: "Y-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project id/);
  });

  it("rejects duplicate prefixes", () => {
    const yaml = `
projects:
  - id: 01HX00000000000000000000A1
    name: A
    prefix: "T-"
  - id: 01HX00000000000000000000A2
    name: B
    prefix: "T-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project prefix/);
  });

  it("allows duplicate names (disambiguated by id)", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000111
    name: Twin
    prefix: "T1-"
  - id: 01HX0000000000000000000222
    name: Twin
    prefix: "T2-"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(2);
  });

  it("rejects an empty projects array", () => {
    expect(() => parseProjectsConfig(`projects: []`)).toThrow(ProjectsConfigError);
    expect(() => parseProjectsConfig(`projects: []`)).toThrow(/at least one/);
  });

  it("rejects unknown top-level keys", () => {
    const yaml = `projects:
  - id: 01HX0000000000000000000333
    name: X
    prefix: "X-"
extra: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects unknown per-project keys", () => {
    const yaml = `projects:
  - id: 01HX0000000000000000000444
    name: X
    prefix: "X-"
    description: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects an empty prefix", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000555
    name: X
    prefix: ""
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(ProjectsConfigError);
  });

  it("rejects an empty id", () => {
    const yaml = `
projects:
  - id: ""
    name: X
    prefix: "X-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(ProjectsConfigError);
  });

  it("rejects an empty name", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000666
    name: ""
    prefix: "X-"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(ProjectsConfigError);
  });

  it("tolerates a default that doesn't reference any project (K23 / NEW-20)", () => {
    // Was a hard reject. K23: a stale `default:` pointer is drift, not a
    // parse error — it parses through, the resolver ignores it and falls
    // to the ask state, and the drift is surfaced as a notice. The
    // parsed value keeps the ghost id so a surface can name it.
    const yaml = `
projects:
  - id: 01HX0000000000000000000777
    name: X
    prefix: "X-"
default: 01HX0000NONEXISTENT00000000
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.default).toBe("01HX0000NONEXISTENT00000000");
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
        { id: "01HX0000000000000000000001", name: "Tasks", prefix: "T-" },
        { id: "01HX0000000000000000000002", name: "Bugs", prefix: "B-" },
      ],
      default: "01HX0000000000000000000001",
    };
    const yaml = serializeProjectsConfig(cfg);
    const parsed = parseProjectsConfig(yaml);
    expect(parsed).toEqual(cfg);
  });

  it("omits default when not set", () => {
    const cfg = {
      projects: [{ id: "01HX0000000000000000000001", name: "Tasks", prefix: "T-" }],
    };
    const yaml = serializeProjectsConfig(cfg);
    expect(yaml).not.toContain("default:");
  });
});

describe("saveProjectsConfig / serializeProjectsConfig agree", () => {
  // The two built the on-disk field list independently, so a field
  // added to one and forgotten in the other was dropped on save with
  // nothing to say so. They now share `buildPlainObject`; this asserts
  // it, so re-splitting them fails here rather than in a user's
  // projects.yaml.
  //
  // Compares the WRITTEN FILE against the serializer, not two
  // in-memory objects — the bug was in what reached disk.
  it("writes exactly what the serializer produces", async () => {
    const root = await mkdtemp(join(tmpdir(), "loctt-projcfg-"));
    const config = parseProjectsConfig(`
projects:
  - id: 01HX0000000000000000000001
    name: Alpha
    slug: alpha
    prefix: A-
    archived: true
  - id: 01HX0000000000000000000002
    name: Beta
    prefix: B-
default: 01HX0000000000000000000002
`);
    await saveProjectsConfig(root, config);
    const onDisk = await readFile(join(root, "config", "projects.yaml"), "utf-8");
    expect(onDisk).toBe(serializeProjectsConfig(config));
    // And every optional field survived the trip, since a serializer
    // that dropped them all would still equal itself.
    expect(onDisk).toContain("slug: alpha");
    expect(onDisk).toContain("archived: true");
    expect(onDisk).toContain("default: 01HX0000000000000000000002");
  });
});

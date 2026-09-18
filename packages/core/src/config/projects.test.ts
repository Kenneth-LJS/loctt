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
    prefix: "T"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0]).toEqual({ id: "01HX0000000000000000000001", name: "Tasks", prefix: "T" });
    expect(cfg.default).toBeUndefined();
  });

  it("parses multiple projects with a default", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000010
    name: Backend
    prefix: "BACKEND"
  - id: 01HX0000000000000000000020
    name: Web
    prefix: "WEB"
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
    prefix: "X"
  - id: 01HX0000000000000000000099
    name: Y
    prefix: "Y"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project id/);
  });

  it("rejects duplicate prefixes", () => {
    const yaml = `
projects:
  - id: 01HX00000000000000000000A1
    name: A
    prefix: "T"
  - id: 01HX00000000000000000000A2
    name: B
    prefix: "T"
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project prefix/);
  });

  it("allows duplicate names (disambiguated by id)", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000111
    name: Twin
    prefix: "T1"
  - id: 01HX0000000000000000000222
    name: Twin
    prefix: "T2"
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
    prefix: "X"
extra: nope
`;
    expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("degrades a project with an unknown key to a broken entry (was object-fatal)", () => {
    // Behaviour changed in Phase 7B / O1: an unknown key inside ONE
    // project entry is now per-entry corruption — it becomes a
    // BrokenEntry and the rest of the file loads — not a whole-file
    // reject. This test previously asserted the old object-fatal
    // /unrecognized key/ throw; rewritten to assert the degrade, since
    // that expectation now encodes the pre-fix behaviour. Unknown
    // TOP-LEVEL keys are still object-fatal (see next test).
    const yaml = `projects:
  - id: 01HX0000000000000000000440
    name: Fine
    prefix: "F"
  - id: 01HX0000000000000000000444
    name: X
    prefix: "X"
    description: nope
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0]?.id).toBe("01HX0000000000000000000440");
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.id).toBe("01HX0000000000000000000444");
    expect(cfg.broken?.[0]?.error).toMatch(/unrecognized key/);
  });

  // K29 / DEG-24: a broken entry whose id collides with a valid one must
  // not be written back, or the file gains two members with one id
  // (invisible to doctor until the broken twin is repaired, then every
  // write is refused).
  it("does not write a broken twin whose id collides with a valid project", () => {
    // The second entry shares id …440 with the first but carries an
    // unknown key, so it degrades to `broken` while the valid …440 loads.
    const yaml = `projects:
  - id: 01HX0000000000000000000440
    name: Fine
    prefix: "F"
  - id: 01HX0000000000000000000440
    name: Twin
    prefix: "T"
    description: nope
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.broken).toHaveLength(1);

    // Round-trip: serialize then reparse. The broken twin (same id) is
    // dropped, so the reparsed file has exactly the one valid project and
    // no duplicate-id fault.
    const reparsed = parseProjectsConfig(serializeProjectsConfig(cfg));
    const ids = reparsed.projects.map(p => p.id);
    expect(ids).toEqual(["01HX0000000000000000000440"]);
    expect(reparsed.broken ?? []).toHaveLength(0);
  });

  // @verifies DEG-9
  it("degrades a project with an empty prefix to a broken entry", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000555
    name: X
    prefix: ""
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/prefix/);
  });

  it("degrades a project with an empty id to a broken entry", () => {
    // A per-entry fault (blank id) degrades: the entry becomes broken and
    // the file loads. With only this one project, `projects` is empty but
    // `broken` names it — NOT a "no projects" error, which would blank the
    // surface over one corrupt entry (PRU-37 / north-star P5). The
    // downstream "cannot allocate a key with no valid project" concern is
    // enforced where keys are allocated, not by blanking the read.
    const yaml = `
projects:
  - id: ""
    name: X
    prefix: "X"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
  });

  it("degrades a project with an empty name to a broken entry", () => {
    const yaml = `
projects:
  - id: 01HX0000000000000000000666
    name: ""
    prefix: "X"
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.projects).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/name/);
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
    prefix: "X"
default: 01HX0000NONEXISTENT00000000
`;
    const cfg = parseProjectsConfig(yaml);
    expect(cfg.default).toBe("01HX0000NONEXISTENT00000000");
  });

  it("an archived default is rejected with a message that does not say 'default default'", () => {
    // The error formatter prepends the failing key path ("default"); the
    // schema message must not also begin with "default project", or the
    // two combine into "default default project …". Regression for that
    // doubling.
    const yaml = `
projects:
  - id: 01HX0000000000000000000888
    name: Archived
    prefix: "AR"
    archived: true
default: 01HX0000000000000000000888
`;
    let msg = "";
    try { parseProjectsConfig(yaml); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/archived/);
    expect(msg).not.toMatch(/default default/);
  });

  // @verifies DEG-10
  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseProjectsConfig("{ projects: [")).toThrow(YamlSyntaxError);
    expect(() => parseProjectsConfig("{ projects: [")).toThrow(/projects\.yaml/);
  });

  describe("per-entry corruption degrades instead of blanking the surface (Phase 7B / O1)", () => {
    // Before: ProjectsConfigSchema.parse(raw) threw on ANY wrong-typed
    // field in ANY project, so one bad entry blanked the whole projects
    // surface. Now a valid project loads and a corrupt one becomes a
    // BrokenEntry (north-star principle 5, the VUE-22 pattern).
    it("loads valid projects and sets a corrupt one aside as broken", () => {
      const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Good
    prefix: "G"
  - id: 01HX0000000000000000000002
    name: 123
    prefix: []
  - id: 01HX0000000000000000000003
    name: AlsoGood
    prefix: "A"
`;
      const cfg = parseProjectsConfig(yaml);
      // The two good projects load; the bad one does not blank them.
      expect(cfg.projects).toHaveLength(2);
      expect(cfg.projects.map(p => p.id)).toEqual([
        "01HX0000000000000000000001",
        "01HX0000000000000000000003",
      ]);
      // The corrupt entry is surfaced, not hidden.
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]?.index).toBe(1);
      expect(cfg.broken?.[0]?.id).toBe("01HX0000000000000000000002");
      // rawText preserves the stored (corrupt) values for display.
      expect(cfg.broken?.[0]?.rawText).toContain("prefix");
      // The validator's message names what was wrong.
      expect(cfg.broken?.[0]?.error).toMatch(/prefix/);
    });

    // @verifies DEG-9
    it("omits `broken` entirely when every project is valid", () => {
      const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Good
    prefix: "G"
`;
      const cfg = parseProjectsConfig(yaml);
      // Omitted (not []) so "none broken" stays distinct from "not
      // inspected" and existing consumers reading only .projects are
      // unaffected.
      expect(cfg.broken).toBeUndefined();
    });

    it("degrades even a corrupt entry that carries no readable id", () => {
      const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Good
    prefix: "G"
  - name: NoId
    prefix: "N"
`;
      const cfg = parseProjectsConfig(yaml);
      expect(cfg.projects).toHaveLength(1);
      expect(cfg.broken).toHaveLength(1);
      // No id to name it by, but the index is always available.
      expect(cfg.broken?.[0]?.id).toBeUndefined();
      expect(cfg.broken?.[0]?.index).toBe(1);
    });

    // @verifies DEG-11
    it("degrades even when EVERY project entry is corrupt (a broken project is not 'no projects')", () => {
      // Coordinator correction to O1: a file whose only project is corrupt
      // is NOT "no projects" — it HAS a project, and it is broken. The
      // read must degrade (projects empty, broken names the entry) so the
      // panel shows it as broken rather than reporting the whole surface
      // gone (PRU-37: "tell broken from none"). The "cannot allocate a key
      // with zero VALID projects" concern is real but belongs at key
      // allocation, not at load — the read never blanks over corruption.
      const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Bad
    prefix: 42
`;
      const cfg = parseProjectsConfig(yaml);
      expect(cfg.projects).toHaveLength(0);
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]?.error).toMatch(/prefix/);
    });

    it("still throws 'at least one project' when the file has ZERO entries (valid or broken)", () => {
      // The genuine emptiness case stays object-fatal: an empty list is
      // not corruption to degrade, it is a tracker that cannot allocate a
      // key and has nothing to show as broken either.
      expect(() => parseProjectsConfig("projects: []")).toThrow(/at least one/);
    });

    it("keeps object-fatal cross-entry checks throwing (duplicate prefix among VALID entries)", () => {
      // Two well-formed projects sharing a prefix is ambiguous, not
      // degradable — it must still throw even though each entry parses.
      const yaml = `
projects:
  - id: 01HX00000000000000000000A1
    name: A
    prefix: "DUP"
  - id: 01HX00000000000000000000A2
    name: B
    prefix: "DUP"
`;
      expect(() => parseProjectsConfig(yaml)).toThrow(/duplicate project prefix/);
    });

    it("rejects a stray `broken:` key in the file (load-time diagnostic, not on-disk)", () => {
      const yaml = `
projects:
  - id: 01HX0000000000000000000001
    name: Good
    prefix: "G"
broken: []
`;
      expect(() => parseProjectsConfig(yaml)).toThrow(/unrecognized key/);
    });
  });
});

describe("serializeProjectsConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      projects: [
        { id: "01HX0000000000000000000001", name: "Tasks", prefix: "T" },
        { id: "01HX0000000000000000000002", name: "Bugs", prefix: "B" },
      ],
      default: "01HX0000000000000000000001",
    };
    const yaml = serializeProjectsConfig(cfg);
    const parsed = parseProjectsConfig(yaml);
    expect(parsed).toEqual(cfg);
  });

  it("omits default when not set", () => {
    const cfg = {
      projects: [{ id: "01HX0000000000000000000001", name: "Tasks", prefix: "T" }],
    };
    const yaml = serializeProjectsConfig(cfg);
    expect(yaml).not.toContain("default:");
  });

  // K28: a corrupt-but-degraded sibling another process left must survive
  // a serialize that only touched the valid entries. Dropping the
  // `brokenEntriesToPlain(config.broken)` append in buildPlainObject
  // reddens this — the broken project vanishes from the re-parsed .broken.
  it("preserves a broken sibling through serialize + reparse (K28)", () => {
    const cfg = parseProjectsConfig(`projects:
  - id: 01HX0000000000000000000001
    name: Tasks
    prefix: T
  - id: 01HX0000000000000000000002
    name: Bugs
    prefix: B
    bogus_key: 1
`);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.broken).toHaveLength(1);

    const reparsed = parseProjectsConfig(serializeProjectsConfig(cfg));
    expect(reparsed.projects).toEqual(cfg.projects);
    expect(reparsed.broken).toHaveLength(1);
    expect(reparsed.broken?.[0]?.id).toBe("01HX0000000000000000000002");
    expect(reparsed.broken?.[0]?.rawText).toContain("bogus_key");
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
    prefix: A
    archived: true
  - id: 01HX0000000000000000000002
    name: Beta
    prefix: B
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

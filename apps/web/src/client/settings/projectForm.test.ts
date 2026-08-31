import type { ProjectDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { slugify, validateNewProject } from "./projectForm.ts";

const web: ProjectDef = {
  id: "01WEB", name: "Web", prefix: "WEB-", slug: "web",
};
const backend: ProjectDef = {
  id: "01BE", name: "Backend", prefix: "BACKEND-", slug: "backend",
};
const existing = [web, backend];

describe("slugify", () => {
  it("matches core's derivation for a normal name", () => {
    expect(slugify("Web App")).toBe("web-app");
  });

  it("prefixes a digit-led name", () => {
    expect(slugify("2026 Roadmap")).toBe("p-2026-roadmap");
  });

  it("returns empty when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("validateNewProject", () => {
  it("rejects a prefix already held, naming the project that holds it (PRU-19)", () => {
    const problems = validateNewProject(
      { name: "New", prefix: "WEB-", slug: "new" },
      existing,
    );
    expect(problems.prefix).toContain("Web");
    expect(problems.prefix).toContain("WEB-");
    // Discriminate the exact-collision branch from the case-variant
    // one: a case-insensitive match also fires on an identical string,
    // so asserting only the project name passes either way.
    expect(problems.prefix).toContain("must be unique");
    expect(problems.prefix).not.toContain("differs only in case");
  });

  it("clears the prefix problem once the value is free (PRU-19)", () => {
    const problems = validateNewProject(
      { name: "New", prefix: "WEBAPP-", slug: "new" },
      existing,
    );
    expect(problems.prefix).toBeUndefined();
  });

  it("flags a prefix differing only in case (PRU-19)", () => {
    const problems = validateNewProject(
      { name: "New", prefix: "web-", slug: "new" },
      existing,
    );
    expect(problems.prefix).toContain("case");
  });

  it("blames the slug, not the prefix, when the slug collides (PRU-35)", () => {
    const problems = validateNewProject(
      { name: "Another", prefix: "FRESH-", slug: "web" },
      existing,
    );
    expect(problems.slug).toContain("web");
    // The field that is fine must not be blamed.
    expect(problems.prefix).toBeUndefined();
  });

  it("states the slug rule and suggests a fix for a malformed slug (PRU-36)", () => {
    const problems = validateNewProject(
      { name: "My Project", prefix: "MP-", slug: "My Project!" },
      existing,
    );
    expect(problems.slug).toContain("lowercase");
    expect(problems.slug).toContain("my-project");
  });

  it("explains a separator-less prefix using an existing prefix as the example (PRU-36)", () => {
    const problems = validateNewProject(
      { name: "Site", prefix: "web", slug: "site" },
      existing,
    );
    // "web" has no trailing separator.
    expect(problems.prefix).toContain("WEB-");
    expect(problems.prefix).toContain("web-");
  });

  it("accepts a fully valid draft with no problems", () => {
    const problems = validateNewProject(
      { name: "Docs", prefix: "DOCS-", slug: "docs" },
      existing,
    );
    expect(problems).toEqual({});
  });
});

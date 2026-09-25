import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/index.js";
import {
  allocateSlug,
  createProject,
  editProject,
  isValidSlug,
  ProjectError,
  projectSlug,
  resolveProjectIdFromInput,
  slugifyName,
} from "./index.js";

/**
 * K3 / A60: projects carry a `slug`, URLs carry the slug, and the slug
 * is immutable across a rename.
 */

describe("slugifyName", () => {
  it("lowercases and hyphenates a human name", () => {
    expect(slugifyName("Web App")).toBe("web-app");
  });

  it("strips accents rather than dropping the letter", () => {
    // "Café" must not become "caf" — NFKD + combining-mark strip.
    expect(slugifyName("Café Ops")).toBe("cafe-ops");
  });

  it("collapses runs of punctuation to a single hyphen and trims", () => {
    expect(slugifyName("  My -- Project!!  ")).toBe("my-project");
  });

  it("prefixes a digit-led name so the slug starts with a letter", () => {
    expect(slugifyName("2026 Roadmap")).toBe("p-2026-roadmap");
  });

  it("returns undefined when a name yields no usable ASCII", () => {
    expect(slugifyName("日本語")).toBeUndefined();
    expect(slugifyName("!!!")).toBeUndefined();
  });
});

describe("isValidSlug", () => {
  it("accepts a letter-led lowercase slug", () => {
    expect(isValidSlug("web-app_2")).toBe(true);
  });

  it("rejects uppercase, spaces, and digit-led values", () => {
    expect(isValidSlug("Web")).toBe(false);
    expect(isValidSlug("my project")).toBe(false);
    expect(isValidSlug("2026")).toBe(false);
  });
});

describe("allocateSlug", () => {
  const proj = (slug: string) =>
    ({ id: `id-${slug}`, name: slug, prefix: `${slug.toUpperCase()}`, slug });

  it("suffixes on collision rather than returning a duplicate", () => {
    expect(allocateSlug([proj("web")], "Web")).toBe("web-2");
    expect(allocateSlug([proj("web"), proj("web-2")], "Web")).toBe("web-3");
  });

  it("treats an archived project's slug as taken", () => {
    // Reusing it would make an old URL resolve to a different project
    // the moment the archived one comes back.
    const archived = { ...proj("web"), archived: true };
    expect(allocateSlug([archived], "Web")).toBe("web-2");
  });
});

describe("projectSlug", () => {
  it("falls back to the ULID for a pre-K3 project with no slug", () => {
    const legacy = { id: "01JABCDEF", name: "Legacy", prefix: "LEG" };
    expect(projectSlug(legacy)).toBe("01JABCDEF");
  });
});

describe("createProject slug allocation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loctt-slug-"));
    await initLoctt(dir, { projectName: "Backend", prefix: "BACKEND" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const locttDir = () => join(dir, ".loctt");

  it("generates a slug from the name and writes it to projects.yaml", async () => {
    const created = await createProject(locttDir(), {
      name: "Web App",
      prefix: "WEB",
    });
    expect(created.slug).toBe("web-app");

    // Assert the far end: the value on disk, not the return value.
    const raw = await readFile(
      join(locttDir(), "config", "projects.yaml"),
      "utf8",
    );
    expect(raw).toContain("slug: web-app");
  });

  it("rejects an explicit slug already held, naming the holder", async () => {
    await createProject(locttDir(), {
      name: "Web App",
      prefix: "WEB",
      slug: "web",
    });
    await expect(
      createProject(locttDir(), { name: "Website", prefix: "SITE", slug: "web" }),
    ).rejects.toThrow(/already used by project "Web App"/);
  });

  it("rejects a malformed explicit slug before writing", async () => {
    await expect(
      createProject(locttDir(), { name: "Web", prefix: "WEB", slug: "Web App" }),
    ).rejects.toThrow(ProjectError);

    // Nothing was written: the project list is unchanged.
    const config = await loadProjectsConfig(locttDir());
    expect(config.projects.map(p => p.prefix)).not.toContain("WEB");
  });

  it("resolves a project by its slug, and the ULID still resolves", async () => {
    const created = await createProject(locttDir(), {
      name: "Web App",
      prefix: "WEB",
    });
    const config = await loadProjectsConfig(locttDir());

    expect(resolveProjectIdFromInput(config, "web-app")).toBe(created.id);
    // K3: existing ULID URLs keep working.
    expect(resolveProjectIdFromInput(config, created.id)).toBe(created.id);
  });

  it("keeps the slug fixed across a rename, so old URLs keep resolving (A60)", async () => {
    const created = await createProject(locttDir(), {
      name: "Web",
      prefix: "WEB",
    });
    expect(created.slug).toBe("web");

    await editProject(locttDir(), created.id, { name: "Website" });

    const config = await loadProjectsConfig(locttDir());
    const after = config.projects.find(p => p.id === created.id);
    // The display name moved; the address did not.
    expect(after?.name).toBe("Website");
    expect(after?.slug).toBe("web");
    expect(resolveProjectIdFromInput(config, "web")).toBe(created.id);

    // And the disk agrees — not just the parsed object.
    const raw = await readFile(
      join(locttDir(), "config", "projects.yaml"),
      "utf8",
    );
    expect(raw).toContain("slug: web");
  });

  it("an unresolvable slug throws rather than silently widening", async () => {
    const config = await loadProjectsConfig(locttDir());
    expect(() => resolveProjectIdFromInput(config, "no-such-slug"))
      .toThrow(/unknown project/i);
  });
});

describe("initLoctt seeds a slug (K3 migration floor)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loctt-slug-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a slug derived from the project name at init", async () => {
    await initLoctt(dir, { projectName: "My Backend", prefix: "BE" });
    const config = await loadProjectsConfig(join(dir, ".loctt"));
    expect(config.projects[0]?.slug).toBe("my-backend");
  });

  it("omits the slug when the name yields none, leaving the ULID to resolve", async () => {
    await initLoctt(dir, { projectName: "日本語", prefix: "JP" });
    const config = await loadProjectsConfig(join(dir, ".loctt"));
    const only = config.projects[0];
    expect(only?.slug).toBeUndefined();
    // The tracker is still addressable — resolution falls back to id.
    expect(resolveProjectIdFromInput(config, only?.id ?? "")).toBe(only?.id);
  });
});

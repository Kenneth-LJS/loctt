import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ID_SHAPED_NAME_MESSAGE } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { createLabel, editLabel } from "../labels/manage.js";
import { createMilestone, editMilestone } from "../milestones/manage.js";
import { resolveLocttDir } from "../paths/index.js";
import { createProject, editProject } from "../projects/manage.js";
import { createSprint, editSprint } from "../sprints/manage.js";
import { createUser, updateUser } from "../users/lifecycle.js";
import { createView, editView } from "../views/manage.js";
import { matchEntityRef, resolveEntityRefOrThrow } from "./entity-ref.js";

/**
 * @verifies PRU-C15
 *
 * K148: the one name-or-ID resolver, and the ID-shaped-name refusal.
 */
const ID_A = "01M3JSJ7J3QBTDKH0VT5THF6ET";
const ID_B = "01M3JSJ7V0JT57NNCCSGH9XV73";
const ID_C = "01M3JSJ84E9HFQPW32EER1RWTQ";

describe("matchEntityRef / resolveEntityRefOrThrow (K148)", () => {
  const labels = [
    { id: ID_A, name: "urgent" },
    { id: ID_B, name: "twin" },
    { id: ID_C, name: "twin" },
  ];
  const err = (m: string): Error => new Error(m);

  it("an ID-shaped input matches by ID only, never by name", () => {
    // A legacy entity whose *name* is another entity's ID.
    const tricky = [{ id: ID_A, name: "a" }, { id: ID_B, name: ID_A }];
    expect(resolveEntityRefOrThrow("label", tricky, ID_A, {}, err).id).toBe(ID_A);
    expect(matchEntityRef(labels, "01M3JSJ7J3QBTDKH0VT5THF6EZ").kind).toBe("not_found");
  });

  it("anything else is a name", () => {
    expect(resolveEntityRefOrThrow("label", labels, "urgent", {}, err).id).toBe(ID_A);
  });

  it("refuses an ambiguous name, listing each match with its ID", () => {
    expect(() => resolveEntityRefOrThrow("label", labels, "twin", {}, err))
      .toThrow(`'twin' matches 2 labels: twin (${ID_B}), twin (${ID_C}). Use the ID.`);
  });

  it("says a name or an ID matched nothing", () => {
    expect(() => resolveEntityRefOrThrow("sprint", labels, "nope", {}, err))
      .toThrow("No sprint named 'nope'.");
    expect(() => resolveEntityRefOrThrow("milestone", labels, "01M3JSJ7J3QBTDKH0VT5THF6EZ", {}, err))
      .toThrow("No milestone with ID '01M3JSJ7J3QBTDKH0VT5THF6EZ'.");
  });

  it("leaves archived entities out unless asked", () => {
    const pool = [{ id: ID_A, name: "old", archived: true }];
    expect(matchEntityRef(pool, "old").kind).toBe("not_found");
    expect(matchEntityRef(pool, "old", { includeArchived: true }).kind).toBe("match");
  });

  it("matches a user by a unique case-insensitive prefix only when asked", () => {
    const users = [{ id: ID_A, name: "Ada" }, { id: ID_B, name: "Adam" }, { id: ID_C, name: "Bea" }];
    expect(matchEntityRef(users, "be").kind).toBe("not_found");
    expect(resolveEntityRefOrThrow("user", users, "be", { prefix: true }, err).id).toBe(ID_C);
    expect(() => resolveEntityRefOrThrow("user", users, "ad", { prefix: true }, err))
      .toThrow(`'ad' matches 2 users: Ada (${ID_A}), Adam (${ID_B}). Use the ID.`);
    // The exact name wins over a longer name it prefixes.
    expect(resolveEntityRefOrThrow("user", users, "Ada", { prefix: true }, err).id).toBe(ID_A);
  });

  it("matches a project's slug ahead of a name", () => {
    const projects = [{ id: ID_A, name: "web", slug: "site" }, { id: ID_B, name: "Web", slug: "web" }];
    expect(resolveEntityRefOrThrow("project", projects, "web", {}, err).id).toBe(ID_B);
  });

  it("never reads a non-ID-shaped input as an ID, even one hand-edited into that shape (K149)", () => {
    expect(() => resolveEntityRefOrThrow("label", [{ id: "bug", name: "Bug" }], "bug", {}, err))
      .toThrow("No label named 'bug'.");
    expect(matchEntityRef([{ id: "bug", name: "Bug" }], "bug")).toEqual({ kind: "not_found" });
  });
});

describe("an ID-shaped name is refused on create and rename (K148)", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-id-names-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("labels", async () => {
    await expect(createLabel(locttDir, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const l = await createLabel(locttDir, { name: "ok" });
    await expect(editLabel(locttDir, l.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("milestones", async () => {
    await expect(createMilestone(locttDir, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const m = await createMilestone(locttDir, { name: "ok" });
    await expect(editMilestone(locttDir, m.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("sprints", async () => {
    const dates = { start_date: "2026-01-01", end_date: "2026-01-14", state: "future" as const };
    await expect(createSprint(locttDir, { name: ID_A, ...dates })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const s = await createSprint(locttDir, { name: "ok", ...dates });
    await expect(editSprint(locttDir, s.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("projects", async () => {
    await expect(createProject(locttDir, { name: ID_A, prefix: "ZZ" })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const p = await createProject(locttDir, { name: "ok", prefix: "OK" });
    await expect(editProject(locttDir, p.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("users", async () => {
    await expect(createUser(locttDir, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const u = await createUser(locttDir, { name: "ok" });
    await expect(updateUser(locttDir, u.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("saved views", async () => {
    await expect(createView(locttDir, { name: ID_A, filters: [] })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
    const v = await createView(locttDir, { name: "ok", filters: [] });
    await expect(editView(locttDir, v.id, { name: ID_A })).rejects.toThrow(ID_SHAPED_NAME_MESSAGE);
  });

  it("a name that merely contains an ID, or is lower case, is allowed", async () => {
    await expect(createLabel(locttDir, { name: `x${ID_A}` })).resolves.toBeDefined();
    await expect(createLabel(locttDir, { name: ID_A.toLowerCase() })).resolves.toBeDefined();
  });
});

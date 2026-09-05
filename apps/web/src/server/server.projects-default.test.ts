import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/projects` and the two senses of "default".
 *
 * SHL-5 marks the *active* project in the sidebar — the one a new task
 * would land in. That resolution prefers the current user's
 * `default_project` over the workspace default, and the response
 * previously carried only the latter, so the star pointed at a project
 * the user's own writes would not go to.
 *
 * `default` keeps meaning the workspace value (the settings panel edits
 * it); `effective_default` is what the sidebar reads.
 */
describe("GET /api/projects default resolution", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-projdefault-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function projects(): Promise<{
    items: { id: string; name: string }[];
    default: string | null;
    effective_default?: string | null;
  }> {
    const res = await fetch(`${base}/api/projects`);
    expect(res.status).toBe(200);
    return res.json() as Promise<{
      items: { id: string; name: string }[];
      default: string | null;
      effective_default?: string | null;
    }>;
  }

  it("carries an effective default alongside the workspace default", async () => {
    const body = await projects();
    expect("effective_default" in body).toBe(true);
    // With one project and no per-user override, both name it.
    expect(body.effective_default).toBe(body.items[0]?.id);
  });

  it("prefers the current user's default_project over the workspace default", async () => {
    // A second project, made the workspace default.
    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Second", prefix: "SEC-" }),
    });
    expect(created.status).toBeLessThan(300);
    const second = (await created.json()) as { id: string };

    const before = await projects();
    const first = before.items.find(p => p.id !== second.id);
    expect(first).toBeTruthy();

    // The current user points at the *other* project.
    const put = await fetch(`${base}/api/user-settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ default_project: second.id }),
    });
    expect(put.status).toBeLessThan(300);

    const after = await projects();
    // The workspace value is untouched — the settings panel still edits
    // that one — while the sidebar's mark moves to the user's choice.
    expect(after.default).toBe(before.default);
    expect(after.effective_default).toBe(second.id);
    expect(after.effective_default).not.toBe(after.default);
  });
});

/**
 * NEW-20 / K23: a workspace `default:` naming a project that no longer
 * exists is tolerated drift. The projects surface must NOT go dark
 * (before K23 it returned 400 config_invalid over one stale pointer).
 * Instead: a healthy 200 list, `effective_default` fallen through to
 * null, and a `default_drift` advisory carrying the stale id so the
 * panel can name it.
 */
describe("GET /api/projects with a ghost workspace default (NEW-20)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-ghostdefault-"));
    await initLoctt(root);
    // Two projects so resolution cannot fall to a sole project, then a
    // hand-edited default pointing at neither — exactly the drift a
    // rename or manual edit leaves behind.
    const { writeFile } = await import("node:fs/promises");
    const { readFile } = await import("node:fs/promises");
    const cfgPath = join(root, ".loctt/config/projects.yaml");
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ name: "Second", prefix: "SEC-" }),
    });
    const raw = await readFile(cfgPath, "utf8");
    // init writes a `default:` line already; replace it (appending a
    // second would be a duplicate YAML key), or add one if absent.
    const ghosted = /^default:.*$/m.test(raw)
      ? raw.replace(/^default:.*$/m, "default: PROJ-does-not-exist")
      : `${raw.trimEnd()}\ndefault: PROJ-does-not-exist\n`;
    await writeFile(cfgPath, ghosted, "utf8");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies NEW-20
  it("NEW-20: returns a healthy list with a drift notice, not a 400", async () => {
    const res = await fetch(`${base}/api/projects`);
    // Healthy — the ghost default no longer takes the surface down.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: { id: string }[];
      effective_default: string | null;
      default_drift?: { kind: string; default: string };
    };
    expect(body.items.length).toBe(2);
    // Resolution ignored the ghost: with two projects and no valid
    // default there is no defensible answer, i.e. the ask state.
    expect(body.effective_default).toBeNull();
    // ...and the drift is surfaced, naming the stale pointer.
    expect(body.default_drift).toEqual({ kind: "missing", default: "PROJ-does-not-exist" });
  });
});

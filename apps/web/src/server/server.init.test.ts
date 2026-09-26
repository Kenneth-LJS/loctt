import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `/api/info` and `/api/init` against the three states a directory can
 * be in before it is a tracker.
 *
 * The browser spec asserts what the user sees; this asserts what the
 * wire says, because the two ONB-16 / SET-30 answers are decided
 * server-side and a client cannot recover a distinction the server
 * never sent.
 */
describe("init and tracker state over HTTP", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map(fn => fn()));
  });

  async function serve(setup: (root: string) => Promise<void>): Promise<{ root: string; base: string }> {
    const root = await mkdtemp(join(tmpdir(), "loctt-web-init-"));
    await setup(root);
    const app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    cleanup.push(async () => {
      await app.stop();
      await rm(root, { recursive: true, force: true });
    });
    return { root, base: `http://127.0.0.1:${String(port)}` };
  }

  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
      body: JSON.stringify(body),
    });

  // @verifies ONB-1
  it("reports `absent` for a directory with no .loctt", async () => {
    const { base } = await serve(async () => { /* nothing */ });
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
    const body = await res.json() as { exists: boolean; initState: string };
    expect(body.exists).toBe(false);
    expect(body.initState).toBe("absent");
  });

  // @verifies ONB-16
  it("answers 200 with `empty` for an empty .loctt rather than refusing on the schema guard", async () => {
    const { base } = await serve(async root => { await mkdir(join(root, ".loctt")); });
    const res = await fetch(`${base}/api/info`);
    // The bug this pins: an empty `.loctt/` has no `.schema-version`,
    // so the guard refused every route including `/api/info` with a
    // 409, and the user got the schema banner instead of the wizard.
    expect(res.status).toBe(200);
    const body = await res.json() as { initState: string };
    expect(body.initState).toBe("empty");
  });

  // @verifies ONB-16
  it("initializes into an empty .loctt with the caller's own prefix and name", async () => {
    const { root, base } = await serve(async r => { await mkdir(join(r, ".loctt")); });
    const res = await post(base, { prefix: "WEB", projectLabel: "Website", docs: false });
    expect(res.status).toBe(201);

    // The far end. Core sets up an empty `.loctt/` like a missing one
    // (B22, K129): the full fresh set, not the repair subset the server
    // used to ask for, which left out .gitignore and the default user.
    const locttDir = join(root, ".loctt");
    await expect(stat(join(locttDir, ".gitignore"))).resolves.toBeTruthy();
    await expect(stat(join(locttDir, "users"))).resolves.toBeTruthy();
    await expect(stat(join(locttDir, "state.yaml"))).resolves.toBeTruthy();
    await expect(stat(join(locttDir, ".schema-version"))).resolves.toBeTruthy();
    const projects = await readFile(join(locttDir, "config", "projects.yaml"), "utf8");
    expect(projects).toContain("WEB");
    expect(projects).toContain("Website");
    expect(await readFile(join(locttDir, "state.yaml"), "utf8")).toContain("WEB");
  });

  /**
   * SET-30, the half that must not move: a `.loctt/` holding tasks but
   * missing `.schema-version` is damaged. The guard keeps refusing,
   * and init is never offered — a repair here would rewrite
   * `state.yaml` with the counter back at 1 and reissue live keys.
   */
  it("keeps refusing a damaged tracker, and does not initialize over it", async () => {
    const { root, base } = await serve(async r => {
      await initLoctt(r);
      await unlink(join(r, ".loctt", ".schema-version"));
    });

    const info = await fetch(`${base}/api/info`);
    expect(info.status).toBe(409);
    const envelope = await info.json() as { code: string };
    expect(envelope.code).toBe("schema_mismatch");

    // And init refuses rather than repairing over surviving data.
    const before = await readFile(join(root, ".loctt", "state.yaml"), "utf8");
    const res = await post(base, { prefix: "NEW", projectLabel: "Clobber" });
    expect(res.status).toBe(400);
    const after = await readFile(join(root, ".loctt", "state.yaml"), "utf8");
    expect(after, "init rewrote state.yaml on a damaged tracker").toBe(before);
    const projects = await readFile(join(root, ".loctt", "config", "projects.yaml"), "utf8");
    expect(projects).not.toContain("Clobber");
  });

  /**
   * The dangerous shape, and the one the cheap guard could get wrong:
   * **every** core file gone, but tasks still on disk. `missingCoreFiles`
   * alone says "nothing here"; only the `tasks/` check keeps this
   * guarded. Initializing here would write a fresh `state.yaml` with
   * the counter at 1 and reissue keys these tasks already hold.
   */
  it("keeps refusing when core files are all gone but tasks survive", async () => {
    const { root, base } = await serve(async r => {
      await mkdir(join(r, ".loctt", "tasks", "01SURVIVOR"), { recursive: true });
      await writeFile(
        join(r, ".loctt", "tasks", "01SURVIVOR", "task.md"),
        "---\nid: 01SURVIVOR\nkey: T-1\ntitle: survivor\n---\n",
        "utf8",
      );
    });

    // The guard still applies: no `.schema-version`, and this is not
    // an empty directory.
    const info = await fetch(`${base}/api/info`);
    expect(info.status).toBe(409);

    // And init does not run over it.
    const res = await post(base, { prefix: "NEW", projectLabel: "Clobber" });
    expect(res.status).toBe(400);
    // The survivor is untouched, and no state.yaml was minted beside it.
    const survivor = await readFile(
      join(root, ".loctt", "tasks", "01SURVIVOR", "task.md"), "utf8",
    );
    expect(survivor).toContain("survivor");
    await expect(stat(join(root, ".loctt", "state.yaml"))).rejects.toThrow();
  });

  // @verifies ONB-17
  it("refuses a second init against a healthy tracker without duplicating the project", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r, { prefix: "WEB" }); });
    const res = await post(base, { prefix: "OTHER", projectLabel: "Second" });
    expect(res.status).toBe(400);
    const projects = await readFile(join(root, ".loctt", "config", "projects.yaml"), "utf8");
    // One project, one counter — the losing tab of a concurrent init
    // must not double either.
    expect(projects.match(/^\s*-\s+id:/gm)?.length ?? 0).toBe(1);
    expect(projects).not.toContain("OTHER");
  });

  // @verifies ONB-5
  // @verifies ONB-21
  it("names the default user it would create, never an empty name", async () => {
    const { base } = await serve(async () => { /* nothing */ });
    const body = await (await fetch(`${base}/api/info`)).json() as { defaultUserName: string };
    expect(body.defaultUserName.length).toBeGreaterThan(0);
    expect(body.defaultUserName).not.toBe("undefined");
  });
});

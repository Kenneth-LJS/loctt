import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Phase Z — the web server's error mapping for causes the top-level
 * catch used to flatten.
 *
 * Three defects, all of the ERR-31 class ("a knowable cause reported as
 * unknown, or as the wrong cause"):
 *
 *  1. An unreadable config/state file (`UnreadableFileError`) was a
 *     plain `Error`, so the dispatcher's `LocttError` branch missed it
 *     and it fell through to `500 code:"unknown" recovery:"retry"` —
 *     white-screening the list surface and blaming the server for a
 *     file only the user can fix.
 *  2. `POST /api/init` mapped every failure — including a raw
 *     filesystem error — to `400 validation_failed field:"prefix"`,
 *     pinning a disk/permission fault on the prefix input.
 *  3. `GET /api/search` used the plain loader and silently dropped
 *     unreadable tasks, unlike `/api/tasks` and export which name them.
 *
 * `chmod 000` is skipped when the process can read regardless (root in
 * CI): the assertion would be vacuous, so the test would not fail if
 * the mapping regressed.
 */

interface Harness {
  root: string;
  base: string;
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(fn => fn()));
});

async function serve(
  setup?: (root: string) => Promise<void>,
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-web-phasez-"));
  if (setup) await setup(root);
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  cleanup.push(async () => {
    await app.stop();
    // Restore permissions so rm can recurse even if a test left a
    // file at 000.
    await chmod(root, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, base: `http://127.0.0.1:${String(port)}` };
}

interface Envelope {
  code?: string;
  message?: string;
  field?: string;
  detail?: string;
  data_state?: string;
  recovery?: { kind?: string };
}

// ---- WS1: an unreadable config/state file -----------------------------

describe("WS1: an unreadable config/state file is attributed, not flattened to 500 unknown", () => {
  /**
   * The EISDIR variant — portable, no permission dance. A directory
   * where `workflow.yaml` should be yields `EISDIR`, the same
   * `UnreadableFileError` class as a permission denial.
   */
  it("GET /api/workflow: EISDIR names the file, is not code:unknown/retry", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const cfg = join(root, ".loctt/config/workflow.yaml");
    await rm(cfg);
    await mkdir(cfg);

    const res = await fetch(`${base}/api/workflow`);
    const body = (await res.json()) as Envelope;

    // The bug: unknown + retry, headline blaming the server.
    expect(body.code).not.toBe("unknown");
    expect(body.recovery?.kind).not.toBe("retry");
    expect(String(body.message)).not.toContain("The server failed while");
    // The fix: an io_failed 5xx naming the file in the headline.
    expect(body.code).toBe("io_failed");
    expect(res.status).toBe(500);
    expect(String(body.message)).toContain("workflow.yaml");
    // Retrying the same read cannot help — the user must fix the file.
    expect(body.recovery).toEqual({ kind: "none" });
  });

  /**
   * The primary list surface. `loadOptionalConfigs` re-throws a
   * non-ENOENT read failure, so `/api/tasks` inherits the same fault —
   * this is the white-screen the brief forbids.
   */
  it("GET /api/tasks does not white-screen on an unreadable workflow.yaml", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const cfg = join(root, ".loctt/config/workflow.yaml");
    await rm(cfg);
    await mkdir(cfg);

    const res = await fetch(`${base}/api/tasks`);
    const body = (await res.json()) as Envelope;
    expect(body.code).toBe("io_failed");
    expect(body.code).not.toBe("unknown");
    expect(String(body.message)).toContain("workflow.yaml");
  });

  it("GET /api/search inherits the same attribution", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const cfg = join(root, ".loctt/config/workflow.yaml");
    await rm(cfg);
    await mkdir(cfg);

    const res = await fetch(`${base}/api/search?q=x`);
    const body = (await res.json()) as Envelope;
    expect(body.code).toBe("io_failed");
    expect(body.code).not.toBe("unknown");
  });

  /**
   * The EACCES variant — the doc-comment's own example. Skipped when
   * the process can read the file anyway (root), where the assertion
   * would be vacuous.
   */
  it("GET /api/workflow: EACCES message names the permission cause", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const cfg = join(root, ".loctt/config/workflow.yaml");
    await chmod(cfg, 0o000);
    // If we can still read it, the mapping is untestable here.
    let readable = false;
    try {
      await readdir(join(root, ".loctt/config"));
      const { readFile } = await import("node:fs/promises");
      await readFile(cfg, "utf-8");
      readable = true;
    } catch { /* good — genuinely unreadable */ }
    if (readable) return;

    const res = await fetch(`${base}/api/workflow`);
    const body = (await res.json()) as Envelope;
    expect(body.code).toBe("io_failed");
    expect(String(body.message)).toContain("permission");
    expect(String(body.message)).toContain("workflow.yaml");
  });

  /**
   * A write path over an unreadable state.yaml. The old tail claimed a
   * false `data_state:"unknown"`; as a LocttError with no dataState the
   * envelope omits it rather than guessing.
   */
  it("POST /api/tasks over an unreadable state.yaml is attributed, no false data_state:unknown", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const statePath = join(root, ".loctt/state.yaml");
    await chmod(statePath, 0o000);
    let readable = false;
    try {
      const { readFile } = await import("node:fs/promises");
      await readFile(statePath, "utf-8");
      readable = true;
    } catch { /* genuinely unreadable */ }
    if (readable) return;

    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ title: "x" }),
    });
    const body = (await res.json()) as Envelope;
    expect(body.code).toBe("io_failed");
    expect(body.code).not.toBe("unknown");
    expect(String(body.message)).toContain("state.yaml");
    // The old bug asserted data_state:"unknown" though nothing was
    // written; io_failed here carries no such claim.
    expect(body.data_state).not.toBe("unknown");
  });
});

// ---- WS2: init failure attribution ------------------------------------

describe("WS2: POST /api/init does not blame the prefix for non-prefix failures", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
      body: JSON.stringify(body),
    });

  /**
   * A raw filesystem error: the project root exists but is not
   * writable, so init's `mkdir` throws `EACCES`. It must not be pinned
   * on the prefix input with a retry that cannot succeed.
   */
  it("a filesystem error is io_failed, not field:prefix", async () => {
    const { root, base } = await serve(async r => { await chmod(r, 0o555); });
    // Root readable-but-not-writable is the fixture; if the process
    // can write anyway (root), init would succeed and there is nothing
    // to assert.
    let writable = false;
    try {
      await writeFile(join(root, ".probe"), "x", "utf-8");
      writable = true;
    } catch { /* good — not writable */ }
    if (writable) return;

    const res = await post(base, { prefix: "T" });
    const body = (await res.json()) as Envelope;

    // The bug: a valid prefix flagged as the problem, with a useless
    // retry.
    expect(body.field).not.toBe("prefix");
    expect(body.code).not.toBe("validation_failed");
    // The fix: attributed as an IO failure, nothing written.
    expect(body.code).toBe("io_failed");
    expect(body.data_state).toBe("not_saved");
  });

  /**
   * A damaged tracker (core files gone, tasks on disk) reaching init is
   * a repair problem, not a prefix problem.
   */
  it("a repair-needed tracker is not field:prefix", async () => {
    const { base } = await serve(async r => {
      await mkdir(join(r, ".loctt/tasks/01SURVIVOR"), { recursive: true });
      await writeFile(
        join(r, ".loctt/tasks/01SURVIVOR/task.md"),
        "---\nid: 01SURVIVOR\nkey: T-1\ntitle: survivor\n---\n",
        "utf-8",
      );
    });

    const res = await post(base, { prefix: "T" });
    const body = (await res.json()) as Envelope;
    expect(body.field).not.toBe("prefix");
    expect(body.code).not.toBe("validation_failed");
    // Its own message survives, naming the repair route.
    expect(String(body.message)).toMatch(/repair/i);
  });

  /**
   * The genuine input error keeps its prefix attribution — the fix
   * narrows the field, it does not remove it.
   */
  it("an empty prefix is still a prefix validation error", async () => {
    const { base } = await serve(async r => { await mkdir(join(r, ".loctt")); });
    const res = await post(base, { prefix: "" });
    const body = (await res.json()) as Envelope;
    expect(res.status).toBe(400);
    expect(body.field).toBe("prefix");
    expect(body.code).toBe("validation_failed");
  });
});

// ---- WS3: search surfaces unreadable tasks ----------------------------

describe("WS3: GET /api/search surfaces unreadable tasks like /api/tasks", () => {
  it("names an unreadable task instead of dropping it silently", async () => {
    const { root, base } = await serve(async r => { await initLoctt(r); });
    const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };
    const mk = (title: string) =>
      fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf, body: JSON.stringify({ title }),
      });
    await mk("pelican alpha");
    await mk("pelican beta");

    // chmod 000 one task.md.
    const tasksDir = join(root, ".loctt/tasks");
    const ids = await readdir(tasksDir);
    const victim = join(tasksDir, ids[0] as string, "task.md");
    await chmod(victim, 0o000);
    let readable = false;
    try {
      const { readFile } = await import("node:fs/promises");
      await readFile(victim, "utf-8");
      readable = true;
    } catch { /* genuinely unreadable */ }
    if (readable) return;

    // /api/tasks reports it — the reference behaviour.
    const listBody = (await (await fetch(`${base}/api/tasks`)).json()) as {
      unreadable?: { path: string }[];
    };
    expect(listBody.unreadable).toBeDefined();

    // /api/search must now do the same.
    const searchRes = await fetch(`${base}/api/search?q=pelican`);
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as {
      items: unknown[];
      unreadable?: { path: string }[];
    };
    // The bug: the key was absent entirely; the file was dropped
    // without a word.
    expect(searchBody.unreadable).toBeDefined();
    expect(searchBody.unreadable?.length).toBeGreaterThan(0);
    expect(searchBody.unreadable?.[0]?.path).toContain("task.md");
  });

  it("omits the unreadable key when every task is readable", async () => {
    const { base } = await serve(async r => { await initLoctt(r); });
    const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };
    await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "pelican gamma" }),
    });
    const body = (await (await fetch(`${base}/api/search?q=pelican`)).json()) as {
      unreadable?: unknown;
    };
    expect(body.unreadable).toBeUndefined();
  });
});

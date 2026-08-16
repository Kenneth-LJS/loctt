import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies ONB-C6
 *
 * When the schema guard blocks the app, a cold-loading browser has no
 * cached state — every endpoint refuses, so the refusal itself has to
 * explain what is wrong and what to do. It does, via the structured
 * envelope.
 *
 * What it got wrong was the "what to do": every mismatch that was not
 * `SchemaTooNewError` was offered `loctt migrate` as the recovery
 * command, including a missing `.schema-version`, which `loctt migrate`
 * refuses outright — it needs a recorded version to migrate from. The
 * user spends a round trip discovering the suggested fix cannot work.
 */

interface Harness {
  root: string;
  base: string;
  stop: () => Promise<void>;
}

const started: Harness[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop();
    if (h) {
      await h.stop();
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-guard-"));
  await initLoctt(root);
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  const h: Harness = { root, base: `http://127.0.0.1:${port}`, stop: () => app.stop() };
  started.push(h);
  return h;
}

interface Envelope {
  code: string;
  message: string;
  detail?: string;
  recovery?: { kind: string; command?: string };
}

describe("web schema guard", () => {
  it("lets a cold client learn why it is blocked, from any endpoint", async () => {
    const { root, base } = await harness();
    await rm(join(root, ".loctt/.schema-version"), { force: true });

    // A fresh browser session has nothing cached, so whichever request
    // it makes first has to carry the explanation.
    for (const path of ["/api/info", "/api/tasks", "/api/workflow"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(409);
      const body = await res.json() as Envelope;
      expect(body.code).toBe("schema_mismatch");
      // Named, not a bare status: the UI branches on `code` and shows
      // `message`, and neither may be empty.
      expect(body.message.length).toBeGreaterThan(0);
    }
  });

  it("does not offer a migrate command that cannot help", async () => {
    const { root, base } = await harness();
    await rm(join(root, ".loctt/.schema-version"), { force: true });

    const res = await fetch(`${base}/api/info`);
    const body = await res.json() as Envelope;

    // `loctt migrate` refuses on a tracker with no recorded version —
    // offering it sends the user on a round trip to find that out.
    expect(body.recovery?.command).toBeUndefined();
    expect(body.recovery?.kind).toBe("none");
    // But something actionable must still be said.
    expect(body.detail).toMatch(/init --repair/);
  });

  it("offers no command for a tracker from a newer LocTT", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/.schema-version"), "99\n", "utf8");

    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(409);
    const body = await res.json() as Envelope;
    expect(body.code).toBe("schema_mismatch");
    // No local command produces a newer LocTT.
    expect(body.recovery?.kind).toBe("none");
    expect(body.message).toMatch(/newer version of LocTT/);
  });

  it("keeps the migrate endpoints reachable while the guard is refusing", async () => {
    const { root, base } = await harness();
    // An empty version file, chosen because the guard and the migrate
    // handler give *different* answers for it — a too-new tracker makes
    // both reply identically, so it could not tell an exempt route from
    // a guarded one.
    await writeFile(join(root, ".loctt/.schema-version"), "", "utf8");

    const guarded = await fetch(`${base}/api/info`);
    const guardedBody = await guarded.json() as Envelope;
    // The guard attaches the remedy it knows about.
    expect(guardedBody.detail).toMatch(/init --repair/);

    // Migration is the remedy for a mismatch, so it cannot be gated
    // behind one. Reaching its own handler is what this asserts: the
    // handler answers without the guard's detail.
    const exempt = await fetch(`${base}/api/migrate/plan`);
    const exemptBody = await exempt.json() as Envelope;
    expect(exemptBody.code).toBe("schema_mismatch");
    expect(exemptBody.detail).toBeUndefined();
  });

  it("serves normally once the schema is valid", async () => {
    const { base } = await harness();
    // Guards against the whole suite passing because every request 409s
    // for some unrelated reason.
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
  });
});

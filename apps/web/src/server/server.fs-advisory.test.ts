import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * XS-50: `loctt ui` boot surfaces the advisory-lock filesystem hazard for
 * ANY tracker — independent of git sync — via `/api/info`'s
 * `fstypeAdvisory`. The hazard is a property of the filesystem, so the
 * detector runs at boot for every tracker rather than only at git-enable.
 *
 * These drive the real detector (`detectSyncFsAdvisory`) rather than
 * mocking it — per the testing philosophy, only the external OS signal is
 * varied, and here it is varied by *where the tracker lives*: a path
 * carrying a sync-provider marker (`/Dropbox/`) trips the path-based
 * classifier, while an ordinary tmp path does not.
 *
 * @verifies XS-50
 */
describe("GET /api/info surfaces the filesystem advisory at boot", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const start = async () => {
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  };

  const info = async () =>
    (await (await fetch(`${base}/api/info`)).json()) as {
      fstypeAdvisory?: { fsClass: string; label: string; message: string };
      cwd: string;
    };

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("names the class when the tracker sits on a sync-service path (no git required)", async () => {
    // A tmp dir whose path contains a Dropbox marker; the tracker is NOT a
    // git repo, proving the advisory is boot-time and not gated on git.
    const parent = await mkdtemp(join(tmpdir(), "loctt-fs-adv-"));
    root = join(parent, "Dropbox", "tracker");
    await mkdir(root, { recursive: true });
    await initLoctt(root);
    await start();

    const body = await info();
    expect(body.fstypeAdvisory).toBeDefined();
    expect(body.fstypeAdvisory?.fsClass).toBe("dropbox");
    expect(body.fstypeAdvisory?.label).toBe("Dropbox");
    expect(body.fstypeAdvisory?.message).toMatch(/advisory locks are not/i);
  });

  it("omits the advisory on an ordinary local path — no false warning", async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-fs-local-"));
    await initLoctt(root);
    await start();

    const body = await info();
    expect(body.fstypeAdvisory).toBeUndefined();
  });
});

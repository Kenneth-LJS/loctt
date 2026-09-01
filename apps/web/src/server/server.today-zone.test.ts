import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadCalendarConfig, saveCalendarConfig, todayInZone } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * VUE-19's remaining UI-side criterion: the date `today` resolves to
 * must be **discoverable**, "and which timezone it used".
 *
 * Core already resolves `today` in the workspace zone across CLI, MCP
 * and web, and `/api/info` already carried the date. What it did not
 * carry was the zone — so a user seeing a date one day off their wall
 * clock had no way to tell a misconfigured `calendar.yaml` from a bug.
 * These tests pin the zone travelling with the date.
 */
describe("GET /api/info reports the zone today was resolved in", () => {
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
    (await (await fetch(`${base}/api/info`)).json()) as { today: string; timezone: string };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-tz-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies VUE-19
  it("names the workspace timezone, not the server's own", async () => {
    const dir = join(root, ".loctt");
    const cfg = await loadCalendarConfig(dir);
    await saveCalendarConfig(dir, { ...cfg, timezone: "America/Los_Angeles" });
    await start();

    const body = await info();
    expect(body.timezone).toBe("America/Los_Angeles");
    // And the date agrees with what core resolves for that zone, so
    // the pair is internally consistent rather than a label attached
    // to a date computed somewhere else.
    expect(body.today).toBe(todayInZone("America/Los_Angeles"));
  });

  // @verifies VUE-19
  it("resolves a date that can differ from UTC's, and says which zone produced it", async () => {
    // Kiritimati is UTC+14: for ten hours a day its date is ahead of
    // UTC's. This is the off-by-one-day result VUE-19 exists for, and
    // the response must explain it rather than leave it bare.
    const dir = join(root, ".loctt");
    const cfg = await loadCalendarConfig(dir);
    await saveCalendarConfig(dir, { ...cfg, timezone: "Pacific/Kiritimati" });
    await start();

    const body = await info();
    expect(body.timezone).toBe("Pacific/Kiritimati");
    expect(body.today).toBe(todayInZone("Pacific/Kiritimati"));

    // The zone is what makes the date explicable: without it, a date
    // that differs from the viewer's is indistinguishable from a bug.
    expect(body.timezone).not.toBe("");
  });

  // @verifies VUE-19
  it("the date and zone always agree, so the pair can be shown together", async () => {
    // POSITIVE CONTROL against a hard-coded label: change the zone and
    // the reported zone must change with it.
    const dir = join(root, ".loctt");
    const cfg = await loadCalendarConfig(dir);
    await saveCalendarConfig(dir, { ...cfg, timezone: "Asia/Singapore" });
    await start();

    const body = await info();
    expect(body.timezone).toBe("Asia/Singapore");
    expect(body.today).toBe(todayInZone(body.timezone));
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCustomField, initLoctt, loadWorkflowConfig, lookupByKey, resolveLocttDir } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * K150 / B45: `POST /api/tasks/:ref/set` with `create_missing: true` — the
 * route behind the picker's "Create “x”" row on an open choice field.
 *
 * @verifies TSK-C15
 */
describe("POST /api/tasks/:ref/set create_missing (K150)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-create-missing-"));
    await initLoctt(root, { docs: false, timezone: "UTC" });
    const locttDir = resolveLocttDir(root);
    await createCustomField(locttDir, {
      key: "area", label: "Area", type: "enum", multi: false, searchable: false,
      values: [{ key: "ui", label: "UI" }], allow_new_values: true,
    });
    await createCustomField(locttDir, {
      key: "closed", label: "Closed", type: "enum", multi: false, searchable: false,
      values: [{ key: "a", label: "A" }],
    });
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
    await fetch(`${base}/api/tasks`, { method: "POST", headers: csrf, body: JSON.stringify({ title: "one" }) });
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const set = (body: unknown): Promise<Response> =>
    fetch(`${base}/api/tasks/T-1/set`, { method: "POST", headers: csrf, body: JSON.stringify(body) });

  it("creates the value on an open field and stores its key", async () => {
    const res = await set({ field: "area", value: "Billing", create_missing: true });
    expect(res.status).toBe(200);
    const locttDir = resolveLocttDir(root);
    expect((await lookupByKey(locttDir, "T-1")).frontmatter.fields?.["area"]).toBe("billing");
    const def = (await loadWorkflowConfig(locttDir)).custom_fields.find(f => f.key === "area");
    expect(def?.values?.map(v => v.key)).toEqual(["ui", "billing"]);
  });

  it("refuses on a closed field with 400 at the field", async () => {
    const res = await set({ field: "closed", value: "B", create_missing: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field?: string };
    expect(body.error).toContain("closed does not allow new values");
    expect(body.field).toBe("closed");
  });

  it("without create_missing, an unknown value is refused as before", async () => {
    const res = await set({ field: "area", value: "Payments" });
    expect(res.status).toBe(400);
  });
});

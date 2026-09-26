import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadQueriesConfig, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies K102-broken-repair on the HTTP surface.
 *
 * `PUT /api/views/:ref` and `DELETE /api/views/:ref` are the only write
 * paths the web client has. Until this change both resolved a ref only
 * against the healthy catalog, so a broken entry answered
 * `400 unknown view: <ulid>` — which is why the dialog's "Replace"
 * button, its confirmation checkbox and the broken row's "Delete" were
 * dead controls.
 *
 * Every assertion below lands on the FILE. VUE-42 shipped believing this
 * worked on tests that only checked a Save button was disabled; a
 * disabled button says nothing about what the server does when the box
 * IS ticked.
 */
describe("view repair over HTTP (K102-broken-repair)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const BROKEN_ID = "01BROKEN00000000000000000B";
  const HEALTHY_ID = "01KEEP000000000000000000AA";

  const queriesPath = (): string => join(root, ".loctt/config/queries.yaml");
  const bytes = async (): Promise<string> => readFile(queriesPath(), "utf8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vbr-"));
    await initLoctt(root);
    await writeFile(
      queriesPath(),
      "queries:\n"
      + `  - id: ${HEALTHY_ID}\n`
      + "    name: keep\n"
      + "    filters:\n"
      + "      - kind: simple\n"
      + "        field: status\n"
      + "        op: \"!=\"\n"
      + "        values: [\"done\"]\n"
      + `  - id: ${BROKEN_ID}\n`
      + "    name: broken-one\n"
      + "    filters: \"not a list\"\n",
      "utf8",
    );
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const putView = (ref: string, body: unknown): Promise<Response> =>
    fetch(`${base}/api/views/${ref}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify(body),
    });

  const doneFilter = { kind: "simple", field: "status", op: "=", values: ["done"] };

  it("PUT without replaceBroken is rejected and the stored text is byte-identical", async () => {
    const before = await bytes();

    const res = await putView(BROKEN_ID, { name: "broken-one", filters: [doneFilter] });

    expect(res.status).toBe(400);
    const body = await res.json() as { message?: string };
    expect(body.message).toContain("broken-one");
    expect(body.message).toContain("replaceBroken: true");
    expect(body.message).not.toContain("unknown view");
    expect(await bytes()).toBe(before);
  });

  it("PUT with replaceBroken repairs the view in place, keeping its id", async () => {
    const res = await putView(BROKEN_ID, {
      name: "broken-one",
      filters: [doneFilter],
      replaceBroken: true,
    });

    expect(res.status).toBe(200);
    const updated = await res.json() as { id: string };
    expect(updated.id).toBe(BROKEN_ID);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    expect(config.queries.find(q => q.id === BROKEN_ID)?.filters).toEqual([doneFilter]);
    expect(await bytes()).not.toContain("not a list");
  });

  it("DELETE without replaceBroken is rejected and the stored text is byte-identical", async () => {
    const before = await bytes();

    const res = await fetch(`${base}/api/views/${BROKEN_ID}`, { method: "DELETE", headers: { "X-Loctt-Client": "test" } });

    expect(res.status).toBe(400);
    expect((await res.json() as { message?: string }).message).toContain("replaceBroken: true");
    expect(await bytes()).toBe(before);
  });

  it("DELETE?replaceBroken=true removes the broken entry, keeping the healthy one", async () => {
    const res = await fetch(
      `${base}/api/views/${BROKEN_ID}?replaceBroken=true`,
      { method: "DELETE", headers: { "X-Loctt-Client": "test" } },
    );

    expect(res.status).toBe(200);
    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    expect(config.queries.find(q => q.id === BROKEN_ID)).toBeUndefined();
    expect(config.queries.find(q => q.id === HEALTHY_ID)).toBeDefined();
  });

  it("POST unarchive on a broken entry is rejected with a clear message", async () => {
    const before = await bytes();

    const res = await fetch(`${base}/api/views/${BROKEN_ID}/unarchive`, { method: "POST", headers: { "X-Loctt-Client": "test" } });

    expect(res.status).toBe(400);
    expect((await res.json() as { message?: string }).message).toContain("cannot be unarchived");
    expect(await bytes()).toBe(before);
  });

  it("a HEALTHY view's PUT and DELETE are unchanged — no flag, no friction", async () => {
    // Constraint 4 of the ruling. A broken sibling in the same file must
    // not add a requirement to the normal path.
    const put = await putView(HEALTHY_ID, { name: "renamed" });
    expect(put.status).toBe(200);
    let config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.id === HEALTHY_ID)?.name).toBe("renamed");

    const del = await fetch(`${base}/api/views/${HEALTHY_ID}`, { method: "DELETE", headers: { "X-Loctt-Client": "test" } });
    expect(del.status).toBe(200);
    config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.id === HEALTHY_ID)).toBeUndefined();
    // And the broken sibling is still preserved, untouched.
    expect(config.broken).toHaveLength(1);
    expect(await bytes()).toContain("not a list");
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

interface Envelope {
  readonly code?: string;
  readonly message?: string;
  readonly detail?: string;
  readonly recovery?: { readonly kind?: string };
}

/**
 * `GET /api/views` against a `queries.yaml` that will not parse
 * (VUE-36, XS-66).
 *
 * `handleListViews` had no try/catch, so `QueriesConfigError` escaped
 * to the generic handler and came back as:
 *
 *   500 {"code":"unknown",
 *        "message":"The server failed while handling GET /api/views.",
 *        "recovery":{"kind":"retry"}}
 *
 * Two things wrong with that, both of which these tests pin:
 *
 *  - The **headline** never named `queries.yaml` or the offending
 *    entry; the loader's real message was demoted to `detail`. A
 *    sidebar rendering the headline told the user nothing actionable.
 *  - `recovery: retry` is wrong advice for a malformed file. Retrying
 *    re-reads the same broken bytes forever; the file must be edited.
 */
describe("GET /api/views with an invalid queries.yaml", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vi-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const corrupt = (yaml: string) =>
    writeFile(join(root, ".loctt/config/queries.yaml"), yaml, "utf8");

  /** @verifies VUE-36 */
  it("names the file and the offending entry in the headline, not in detail", async () => {
    // A view missing its required `query`.
    await corrupt("queries:\n  - id: a\n    name: b\n");

    const res = await fetch(`${base}/api/views`);
    expect(res.status).toBe(400);

    const body = await res.json() as Envelope;
    expect(body.code).toBe("config_invalid");
    // The headline itself — not `detail` — carries both facts.
    expect(body.message).toContain("queries.yaml");
    expect(body.message).toContain("query");
    // Not the generic handler's text.
    expect(body.message).not.toContain("The server failed while handling");
  });

  /** @verifies XS-66 */
  it("does not tell the user to retry a malformed file", async () => {
    await corrupt("queries:\n  - id: a\n    name: b\n");
    const body = await (await fetch(`${base}/api/views`)).json() as Envelope;
    // Retry re-reads the same bytes; the fix is to edit the file.
    expect(body.recovery?.kind).not.toBe("retry");
  });

  it("names the duplicate id when that is the violation", async () => {
    // Both entries are otherwise schema-valid (they carry the now-required
    // `conditions`), so the DUPLICATE-ID violation is what surfaces — not
    // a "conditions is required" schema rejection that would preempt it.
    const dupConditions =
      "    conditions:\n"
      + "      kind: leaf\n"
      + "      field: archived\n"
      + "      op: '!='\n"
      + "      value:\n"
      + "        type: boolean\n"
      + "        value: true\n";
    await corrupt(
      "queries:\n"
      + "  - id: dup\n    name: one\n    query: 'archived != true'\n" + dupConditions
      + "  - id: dup\n    name: two\n    query: 'archived != true'\n" + dupConditions,
    );
    const res = await fetch(`${base}/api/views`);
    expect(res.status).toBe(400);
    const body = await res.json() as Envelope;
    expect(body.message).toContain("duplicate query id");
    expect(body.message).toContain("dup");
  });

  it("still serves a valid queries.yaml as a 200", async () => {
    // Positive control: the guard must not swallow the happy path.
    const res = await fetch(`${base}/api/views`);
    expect(res.status).toBe(200);
    const body = await res.json() as { queries: unknown[] };
    expect(Array.isArray(body.queries)).toBe(true);
  });
});

/**
 * `DELETE /api/views/:ref` and the unarchive route (VUE-25).
 *
 * `deleteView`'s `hard` also defaulted to false, so the route archived
 * while answering `{"deleted": ref}` — the third instance of the same
 * defect, after labels and milestones. And `unarchiveView` was
 * exported from core with no caller anywhere, so an archived view had
 * no way back.
 */
describe("saved-view delete and unarchive", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vd-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const mkView = async (name: string) =>
    (await (await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf,
      body: JSON.stringify({ name, query: "archived != true" }),
    })).json()) as { id: string };

  const listRaw = async () =>
    (await (await fetch(`${base}/api/views`)).json()) as {
      queries: readonly { id: string; archived?: boolean }[];
    };

  it("removes the entry from queries.yaml rather than archiving it", async () => {
    const view = await mkView("doomed");
    expect((await listRaw()).queries.some(q => q.id === view.id)).toBe(true);

    const res = await fetch(`${base}/api/views/${view.id}`, {
      method: "DELETE", headers: csrf,
    });
    expect(res.status).toBe(200);

    // Before the fix this entry was still present with archived: true.
    expect((await listRaw()).queries.some(q => q.id === view.id)).toBe(false);
  });

  it("archives with ?soft=true, keeping the entry runnable by id", async () => {
    const view = await mkView("shelved");
    const res = await fetch(`${base}/api/views/${view.id}?soft=true`, {
      method: "DELETE", headers: csrf,
    });
    expect(res.status).toBe(200);

    const found = (await listRaw()).queries.find(q => q.id === view.id);
    expect(found).toBeDefined();
    expect(found?.archived).toBe(true);
  });

  /** @verifies VUE-25 */
  it("unarchives a view, restoring it with the same id", async () => {
    const view = await mkView("returning");
    await fetch(`${base}/api/views/${view.id}?soft=true`, {
      method: "DELETE", headers: csrf,
    });
    expect((await listRaw()).queries.find(q => q.id === view.id)?.archived).toBe(true);

    const res = await fetch(`${base}/api/views/${view.id}/unarchive`, {
      method: "POST", headers: csrf, body: "{}",
    });
    expect(res.status).toBe(200);

    const found = (await listRaw()).queries.find(q => q.id === view.id);
    // VUE-25's last bullet: same id, no longer archived.
    expect(found).toBeDefined();
    expect(found?.archived).not.toBe(true);
  });
});

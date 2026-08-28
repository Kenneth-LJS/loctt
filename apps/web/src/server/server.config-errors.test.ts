import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * A config file the user broke by hand.
 *
 * XS-61 and XS-62 both turn on the same thing: the report must name
 * the *file* and the *failing field*, and must not collapse into a
 * generic "invalid config". A tracker's config is the one part of it
 * users edit directly, so a message that does not say which file and
 * which line leaves them opening five files to find one typo.
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
  const root = await mkdtemp(join(tmpdir(), "loctt-cfgerr-"));
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
  code?: string;
  message?: string;
  error?: string;
  detail?: string;
}

describe("a config file that fails its schema", () => {
  /**
   * @verifies XS-61
   *
   * "The UI reports which file failed to load, by path, and which
   * field failed, with what was expected."
   */
  it("names the file and the failing field", async () => {
    // Also SHL-43's first bullet: the error names the specific file.
    const { root, base } = await harness();
    // A status with no `key` — the case's own example.
    await writeFile(
      join(root, ".loctt/config/workflow.yaml"),
      "statuses:\n  - label: Todo\n    category: active\n",
      "utf8",
    );

    const res = await fetch(`${base}/api/workflow`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as Envelope;
    const text = `${body.message ?? ""} ${body.detail ?? ""}`;

    expect(body.code).toBe("config_invalid");
    // The file, by name.
    expect(text).toContain("workflow.yaml");
    // The field that failed.
    expect(text).toContain("key");
    // Not a generic collapse.
    expect(text).not.toMatch(/^invalid config\.?$/i);
  });

  /**
   * @verifies XS-61, SHL-43
   *
   * "Views that do not depend on that config still load where
   * possible; the whole app does not white-screen for one bad config
   * file." SHL-43 says the same of a `labels.yaml` that will not
   * parse: it must not take down the task list.
   */
  it("does not take down endpoints that do not read it", async () => {
    const { root, base } = await harness();
    await writeFile(
      join(root, ".loctt/config/labels.yaml"),
      "labels:\n  - name: 5\n    id: []\n",
      "utf8",
    );

    // Labels itself fails...
    expect((await fetch(`${base}/api/labels`)).status).toBeGreaterThanOrEqual(400);
    // ...while the surfaces that never read it keep working.
    expect((await fetch(`${base}/api/info`)).status).toBe(200);
    expect((await fetch(`${base}/api/workflow`)).status).toBe(200);
  });

  /**
   * @verifies XS-62
   *
   * "The message states the constraint — a tracker must have at least
   * one project — and names `projects.yaml`. It does not fall back to
   * a generic config error."
   */
  it("reports the at-least-one-project constraint specifically", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/config/projects.yaml"), "projects: []\n", "utf8");

    const res = await fetch(`${base}/api/projects`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as Envelope;
    const text = `${body.message ?? ""} ${body.detail ?? ""}`;

    expect(text).toContain("projects.yaml");
    expect(text).toMatch(/at least one project/i);
    // Not the generic array message the formatter used to substitute.
    expect(text).not.toMatch(/must contain at least one item/);
    // "The fix is stated" — add a project, or use the CLI.
    expect(text).toMatch(/loctt project create/);
  });
});

describe("a config file legitimately empty of a category", () => {
  /**
   * @verifies XS-32
   *
   * An empty labels list is a *state*, not a failure. Reporting it as
   * one would make a perfectly ordinary tracker look broken — and it
   * is the same conflation ERR-1 forbids, one layer down.
   */
  it("serves an empty labels list as a success", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/config/labels.yaml"), "labels: []\n", "utf8");

    const res = await fetch(`${base}/api/labels`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("serves empty milestones and sprints the same way", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/config/milestones.yaml"), "milestones: []\n", "utf8");
    await writeFile(join(root, ".loctt/config/sprints.yaml"), "sprints: []\n", "utf8");

    for (const path of ["/api/milestones", "/api/sprints"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      const body = await res.json() as { total: number };
      expect(body.total, path).toBe(0);
    }
  });
});

/**
 * @verifies SHL-43
 *
 * Invalid YAML, not a schema violation — a different failure with a
 * different message, and the one a hand-editing user is most likely to
 * produce.
 */
describe("a config file that is not valid YAML", () => {
  it("names the file and does not take down unrelated views", async () => {
    const { root, base } = await harness();
    await writeFile(
      join(root, ".loctt/config/labels.yaml"),
      "labels:\n  - name: [unclosed\n",
      "utf8",
    );

    const res = await fetch(`${base}/api/labels`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as Envelope;
    const text = `${body.message ?? ""} ${body.detail ?? ""}`;
    expect(text).toContain("labels.yaml");

    // A broken labels.yaml does not take down the task list.
    const tasks = await fetch(`${base}/api/tasks`);
    expect(tasks.status).toBe(200);
  });
});

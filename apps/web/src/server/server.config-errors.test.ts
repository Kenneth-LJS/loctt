import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  // @verifies DEG-10
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
  // @verifies DEG-10
  it("does not take down endpoints that do not read it", async () => {
    const { root, base } = await harness();
    await writeFile(
      join(root, ".loctt/config/labels.yaml"),
      "labels:\n  - name: 5\n    id: []\n",
      "utf8",
    );

    // Phase-7B: a corrupt label entry no longer takes labels down — it
    // degrades. /api/labels returns 200 with the bad entry surfaced in
    // `broken` (there were no good ones here, so the list is empty AND
    // broken names why). The point this test guards is unchanged: a
    // corrupt config never white-screens surfaces that don't read it.
    const labelsRes = await fetch(`${base}/api/labels`);
    expect(labelsRes.status).toBe(200);
    expect(((await labelsRes.json()) as { broken?: unknown[] }).broken).toBeDefined();
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

  /**
   * PRU-37 first bullet: a hand edit that removes a required field
   * must surface as a validation error naming the file **and the
   * offending entry** — not an empty project list, which would read
   * as "you have no projects" and invite the user to recreate them.
   *
   * Distinct from XS-62 above: that one is the empty-array
   * constraint. This is a structurally valid file with one bad entry,
   * which is the shape a hand edit actually produces.
   */
  // @verifies PRU-37
  it("PRU-37: names the file and the offending entry when a project loses its prefix", async () => {
    const { root, base } = await harness();
    const cfgPath = join(root, ".loctt/config/projects.yaml");
    const original = await readFile(cfgPath, "utf8");
    // Drop the required `prefix` from the first entry only.
    await writeFile(cfgPath, original.replace(/^\s*prefix:.*\n/m, ""), "utf8");

    const res = await fetch(`${base}/api/projects`);
    // Phase-7B: PRU-37's intent is "the panel must tell broken from
    // none" — do NOT render an empty list as if there are no projects,
    // and name the offending entry. Its MECHANISM changed from a ≥400
    // whole-surface error to a 200 that carries the good projects plus a
    // `broken` list naming the bad one, exactly like VUE-22 does for
    // saved views (north-star P5: one bad project must not blank the
    // rest). This test previously asserted the ≥400 mechanism; rewritten
    // to assert the degrade, which meets the intent more precisely (it
    // distinguishes healthy / broken / absent, not just broken / not).
    expect(res.status).toBe(200);
    const body = await res.json() as { broken?: { index: number; error: string }[] };
    // The offending entry is surfaced as broken, named by index, with
    // the field it is missing in the error — not silently dropped.
    expect(body.broken).toBeDefined();
    expect(body.broken?.some(b => b.index === 0 && /prefix/.test(b.error))).toBe(true);

    // Positive control: with the file restored the endpoint carries no
    // `broken`, so the assertion above is about the bad edit.
    await writeFile(cfgPath, original, "utf8");
    const okRes = await fetch(`${base}/api/projects`);
    expect(okRes.status).toBe(200);
    expect(((await okRes.json()) as { broken?: unknown }).broken).toBeUndefined();
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

/**
 * @verifies SPR-31
 * @verifies SPR-32
 *
 * SPR-32's blocker is a *distinguishability* claim: "a tracker whose
 * sprint fetch failed shows an error with a retry — never the same
 * empty state", and SPR-31 wants the malformed file to name itself.
 *
 * Before M3.5, `handleListSprints` called `loadSprintsConfig` bare, so
 * a malformed file fell through to the generic 500 with
 * `code: io_failed` + `recovery: retry` — the exact envelope a genuine
 * fetch failure produces. The two were byte-identical, and no
 * client-side work can separate identical payloads. That is why this
 * asserts the envelope, not merely that an error occurred: a test
 * checking only `status >= 400` passed the whole time the bug existed.
 */
describe("a malformed sprints.yaml", () => {
  // @verifies DEG-11
  it("is distinguishable from a failed fetch and names the broken rule", async () => {
    const { root, base } = await harness();
    // SPR-31's stated fixture: end_date precedes start_date.
    await writeFile(
      join(root, ".loctt/config/sprints.yaml"),
      "sprints:\n"
      + "  - id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n"
      + "    name: Backwards\n"
      + "    start_date: 2026-02-01\n"
      + "    end_date: 2026-01-01\n"
      + "    state: active\n",
      "utf8",
    );

    const res = await fetch(`${base}/api/sprints`);
    // Phase-7B: a per-entry sprint fault (SPR-31's end<start fixture) now
    // DEGRADES rather than failing the whole surface (north-star P5). The
    // distinguishability SPR-32 demands is preserved and sharpened: the
    // response is a 200 carrying a `broken` list — which is neither the
    // failed-fetch envelope (io_failed + retry) NOR a plain empty state
    // (no `broken`). This test previously asserted the ≥400 mechanism;
    // the intent (broken ≠ failed-fetch ≠ empty) holds, via `broken`.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: unknown[];
      broken?: { index: number; error: string }[];
      code?: string;
      recovery?: { kind?: string };
    };
    // It is NOT the failed-fetch envelope.
    expect(body.code).not.toBe("io_failed");
    expect(body.recovery?.kind).not.toBe("retry");
    // The broken entry is surfaced, naming the rule it broke.
    expect(body.broken).toBeDefined();
    expect(body.broken?.some(b => /end_date|start_date|before|after/i.test(b.error))).toBe(true);

    // One bad file does not blank unrelated views.
    const tasks = await fetch(`${base}/api/tasks`);
    expect(tasks.status).toBe(200);
  });

  /**
   * The other half of SPR-32: zero sprints is a *state*, not a
   * failure, and must stay a 200 so the client can show the
   * "no sprints — see Settings → Sprints" empty state rather than an
   * error. Pairs with the malformed case above; together they pin
   * both sides of the distinction.
   */
  it("is not confused with a tracker that simply has no sprints", async () => {
    const { root, base } = await harness();
    await writeFile(join(root, ".loctt/config/sprints.yaml"), "sprints: []\n", "utf8");

    const res = await fetch(`${base}/api/sprints`);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number };
    expect(body.total).toBe(0);
  });
});

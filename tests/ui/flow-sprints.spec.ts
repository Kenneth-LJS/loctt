/**
 * Transcribed from docs/dev/ui-test-cases/flow-sprints.md — M3.5, the
 * `/sprints` overview. `/sprints/$key` (detail + burndown) is M4.7 and
 * is not exercised here.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag. The
 * prose is the specification: a spec asserting something the case does
 * not claim has drifted from it.
 *
 * SPR-4 is explicit that the evidence is the *file*, not the screen —
 * a view that moved a card optimistically and never landed the write
 * looks identical to one that saved. Every drag case here reads
 * `task.md` (or `loctt show`) back off disk.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Reads one task's `task.md` from disk by key. */
async function readTaskFile(root: string, key: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    try {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (new RegExp(`^key: ${key}$`, "m").test(text)) return text;
    } catch {
      continue;
    }
  }
  throw new Error(`no task file for ${key}`);
}

/** The sprint ids in `sprints.yaml`, in file order, paired with names. */
async function readSprints(root: string): Promise<{ id: string; name: string }[]> {
  const text = await readFile(
    path.join(root, ".loctt", "config", "sprints.yaml"),
    "utf8",
  );
  const out: { id: string; name: string }[] = [];
  const re = /- id:\s*(\S+)\s*\n\s*name:\s*(.+)\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ id: (m[1] ?? "").trim(), name: (m[2] ?? "").trim().replace(/^["']|["']$/g, "") });
  }
  return out;
}

async function writeSprintsYaml(root: string, yaml: string): Promise<void> {
  await writeFile(path.join(root, ".loctt", "config", "sprints.yaml"), yaml, "utf8");
}


/**
 * Stamps `sprint: <id>` into every task file that has no sprint.
 *
 * The same bargain `seedBulk` makes: these are the bytes `loctt set`
 * writes, without paying 400 subprocess spawns for a case about
 * rendering 400 cards.
 */
async function assignAllToSprint(root: string, sprintId: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const file = path.join(tasksDir, id, "task.md");
    try {
      const text = await readFile(file, "utf8");
      if (/^sprint:/m.test(text)) continue;
      await writeFile(file, text.replace(/^(status: .*)$/m, `$1\nsprint: ${sprintId}`), "utf8");
    } catch {
      continue;
    }
  }
}


/**
 * Assigns tasks to a sprint by name, through the CLI.
 *
 * NOT via the fixture's `seed({ fields: { sprint: "Name" } })`: that
 * writes the frontmatter value verbatim, so the sprint *name* would
 * land in a field that stores the `id` — the exact confusion SPR-4
 * exists to rule out, and it would make these specs pass against a
 * view that read names. `loctt set` resolves the name to the id the
 * way a real user's write does.
 */
async function assign(
  tracker: { run(args: readonly string[]): Promise<string> },
  pairs: readonly (readonly [key: string, sprintName: string])[],
): Promise<void> {
  for (const [key, name] of pairs) {
    await tracker.run(["set", key, "sprint", name]);
  }
}

async function dragCard(
  page: import("@playwright/test").Page,
  sourceKey: string,
  target: { readonly x: number; readonly y: number },
): Promise<void> {
  const card = page.getByTestId(`board-card-${sourceKey}`);
  const box = await card.boundingBox();
  if (box === null) throw new Error(`no box for ${sourceKey}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Past the threshold first, so the drag is armed before we aim.
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();

  // Wait for the write AND the re-render it triggers, not just for the
  // mouse gesture to end.
  //
  // The board is not optimistic here: the drop POSTs, `onSettled`
  // invalidates, and the counts move only once the refetch renders. A
  // caller asserting immediately after `mouse.up()` was racing that
  // round trip — measured 2026-09-03, SPR-6 failed 2 of 12 under nine
  // busy-loop processes, always `Expected: "1" / Received: "0"` at the
  // first post-drop count, never a timeout or a locator error.
  //
  // This is the same defect REL-32's `moveUp` had, found the same way
  // and fixed the same way: the response is not the re-render.
  //
  // Bounded and non-asserting. A refused drop leaves the counts as they
  // were, and judging that is the caller's job — so a drop that
  // genuinely fails to land still fails at the caller's assertion
  // rather than being swallowed here.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const pending = await page.evaluate(
      () => document.querySelectorAll('[data-dragging="true"]').length,
    );
    if (pending === 0) break;
    await page.waitForTimeout(25);
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function columnPoint(
  page: import("@playwright/test").Page,
  columnId: string,
): Promise<{ x: number; y: number }> {
  const col = page.getByTestId(`sprint-column-${columnId}`);
  const box = await col.boundingBox();
  if (box === null) throw new Error(`no box for column ${columnId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height - 40 };
}

test.describe("SPR — sprints overview", () => {
  // @verifies SPR-1
  test("SPR-1: one column per non-archived sprint, ordered by start date, headed by name", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Gamma", "--start", "2026-03-01", "--end", "2026-03-14", "--state", "future"]);
    await tracker.run(["sprint", "create", "Alpha", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "completed"]);
    await tracker.run(["sprint", "create", "Beta", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Retired", "--start", "2025-01-01", "--end", "2025-01-14", "--state", "completed"]);
    await tracker.run(["sprint", "archive", "Retired"]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId("sprints")).toBeVisible();

    const sprints = await readSprints(tracker.root);
    const byName = new Map(sprints.map(s => [s.name, s.id]));

    // Ordered by start_date ascending, whatever order they were made.
    const headers = page.locator('[data-testid^="sprint-name-"]');
    await expect(headers).toHaveText(["Alpha", "Beta", "Gamma", "No sprint"]);

    // The header shows the NAME, never the ULID.
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const id = byName.get(name);
      expect(id).toBeTruthy();
      const header = page.getByTestId(`sprint-name-${String(id)}`);
      await expect(header).toHaveText(name);
      await expect(header).not.toContainText(String(id));
      // And the date window is shown alongside it.
      await expect(page.getByTestId(`sprint-window-${String(id)}`)).toBeVisible();
    }

    // The archived sprint is absent with no "show archived" enabled.
    const retiredId = byName.get("Retired");
    await expect(page.getByTestId(`sprint-column-${String(retiredId)}`)).toHaveCount(0);
  });

  // @verifies SPR-1
  test("SPR-1: the header count equals the cards actually rendered", async ({ tracker, page }) => {
    await tracker.run(["sprint", "create", "S1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    const sprints = await readSprints(tracker.root);
    const id = sprints[0]?.id ?? "";
    const seeded = await tracker.seed([
      { title: "one" }, { title: "two" }, { title: "three" },
    ]);
    await assign(tracker, [
      [String(seeded[0]), "S1"],
      [String(seeded[1]), "S1"],
    ]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-count-${id}`)).toHaveText("2");
    // `[data-testid^="board-card-"]` also matches each card's
    // `board-card-field-*` children — measured: 4 hits for 2 cards.
    // The card roots are the ones carrying `data-task-key`.
    await expect(
      page.getByTestId(`sprint-column-${id}`).locator("[data-task-key]"),
    ).toHaveCount(2);
  });

  // @verifies SPR-2
  test("SPR-2: active is expanded and highlighted; future and completed start collapsed", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Now", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Later", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "future"]);
    await tracker.run(["sprint", "create", "Then", "--start", "2026-03-01", "--end", "2026-03-14", "--state", "future"]);
    await tracker.run(["sprint", "create", "Past", "--start", "2025-12-01", "--end", "2025-12-14", "--state", "completed"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const seeded = await tracker.seed([{ title: "in now" }]);
    await assign(tracker, [[String(seeded[0]), "Now"]]);

    await page.goto(`${tracker.baseURL}/sprints`);

    const nowId = String(byName.get("Now"));
    await expect(page.getByTestId(`sprint-toggle-${nowId}`)).toHaveAttribute("aria-expanded", "true");
    // Not colour alone: an explicit marker in the DOM plus the pill.
    await expect(page.getByTestId(`sprint-column-${nowId}`)).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId(`sprint-column-${nowId}`)).toContainText("Active");

    for (const name of ["Later", "Then", "Past"]) {
      const id = String(byName.get(name));
      await expect(page.getByTestId(`sprint-toggle-${id}`)).toHaveAttribute("aria-expanded", "false");
      // Collapsed shows header plus count only.
      await expect(page.getByTestId(`sprint-count-${id}`)).toBeVisible();
      await expect(page.getByTestId(`sprint-placeholder-${id}`)).toHaveCount(0);
    }
  });

  // @verifies SPR-2
  test("SPR-2: clicking a collapsed header expands in place without reordering columns", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Aaa", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "completed"]);
    await tracker.run(["sprint", "create", "Bbb", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));

    await page.goto(`${tracker.baseURL}/sprints`);
    // Wait for the sprints query to land before snapshotting the
    // order. Without this the snapshot raced the fetch and captured
    // only the always-present "No sprint" column — a flake in the
    // test, measured at 2/5, not a reordering in the view.
    await expect(page.locator('[data-testid^="sprint-name-"]')).toHaveCount(3);
    const before = await page.locator('[data-testid^="sprint-name-"]').allTextContents();

    const aId = String(byName.get("Aaa"));
    await page.getByTestId(`sprint-toggle-${aId}`).click();
    await expect(page.getByTestId(`sprint-toggle-${aId}`)).toHaveAttribute("aria-expanded", "true");

    // Same page, same column order.
    await expect(page).toHaveURL(new RegExp("/sprints$"));
    expect(await page.locator('[data-testid^="sprint-name-"]').allTextContents()).toEqual(before);
  });

  // @verifies SPR-3
  test("SPR-3: expand/collapse survives a reload, in both directions, without touching sprints.yaml", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Live", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Done", "--start", "2025-01-01", "--end", "2025-01-14", "--state", "completed"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const liveId = String(byName.get("Live"));
    const doneId = String(byName.get("Done"));

    const yamlBefore = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );

    await page.goto(`${tracker.baseURL}/sprints`);
    // Expand the completed one AND collapse the active one — the
    // second is the half a plain "expanded ids" store cannot express.
    await page.getByTestId(`sprint-toggle-${doneId}`).click();
    await page.getByTestId(`sprint-toggle-${liveId}`).click();

    await page.reload();
    await expect(page.getByTestId(`sprint-toggle-${doneId}`)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId(`sprint-toggle-${liveId}`)).toHaveAttribute("aria-expanded", "false");

    // Per-user UI state: config is untouched.
    const yamlAfter = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );
    expect(yamlAfter).toBe(yamlBefore);
  });

  // @verifies SPR-4
  test("SPR-4: dragging between columns writes the target sprint's id to disk", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "From", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "To", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const fromId = String(byName.get("From"));
    const toId = String(byName.get("To"));
    const [key] = await tracker.seed([{ title: "mover" }]);
    await assign(tracker, [[String(key), "From"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-count-${fromId}`)).toHaveText("1");
    await expect(page.getByTestId(`sprint-count-${toId}`)).toHaveText("0");

    // The request the browser actually sent.
    //
    // Asserting only the resulting file is NOT enough here, and that
    // was measured: with the client mutated to send the sprint *name*,
    // this case still passed, because `POST /set` resolves a name back
    // to its id server-side. The file was right for the wrong reason.
    // SPR-4's claim is about what is written, so the payload is
    // checked directly — only SPR-24's ambiguous-name case catches
    // this otherwise.
    const payloads: unknown[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/tasks\/.+\/set$/.test(req.url())) {
        payloads.push(req.postDataJSON());
      }
    });

    await dragCard(page, String(key), await columnPoint(page, toId));

    // The counts move — and after the refetch, not only optimistically.
    await expect(page.getByTestId(`sprint-count-${toId}`)).toHaveText("1");
    await expect(page.getByTestId(`sprint-count-${fromId}`)).toHaveText("0");

    // Exactly one write per drop, carrying the target sprint's ID.
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ field: "sprint", value: toId });

    // The file: the target sprint's ID, never its name.
    const file = await readTaskFile(tracker.root, String(key));
    expect(file).toMatch(new RegExp(`^sprint: ${toId}$`, "m"));
    expect(file).not.toMatch(/^sprint: To$/m);

    // And the CLI agrees — the change is on disk, not just in the browser.
    const shown = await tracker.run(["show", String(key)]);
    expect(shown).toContain("To");
  });

  // @verifies SPR-4
  test("SPR-4: dropping a card back where it started issues no write", async ({ tracker, page }) => {
    await tracker.run(["sprint", "create", "Only", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const [key] = await tracker.seed([{ title: "stayer" }]);
    await assign(tracker, [[String(key), "Only"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    const before = await readTaskFile(tracker.root, String(key));
    const updatedBefore = /^updated_at: (.+)$/m.exec(before)?.[1];

    await dragCard(page, String(key), await columnPoint(page, id));
    await page.waitForTimeout(500);

    const after = await readTaskFile(tracker.root, String(key));
    // A no-op drop must not bump `updated_at` — that is what "no write
    // at all" means on disk.
    expect(/^updated_at: (.+)$/m.exec(after)?.[1]).toBe(updatedBefore);
    await expect(page.getByTestId("sprints-move-error")).toHaveCount(0);
  });

  // @verifies SPR-5
  test("SPR-5: a refused write returns the card and names task, sprint, and that it was not saved", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "From", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "To", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const fromId = String(byName.get("From"));
    const toId = String(byName.get("To"));
    const [key] = await tracker.seed([{ title: "mover" }]);
    await assign(tracker, [[String(key), "From"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    // The server refuses the write.
    await page.route("**/api/tasks/**/set", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "io_failed", message: "disk is read-only", data_state: "not_saved" }),
      }),
    );

    await dragCard(page, String(key), await columnPoint(page, toId));

    const alert = page.getByTestId("sprints-move-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(String(key));
    await expect(alert).toContainText("To");
    await expect(alert).toContainText("not saved");

    // The card is back, and both counts reverted.
    await expect(page.getByTestId(`sprint-count-${fromId}`)).toHaveText("1");
    await expect(page.getByTestId(`sprint-count-${toId}`)).toHaveText("0");
    // And nothing was written.
    const file = await readTaskFile(tracker.root, String(key));
    expect(file).toMatch(new RegExp(`^sprint: ${fromId}$`, "m"));
  });

  // @verifies SPR-6
  test("SPR-6: dropping on No sprint removes the field rather than writing an empty value", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Held", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    const sprintIds = new Map((await readSprints(tracker.root)).map(x => [x.name, x.id]));
    const [key] = await tracker.seed([{ title: "leaver" }]);
    await assign(tracker, [[String(key), "Held"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await dragCard(page, String(key), await columnPoint(page, "__no_sprint__"));

    await expect(page.getByTestId("sprint-count-__no_sprint__")).toHaveText("1");

    const file = await readTaskFile(tracker.root, String(key));
    // Absent — not "", not null, not the literal "none".
    expect(file).not.toMatch(/^sprint:/m);

    // And it matches "sprint is unset" in the query language, the same
    // way the CLI reports it.
    //
    // The query language has no `is null` / `is unset` operator —
    // measured: `sprint = null`, `sprint is null` and `sprint = empty`
    // all fail or match nothing, while `sprint = "<ULID>"` matches
    // (positive control below). So "unset" is expressed as the
    // negation, which is what the CLI actually offers.
    const held = String(sprintIds.get("Held"));
    const assigned = await tracker.run(["list", "--query", `sprint = "${held}"`]);
    expect(assigned).not.toContain(String(key));
    const unassigned = await tracker.run(["list", "--query", `sprint != "${held}"`]);
    expect(unassigned).toContain(String(key));
  });

  // @verifies SPR-15
  test("SPR-15: an empty sprint renders a designed column reading 0, and accepts a drop", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Full", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Empty", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const emptyId = String(byName.get("Empty"));
    const [key] = await tracker.seed([{ title: "mover" }]);
    await assign(tracker, [[String(key), "Full"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-count-${emptyId}`)).toHaveText("0");
    // An intentional empty state, not a zero-height strip.
    const placeholder = page.getByTestId(`sprint-placeholder-${emptyId}`);
    await expect(placeholder).toBeVisible();
    const box = await page.getByTestId(`sprint-column-${emptyId}`).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(60);

    // Still a valid drop target.
    await dragCard(page, String(key), await columnPoint(page, emptyId));
    await expect(page.getByTestId(`sprint-count-${emptyId}`)).toHaveText("1");
    expect(await readTaskFile(tracker.root, String(key)))
      .toMatch(new RegExp(`^sprint: ${emptyId}$`, "m"));
  });

  // @verifies SPR-17
  test("SPR-17: a 400-task sprint stays usable and the header reads the true total", async ({
    tracker,
    page,
  }) => {
    test.setTimeout(120_000);
    await tracker.run(["sprint", "create", "Big", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    await tracker.seedBulk(400);
    // `loctt bulk` does not exist (measured: "Unknown command: bulk"),
    // and 400 `loctt set` subprocesses would cost minutes. The field
    // is stamped straight into the frontmatter, which is the same
    // thing `set` writes.
    await assignAllToSprint(tracker.root, id);

    await page.goto(`${tracker.baseURL}/sprints`);
    // The TRUE total, not the number of rendered cards.
    await expect(page.getByTestId(`sprint-count-${id}`)).toHaveText("400", { timeout: 60_000 });
    // The DOM holds a bounded window rather than 400 nodes.
    const rendered = await page
      .getByTestId(`sprint-column-${id}`)
      .locator("[data-task-key]")
      .count();
    expect(rendered).toBeLessThan(400);
    expect(rendered).toBeGreaterThan(0);
    // And the page is still interactive.
    await expect(page.getByTestId("sprint-show-more")).toBeVisible();
  });

  // @verifies SPR-19
  test("SPR-19: overlapping active sprints both render, with no task duplicated and no warning", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Early", "--start", "2026-01-01", "--end", "2026-01-20", "--state", "active"]);
    await tracker.run(["sprint", "create", "Late", "--start", "2026-01-10", "--end", "2026-01-30", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const earlyId = String(byName.get("Early"));
    const lateId = String(byName.get("Late"));
    const [k1] = await tracker.seed([{ title: "one" }]);
    await assign(tracker, [[String(k1), "Early"]]);

    await page.goto(`${tracker.baseURL}/sprints`);

    // Both render, both highlighted as active.
    await expect(page.getByTestId(`sprint-column-${earlyId}`)).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId(`sprint-column-${lateId}`)).toHaveAttribute("data-active", "true");

    // The task is in exactly one column, the one it is assigned to.
    await expect(page.getByTestId(`board-card-${String(k1)}`)).toHaveCount(1);
    await expect(
      page.getByTestId(`sprint-column-${earlyId}`).getByTestId(`board-card-${String(k1)}`),
    ).toHaveCount(1);
    await expect(page.getByTestId(`sprint-count-${lateId}`)).toHaveText("0");

    // Nothing calls the overlap invalid — the schema permits it.
    await expect(page.getByText(/overlap/i)).toHaveCount(0);
  });

  // @verifies SPR-20
  test("SPR-20: an active sprint whose window has passed stays active, with an informational hint", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Overrun", "--start", "2020-01-01", "--end", "2020-01-14", "--state", "active"]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const yamlBefore = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );

    await page.goto(`${tracker.baseURL}/sprints`);

    // `state` drives presentation: highlighted and expanded.
    await expect(page.getByTestId(`sprint-column-${id}`)).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId(`sprint-toggle-${id}`)).toHaveAttribute("aria-expanded", "true");

    // The discrepancy is surfaced as a hint, not as an error.
    const hint = page.getByTestId(`sprint-window-hint-${id}`);
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("active");
    await expect(hint).not.toHaveAttribute("role", "alert");

    // Nothing rewrote `state` on the user's behalf.
    await page.waitForTimeout(300);
    expect(await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    )).toBe(yamlBefore);
  });

  // @verifies SPR-24
  test("SPR-24: two sprints sharing a name are distinguishable and drop to the right one", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Sprint 1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Sprint 1", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const all = await readSprints(tracker.root);
    const [first, second] = all;
    const firstId = String(first?.id);
    const secondId = String(second?.id);
    expect(firstId).not.toBe(secondId);

    // Seeded by id, since the name is ambiguous.
    const [key] = await tracker.seed([{ title: "mover" }]);
    await tracker.run(["set", String(key), "sprint", firstId]);

    await page.goto(`${tracker.baseURL}/sprints`);

    // Both columns render, told apart by their date windows.
    await expect(page.getByTestId(`sprint-name-${firstId}`)).toHaveText("Sprint 1");
    await expect(page.getByTestId(`sprint-name-${secondId}`)).toHaveText("Sprint 1");
    await expect(page.getByTestId(`sprint-window-${firstId}`)).toContainText("2026-01-01");
    await expect(page.getByTestId(`sprint-window-${secondId}`)).toContainText("2026-02-01");

    // Dragging into the second assigns THAT sprint's id.
    await dragCard(page, String(key), await columnPoint(page, secondId));
    await expect(page.getByTestId(`sprint-count-${secondId}`)).toHaveText("1");
    expect(await readTaskFile(tracker.root, String(key)))
      .toMatch(new RegExp(`^sprint: ${secondId}$`, "m"));
  });

  // @verifies SPR-27
  test("SPR-27: a task naming a deleted sprint is grouped and the dangling id named", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Keep", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Doomed", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const keepId = String(byName.get("Keep"));
    const doomedId = String(byName.get("Doomed"));
    const [k1, k2] = await tracker.seed([{ title: "kept" }, { title: "orphan" }]);
    await assign(tracker, [[String(k1), "Keep"], [String(k2), "Doomed"]]);

    // Hand-delete the entry, leaving the task pointing at it.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );
    await writeSprintsYaml(
      tracker.root,
      yaml.replace(new RegExp(`\\s*- id: ${doomedId}[\\s\\S]*?(?=\\n\\s*- id:|$)`), ""),
    );

    await page.goto(`${tracker.baseURL}/sprints`);

    // Not silently hidden: its own column, naming the missing id.
    const col = page.getByTestId(`sprint-column-__unknown_sprint__:${doomedId}`);
    await expect(col).toBeVisible();
    await expect(col).toContainText("does not define");
    await expect(page.getByTestId(`sprint-missing-id-__unknown_sprint__:${doomedId}`))
      .toHaveText(doomedId);
    await expect(col.getByTestId(`board-card-${String(k2)}`)).toHaveCount(1);

    // And the rest of the view still renders.
    await expect(page.getByTestId(`sprint-column-${keepId}`)).toBeVisible();
    await expect(
      page.getByTestId(`sprint-column-${keepId}`).getByTestId(`board-card-${String(k1)}`),
    ).toHaveCount(1);
  });

  // @verifies SPR-31
  // Un-fixme'd by the B4 overview lane (A167). The earlier quarantine
  // asserted `sprints-config-error` (a WHOLE-FILE parse failure), but a
  // single sprint whose `end_date` precedes `start_date` is caught by
  // `SprintDefSchema`'s per-entry superRefine, so core reports it as one
  // `BrokenEntry` on the response's `broken[]` — not a file-level error.
  // `SprintsView` surfaces that as the `sprints-broken-config` alert
  // (A138). The fixme asserted the wrong testid; the behaviour SPR-31
  // describes exists on that surface. See decisions.md §8 A167.
  test("SPR-31: a malformed sprints.yaml explains itself instead of blanking the view", async ({
    tracker,
    page,
  }) => {
    await writeSprintsYaml(
      tracker.root,
      [
        "sprints:",
        "  - id: 01M1AQ6K96WRM6WNESPCN4WQEP",
        "    name: Backwards",
        "    start_date: 2026-02-01",
        "    end_date: 2026-01-01",
        "    state: active",
      ].join("\n") + "\n",
    );

    await page.goto(`${tracker.baseURL}/sprints`);

    // The degraded entry is surfaced, not dropped: named, marked, and
    // carrying the validator's message.
    const err = page.getByTestId("sprints-broken-config");
    await expect(err).toBeVisible();
    // Names the file, the offending sprint (by its id), and the rule.
    await expect(err).toContainText("sprints.yaml");
    await expect(err).toContainText("01M1AQ6K96WRM6WNESPCN4WQEP");
    await expect(err).toContainText("must not be before start_date");
    // Tells the user to fix the file and reload; offers no repair.
    await expect(err).toContainText("reload");
    await expect(err).toContainText("will not repair");

    // A138 "tell broken from none": a tracker whose only sprint is
    // corrupt must NOT read as an empty one — the empty state would say
    // "no sprints", contradicting the notice above.
    await expect(page.getByTestId("sprints-empty")).toHaveCount(0);
  });

  // @verifies SPR-31
  test("SPR-31: a broken entry does not blank the healthy sprints beside it", async ({
    tracker,
    page,
  }) => {
    // A valid sprint first, then a backwards-window one. Core partially
    // recovers: the good sprint still loads its column, the bad one is
    // surfaced as broken.
    await tracker.run(["sprint", "create", "Healthy", "--start", "2026-03-01", "--end", "2026-03-14", "--state", "active"]);
    const healthyId = String((await readSprints(tracker.root))[0]?.id);
    const existing = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );
    await writeSprintsYaml(
      tracker.root,
      existing
        + [
          "  - id: 01M1AQ6K96WRM6WNESPCN4WQEP",
          "    name: Backwards",
          "    start_date: 2026-02-01",
          "    end_date: 2026-01-01",
          "    state: active",
        ].join("\n") + "\n",
    );

    await page.goto(`${tracker.baseURL}/sprints`);

    // The healthy sprint still renders its column…
    await expect(page.getByTestId(`sprint-column-${healthyId}`)).toBeVisible();
    // …and the broken one is surfaced beside it, not swallowed. It is
    // named by its id (the loader could read one) and marked broken.
    await expect(page.getByTestId("sprints-broken-config")).toBeVisible();
    await expect(page.getByTestId("sprints-broken-config")).toContainText("01M1AQ6K96WRM6WNESPCN4WQEP");
    await expect(page.getByTestId("sprints-broken-config")).toContainText("(broken)");
  });

  // @verifies SPR-32
  test("SPR-32: zero sprints is an empty state; a failed fetch is an error with a retry", async ({
    tracker,
    page,
  }) => {
    // Zero sprints: an empty state naming the destination.
    await page.goto(`${tracker.baseURL}/sprints`);
    const empty = page.getByTestId("sprints-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No sprints yet");
    await expect(empty).toContainText("Settings");
    await expect(page.getByTestId("sprints-load-error")).toHaveCount(0);

    // A failed fetch: an error with a retry, NEVER the same empty state.
    await page.route("**/api/sprints*", route => route.abort("failed"));
    await page.reload();
    await expect(page.getByTestId("sprints-load-error")).toBeVisible();
    await expect(page.getByTestId("sprints-empty")).toHaveCount(0);
    await expect(page.getByTestId("sprints-load-error").getByRole("button", { name: /retry/i }))
      .toBeVisible();
  });

  // @verifies SPR-36
  test("SPR-36: dropping onto a sprint deleted underneath the session fails loudly", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "From", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Stale", "--start", "2026-02-01", "--end", "2026-02-14", "--state", "active"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const fromId = String(byName.get("From"));
    const staleId = String(byName.get("Stale"));
    const [key] = await tracker.seed([{ title: "mover" }]);
    await assign(tracker, [[String(key), "From"]]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-column-${staleId}`)).toBeVisible();

    // Deleted via the CLI, underneath the open session.
    await tracker.run(["sprint", "delete", "Stale", "--yes"]);

    await dragCard(page, String(key), await columnPoint(page, staleId));

    // The write is rejected and the card returns.
    const alert = page.getByTestId("sprints-move-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(String(key));
    await expect(alert).toContainText(/no longer exists|unknown sprint/i);
    await expect(alert).toContainText("Reload");
    await expect(page.getByTestId(`sprint-count-${fromId}`)).toHaveText("1");
    expect(await readTaskFile(tracker.root, String(key)))
      .toMatch(new RegExp(`^sprint: ${fromId}$`, "m"));

    // The stale column is gone on refresh, not a phantom drop target.
    await page.reload();
    await expect(page.getByTestId(`sprint-column-${staleId}`)).toHaveCount(0);
  });

  // @verifies SPR-39
  test("SPR-39: the overview card surfaces progress, dates, days-remaining, and a mini-bar", async ({
    tracker,
    page,
  }) => {
    // An end well in the future so the countdown reads "days left", not
    // overdue, whatever the tracker's clock is.
    await tracker.run(["sprint", "create", "Cadence", "--start", "2020-01-01", "--end", "2099-12-31", "--state", "active"]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    // Four tasks: 2 done, 1 open, 1 discarded → done/total is 2/3 (the
    // discarded one is excluded from the total, per core's Progress).
    const seeded = await tracker.seed([
      { title: "a" }, { title: "b" }, { title: "c" }, { title: "d" },
    ]);
    await assignById(tracker, seeded.map(k => [String(k), id] as const));
    // Move two to a completed-category status and one to discarded
    // (`wont_do` in the default workflow). The discarded task is
    // excluded from the total, so done/total is 2/3, not 2/4.
    await tracker.run(["set", String(seeded[0]), "status", "done"]);
    await tracker.run(["set", String(seeded[1]), "status", "done"]);
    await tracker.run(["set", String(seeded[3]), "status", "wont_do"]);

    await page.goto(`${tracker.baseURL}/sprints`);

    // Progress done/total, from core — the discarded task is excluded.
    const progress = page.getByTestId(`sprint-progress-${id}`);
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("2/3");

    // The mini-bar (burndown equivalent) reflects the same fraction.
    const bar = page.getByTestId(`sprint-progress-bar-${id}`);
    await expect(bar).toHaveAttribute("data-fill", (2 / 3).toFixed(4));

    // The date range and the days-remaining countdown are both shown.
    await expect(page.getByTestId(`sprint-window-${id}`)).toBeVisible();
    await expect(page.getByTestId(`sprint-countdown-${id}`)).toContainText(/days left/);

    // K-14: the whole at-a-glance card opens the detail route.
    await page.getByTestId(`sprint-card-${id}`).click();
    await expect(page.getByTestId("sprint-detail")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/sprints/${id}`);
  });

  // @verifies SPR-39
  test("SPR-39: clicking the Open-sprint link inside the card does not double-fire the card", async ({
    tracker,
    page,
  }) => {
    // The inner link is a nested control: its click is the link's, not
    // the card's, so the two never race to navigate.
    await tracker.run(["sprint", "create", "Cadence", "--start", "2026-01-01", "--end", "2099-12-31", "--state", "active"]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints`);
    await page.getByTestId(`sprint-open-${id}`).click();
    await expect(page.getByTestId("sprint-detail")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/sprints/${id}`);
  });

  // @verifies SPR-40
  test("SPR-40: the overview hides archived sprints until the show-archived toggle is on", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Live", "--start", "2026-06-01", "--end", "2026-06-14", "--state", "active"]);
    await tracker.run(["sprint", "create", "Retired", "--start", "2025-01-01", "--end", "2025-01-14", "--state", "completed"]);
    await tracker.run(["sprint", "archive", "Retired"]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const liveId = String(byName.get("Live"));
    const retiredId = String(byName.get("Retired"));

    await page.goto(`${tracker.baseURL}/sprints`);

    // Archived is hidden by default; the live one shows.
    await expect(page.getByTestId(`sprint-column-${liveId}`)).toBeVisible();
    await expect(page.getByTestId(`sprint-column-${retiredId}`)).toHaveCount(0);

    // The toggle reveals it in place — a local view state, no write.
    const yamlBefore = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );
    await page.getByTestId("sprints-show-archived").check();
    await expect(page.getByTestId(`sprint-column-${retiredId}`)).toBeVisible();
    const yamlAfter = await readFile(
      path.join(tracker.root, ".loctt", "config", "sprints.yaml"), "utf8",
    );
    expect(yamlAfter).toBe(yamlBefore);
  });

  // @verifies SPR-40
  test("SPR-40: the overview links to Settings → Sprints for the lifecycle actions", async ({
    tracker,
    page,
  }) => {
    await tracker.run(["sprint", "create", "Live", "--start", "2026-06-01", "--end", "2026-06-14", "--state", "active"]);

    await page.goto(`${tracker.baseURL}/sprints`);
    await page.getByTestId("sprints-manage-link").click();

    // Lands on the Settings Sprints panel, where create/delete/archive live.
    await expect(page.getByTestId("sprints-panel")).toBeVisible();
    await expect(page.getByTestId("sprint-create-form")).toBeVisible();
  });
});

/**
 * Assigns tasks to a sprint by its **ULID**, through the CLI.
 *
 * Deliberately not the `assign` helper above, which passes the sprint
 * *name*. `setField` resolves a name to an id for the frontmatter but
 * records the raw, unresolved value in `_history.yaml`
 * (known-gaps.md), and the burndown replays history — so a
 * name-assigned task is invisible to every burndown assertion below.
 * The web client itself sends the id, so this is also the more
 * faithful gesture.
 */
async function assignById(
  tracker: { run(args: readonly string[]): Promise<string> },
  pairs: readonly (readonly [key: string, sprintId: string])[],
): Promise<void> {
  for (const [key, id] of pairs) {
    await tracker.run(["set", key, "sprint", id]);
  }
}

/** Overwrites `workflow.yaml`'s `estimation:` block. */
async function setEstimation(root: string, block: string): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  // The block runs to the next top-level key (a non-indented line).
  const next = text.replace(/^estimation:\n(?:[ \t].*\n|\n)*/m, block);
  if (next === text) throw new Error("estimation block not found in workflow.yaml");
  await writeFile(file, next, "utf8");
}

/** Reads a sprint's raw record out of `sprints.yaml`. */
async function readSprintRecord(
  root: string,
  id: string,
): Promise<Record<string, string>> {
  const text = await readFile(path.join(root, ".loctt", "config", "sprints.yaml"), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex(l => l.includes(`- id: ${id}`));
  if (start < 0) throw new Error(`sprint ${id} not in sprints.yaml:\n${text}`);
  const out: Record<string, string> = {};
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i > start && /^\s*- id:/.test(line)) break;
    const m = /^\s*-?\s*(\w+):\s*(.*)$/.exec(line);
    if (m?.[1] !== undefined) out[m[1]] = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

test.describe("SPR — sprint detail (M4.7)", () => {
  // @verifies SPR-7
  test("SPR-7: the detail header is populated from sprints.yaml and the URL reopens it", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Cadence", "--start", "2026-04-06", "--end", "2026-04-17",
      "--state", "active", "--goal", "Land the importer",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    // Navigating *from a column header* opens the detail route.
    await page.goto(`${tracker.baseURL}/sprints`);
    await page.getByTestId(`sprint-open-${id}`).click();
    await expect(page.getByTestId("sprint-detail")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/sprints/${id}`);

    // SPR-8: the header is read-by-default. The read view shows every
    // field from the config, not from a default.
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Cadence");
    await expect(page.getByTestId("sprint-meta-start_date-value")).toHaveText("2026-04-06");
    await expect(page.getByTestId("sprint-meta-end_date-value")).toHaveText("2026-04-17");
    await expect(page.getByTestId("sprint-meta-state-value")).toHaveText("Active");
    await expect(page.getByTestId("sprint-meta-goal-value")).toHaveText("Land the importer");

    // Opening Edit exposes the controls, populated from the config.
    await page.getByTestId("sprint-meta-edit").click();
    await expect(page.getByTestId("sprint-meta-name")).toHaveValue("Cadence");
    await expect(page.getByTestId("sprint-meta-start_date")).toHaveValue("2026-04-06");
    await expect(page.getByTestId("sprint-meta-end_date")).toHaveValue("2026-04-17");
    await expect(page.getByTestId("sprint-meta-state")).toHaveValue("active");
    await expect(page.getByTestId("sprint-meta-goal")).toHaveValue("Land the importer");

    // The state control offers EXACTLY the three schema states — no
    // invented fourth, no blank option.
    const stateOptions = page.getByTestId("sprint-meta-state").locator("option");
    await expect(stateOptions).toHaveCount(3);
    expect(await stateOptions.evaluateAll(os => os.map(o => (o as HTMLOptionElement).value)))
      .toEqual(["active", "completed", "future"]);

    // The URL is pasteable: a cold load of the same address reopens
    // the same sprint, rather than depending on the click that got here.
    const pasted = new URL(page.url()).toString();
    await page.goto("about:blank");
    await page.goto(pasted);
    await expect(page.getByTestId("sprint-detail")).toHaveAttribute("data-sprint-id", id);
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Cadence");
  });

  // @verifies SPR-7
  test("SPR-7: an absent goal is an empty placeholder affordance, never the string 'undefined'", async ({
    tracker,
    page,
  }) => {
    // Created with no --goal: the key is absent from sprints.yaml.
    await tracker.run([
      "sprint", "create", "Goalless", "--start", "2026-05-04", "--end", "2026-05-15", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const record = await readSprintRecord(tracker.root, id);
    expect(record["goal"]).toBeUndefined(); // the seeding really is absent

    await page.goto(`${tracker.baseURL}/sprints/${id}`);

    // SPR-8 read view: an absent goal reads as an explicit "no goal",
    // never the string "undefined" and never a collapsed/hidden row.
    const goalValue = page.getByTestId("sprint-meta-goal-value");
    await expect(goalValue).toBeVisible();
    await expect(goalValue).not.toContainText("undefined");
    await expect(goalValue).not.toContainText("null");
    await expect(goalValue).toContainText(/no goal/i);
    // And nothing anywhere in the read header says "undefined".
    await expect(page.getByTestId("sprint-meta")).not.toContainText("undefined");

    // Opening Edit gives an empty, editable field that invites a goal —
    // not a value of "undefined".
    await page.getByTestId("sprint-meta-edit").click();
    const goal = page.getByTestId("sprint-meta-goal");
    await expect(goal).toHaveValue("");
    await expect(goal).not.toHaveValue("undefined");
    await expect(goal).not.toHaveValue("null");
    await expect(goal).toBeVisible();
    await expect(goal).toBeEditable();
    await expect(goal).toHaveAttribute("placeholder", /goal/i);
  });

  // @verifies SPR-8
  test("SPR-8: editing name and goal persists to sprints.yaml and survives reload", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Before", "--start", "2026-06-01", "--end", "2026-06-12", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([{ title: "carried" }]);
    await assignById(tracker, [[String(seeded[0]), id]]);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    // SPR-8: editing is behind an explicit Edit control, then Save.
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-name").fill("After");
    await page.getByTestId("sprint-meta-save").click();

    // The far end: the file on disk, not the field on screen.
    await expect
      .poll(async () => (await readSprintRecord(tracker.root, id))["name"])
      .toBe("After");

    // The id is unchanged, so the task stays attached.
    const record = await readSprintRecord(tracker.root, id);
    expect(record["id"]).toBe(id);
    expect(await readTaskFile(tracker.root, String(seeded[0])))
      .toMatch(new RegExp(`^sprint: ${id}$`, "m"));

    // The CLI read agrees — the change is on disk, not just in React.
    expect(await tracker.run(["sprint", "list"])).toContain("After");

    // And a reload shows it (read view), plus the task still listed.
    await page.reload();
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("After");
    await expect(page.getByTestId(`sprint-task-${String(seeded[0])}`)).toBeVisible();
  });

  // @verifies SPR-8
  test("SPR-8: changing state to completed re-collapses that column on the overview", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Running", "--start", "2026-06-01", "--end", "2026-06-12", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    // SPR-8: state changes behind Edit, then Save.
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-state").selectOption("completed");
    await page.getByTestId("sprint-meta-save").click();

    await expect
      .poll(async () => (await readSprintRecord(tracker.root, id))["state"])
      .toBe("completed");

    // SPR-2's rules now apply to it on the overview: completed starts
    // collapsed, where active was expanded.
    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-toggle-${id}`)).toHaveAttribute("aria-expanded", "false");
  });

  // @verifies SPR-28
  test("SPR-28: a UI name save does not clobber a goal set from the CLI meanwhile", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Concurrent", "--start", "2026-07-01", "--end", "2026-07-10", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Concurrent");

    // The CLI changes `goal` underneath the open page.
    await tracker.run(["sprint", "edit", "Concurrent", "--goal", "Set from the CLI"]);

    // Now the UI opens Edit and saves `name`, having never seen that goal.
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-name").fill("Renamed in UI");
    await page.getByTestId("sprint-meta-save").click();

    await expect
      .poll(async () => (await readSprintRecord(tracker.root, id))["name"])
      .toBe("Renamed in UI");

    // The CLI's goal survived the save — not reverted to the empty
    // value the page was holding.
    const record = await readSprintRecord(tracker.root, id);
    expect(record["goal"]).toBe("Set from the CLI");

    // And the page (back in read view after Save) reflects both.
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Renamed in UI");
    await expect(page.getByTestId("sprint-meta-goal-value")).toHaveText("Set from the CLI");
  });

  // @verifies SPR-33
  test("SPR-33: an end_date before start_date is rejected inline, naming both values", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Window", "--start", "2026-08-03", "--end", "2026-08-14", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    // SPR-8: edit behind the Edit control. Save triggers the write that
    // the window rule rejects.
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-end_date").fill("2026-07-01");
    await page.getByTestId("sprint-meta-save").click();

    // The error is next to the end_date control, not only a toast.
    const problem = page.getByTestId("sprint-meta-end_date-problem");
    await expect(problem).toBeVisible();
    // It names the constraint and BOTH offending values.
    await expect(problem).toContainText("2026-07-01");
    await expect(problem).toContainText("2026-08-03");
    await expect(problem).toContainText(/before/i);

    // The previous valid value is what is still on disk (SPR-33): the
    // rejected write did not land.
    expect((await readSprintRecord(tracker.root, id))["end_date"]).toBe("2026-08-14");

    // The user can correct it from the error state without reloading —
    // the editor stays open with the draft, so they fix and re-Save.
    await page.getByTestId("sprint-meta-end_date").fill("2026-08-21");
    await page.getByTestId("sprint-meta-save").click();
    await expect
      .poll(async () => (await readSprintRecord(tracker.root, id))["end_date"])
      .toBe("2026-08-21");
    // Back in read view, showing the corrected value.
    await expect(page.getByTestId("sprint-meta-end_date-value")).toHaveText("2026-08-21");
    // SPR-33: the field-level problem CLEARS on the successful re-save —
    // it does not linger past the fix (A148 dropped this; restored).
    await expect(page.getByTestId("sprint-meta-end_date-problem")).toHaveCount(0);
  });

  // @verifies SPR-37
  test("SPR-37: a save that fails mid-flight states the field, the sprint and the data state", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Flaky", "--start", "2026-09-01", "--end", "2026-09-12", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Flaky");

    // The write fails in flight, after leaving the browser.
    await page.route(`**/api/sprints/${id}`, route => {
      if (route.request().method() === "PUT") {
        void route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            code: "internal", error: "the tracker could not be written",
            message: "the tracker could not be written",
            data_state: "not_saved", recovery: { kind: "retry" },
          }),
        });
        return;
      }
      void route.continue();
    });

    // SPR-8: edit behind Edit, then Save triggers the failing write.
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-name").fill("Attempted");
    await page.getByTestId("sprint-meta-save").click();

    // The failure is anchored (SET-51/SPR-37), and the editor stays open
    // so the change can be retried or abandoned — it is not shown as
    // saved. The message states the data outcome.
    const problem = page.getByTestId("sprint-meta-error");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(/not saved/i);
    await expect(page.getByTestId("sprint-meta")).toHaveAttribute("data-sprint-meta-mode", "edit");

    // Disk is unchanged — the previous value still stands.
    expect((await readSprintRecord(tracker.root, id))["name"]).toBe("Flaky");
    // Abandoning the edit returns the read view to the on-disk value,
    // never the attempted one shown as though saved.
    await page.getByTestId("sprint-meta-cancel").click();
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Flaky");
  });

  // @verifies SPR-37
  test("SPR-37: a rejected state transition names the STATE field, not End date", async ({
    tracker,
    page,
  }) => {
    // A real, field-attributable rejection (not a 500): a completed sprint
    // cannot go back to active without force. SPR-37 asks the failure to
    // say which field — and it must be the field it is actually about, not
    // End date. The server stamps every SprintError `field: "end_date"`,
    // so this exercises the client's message-based re-attribution (A147
    // follow-up): the error anchors under State, never under End date.
    await tracker.run([
      "sprint", "create", "Done", "--start", "2026-11-01", "--end", "2026-11-12", "--state", "completed",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-state").selectOption("active");
    await page.getByTestId("sprint-meta-save").click();

    // Anchored under State, naming the transition; NOT under End date.
    const stateProblem = page.getByTestId("sprint-meta-state-problem");
    await expect(stateProblem).toBeVisible();
    await expect(stateProblem).toContainText(/not allowed|transition/i);
    await expect(page.getByTestId("sprint-meta-end_date-problem")).toHaveCount(0);
    // Editor stays open; disk unchanged.
    await expect(page.getByTestId("sprint-meta")).toHaveAttribute("data-sprint-meta-mode", "edit");
    expect((await readSprintRecord(tracker.root, id))["state"]).toBe("completed");
  });

  // @verifies SPR-38
  test("SPR-38: an unknown key is a not-found state, distinguishable from an empty sprint", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Real", "--start", "2026-10-01", "--end", "2026-10-09", "--state", "active",
    ]);
    const realId = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/01ZZZZZZZZZZZZZZZZZZZZZZZZ`);
    const nf = page.getByTestId("sprint-not-found");
    await expect(nf).toBeVisible();
    await expect(page.getByTestId("sprint-not-found-key")).toContainText("01ZZZZZZZZZZZZZZZZZZZZZZZZ");
    // Offers a link back to the overview.
    await page.getByTestId("sprint-not-found-back").click();
    await expect(page.getByTestId("sprints")).toBeVisible();

    // Positive control: a real sprint with zero tasks is NOT this
    // state — it renders the full detail page with an empty list.
    await page.goto(`${tracker.baseURL}/sprints/${realId}`);
    await expect(page.getByTestId("sprint-not-found")).toHaveCount(0);
    await expect(page.getByTestId("sprint-detail")).toBeVisible();
    await expect(page.getByTestId("sprint-tasks-empty")).toBeVisible();
  });

  // @verifies SPR-26
  test("SPR-26: an archived sprint's detail route stays reachable and says it is archived", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Retired", "--start", "2025-02-03", "--end", "2025-02-14", "--state", "completed",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    await tracker.run(["sprint", "archive", "Retired"]);

    // Reachable by URL, even though the overview omits its column.
    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("sprint-detail")).toBeVisible();
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Retired");
    // Shown as archived rather than looking like an ordinary sprint.
    await expect(page.getByTestId("sprint-meta-archived")).toBeVisible();

    // Positive control for "not offered as a new target": the overview
    // has no column for it.
    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-column-${id}`)).toHaveCount(0);
  });

  // @verifies SPR-25
  test("SPR-25: a 200-char name and a long goal do not push the state control off-screen", async ({
    tracker,
    page,
  }) => {
    const longName = "N".repeat(200);
    const longGoal = Array.from({ length: 8 }, (_, i) => `Paragraph ${String(i)} of a very long goal.`).join(" ");
    await tracker.run([
      "sprint", "create", longName, "--start", "2026-11-02", "--end", "2026-11-13",
      "--state", "active", "--goal", longGoal,
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    // SPR-8: the editable controls live behind Edit — the layout under
    // test (name/goal boxes, state control) is the edit view's.
    await page.getByTestId("sprint-meta-edit").click();

    // The full text is present (not truncated in the data)...
    await expect(page.getByTestId("sprint-meta-name")).toHaveValue(longName);
    await expect(page.getByTestId("sprint-meta-goal")).toHaveValue(longGoal);

    // ...and the state control is still inside the viewport.
    const state = page.getByTestId("sprint-meta-state");
    await expect(state).toBeVisible();
    const box = await state.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0));

    // The goal is bounded rather than growing the header without limit.
    const goalBox = await page.getByTestId("sprint-meta-goal").boundingBox();
    expect(goalBox?.height ?? 0).toBeLessThanOrEqual(200);
    // The page itself does not scroll sideways.
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )).toBe(true);
  });
});

test.describe("SPR — burndown (M4.7)", () => {
  // @verifies SPR-9
  test("SPR-9: numeric estimation sums estimates, one sample per day, ideal distinct", async ({
    tracker,
    page,
  }) => {
    // A window ending today, so the days have elapsed and the tasks
    // (created today) are inside it.
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -4);
    await tracker.run([
      "sprint", "create", "Points", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    const seeded = await tracker.seed([
      { title: "three", fields: { estimate: "3" } },
      { title: "five", fields: { estimate: "5" } },
      { title: "unestimated" },
    ]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // The Y axis is labelled with the CONFIGURED unit ("pts" from the
    // default workflow), not a hardcoded "Story points" or "Tasks".
    const axis = page.getByTestId("burndown-axis-label");
    await expect(axis).toContainText("pts");
    await expect(axis).not.toContainText(/story points/i);
    await expect(axis).not.toContainText(/^Tasks/i);

    // One sample per calendar day, inclusive, weekends included.
    const days = daysBetween(start, today);
    expect(days.length).toBe(5);
    for (const d of days) {
      await expect(page.getByTestId(`burndown-point-${d}`)).toHaveCount(1);
    }

    // The plotted starting value equals `initialTotal`, which the
    // contract defines as the FIRST sample's remaining — not "the sum
    // of every estimate". These tasks were created today, so on the
    // window's first day they did not yet exist and the series
    // correctly starts at 0.
    const firstDay = String(days[0]);
    const initial = await page.getByTestId("burndown-initial-total").textContent();
    await expect(page.getByTestId(`burndown-point-${firstDay}`))
      .toHaveAttribute("data-remaining", (initial ?? "").trim());

    // The summed estimate appears on the day the tasks joined: today.
    // 3 + 5 + 0 — the unestimated task contributes 0 to the sum.
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "8");

    // The ideal line exists and is visually distinct from the actual —
    // a different stroke pattern, not colour alone.
    const ideal = page.getByTestId("burndown-ideal");
    await expect(ideal).toHaveAttribute("stroke-dasharray", /\d/);
    await expect(page.getByTestId("burndown-actual")).not.toHaveAttribute("stroke-dasharray", /\d/);

    // The unestimated task still counts as an incomplete task, even
    // contributing 0 to the sum: 3 tasks are in the sprint.
    await expect(page.getByTestId("sprint-task-count")).toHaveText("3");
  });

  // @verifies SPR-10
  test("SPR-10: with estimation disabled the axis counts tasks and no estimate input appears", async ({
    tracker,
    page,
  }) => {
    await setEstimation(tracker.root, "estimation:\n  enabled: false\n  unit: points\n\n");
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -2);
    await tracker.run([
      "sprint", "create", "Counting", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([
      { title: "a", fields: { estimate: "8" } },
      { title: "b" },
    ]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // The unit resolved to tasks and the axis says so.
    await expect(page.getByTestId("burndown-axis-label")).toHaveText(/tasks/i);
    // Each day's value is the count of incomplete tasks (2), NOT the
    // summed estimate (which would be 8).
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "2");

    // No estimate input anywhere on the page — hidden entirely, not
    // rendered empty.
    await expect(page.getByTestId("sprint-estimate-header")).toHaveCount(0);
    await expect(page.getByTestId(`sprint-estimate-${String(seeded[0])}`)).toHaveCount(0);
  });

  // @verifies SPR-11
  test("SPR-11: custom_enum without weights falls back to tasks, says so, and shows per-category counts", async ({
    tracker,
    page,
  }) => {
    await setEstimation(
      tracker.root,
      "estimation:\n  enabled: true\n  unit: custom_enum\n  unit_label: size\n  preset_values: [XS, S, M, L]\n\n",
    );
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -2);
    await tracker.run([
      "sprint", "create", "Sized", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([
      { title: "a", fields: { estimate: "XS" } },
      { title: "b", fields: { estimate: "M" } },
      { title: "c", fields: { estimate: "M" } },
    ]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // No NaN, no silently-empty plot: the line carries a real count.
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "3");
    await expect(page.getByTestId("burndown")).not.toContainText("NaN");

    // The axis says tasks, so the reader is not misled into reading
    // summed effort.
    await expect(page.getByTestId("burndown-axis-label")).toHaveText(/tasks/i);

    // And it is STATED near the chart, with a pointer to `weights`.
    const note = page.getByTestId("burndown-enum-fallback");
    await expect(note).toBeVisible();
    await expect(note).toContainText("weights");
    await expect(note).toContainText("workflow.yaml");
    await expect(note).toContainText(/custom_enum/);

    // Per-category counts are available on the detail page.
    await expect(page.getByTestId("burndown-enum-count-XS")).toContainText("1");
    await expect(page.getByTestId("burndown-enum-count-M")).toContainText("2");
    // A category with none is shown at 0, not silently missing.
    await expect(page.getByTestId("burndown-enum-count-L")).toContainText("0");
  });

  // @verifies SPR-12
  test("SPR-12: custom_enum WITH weights sums the weights and labels the axis with unit_label", async ({
    tracker,
    page,
  }) => {
    await setEstimation(
      tracker.root,
      "estimation:\n  enabled: true\n  unit: custom_enum\n  unit_label: size\n"
      + "  preset_values: [XS, S, M, L]\n  weights:\n    XS: 1\n    S: 2\n    M: 3\n    L: 5\n\n",
    );
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -2);
    await tracker.run([
      "sprint", "create", "Weighted", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([
      { title: "a", fields: { estimate: "M" } }, // 3
      { title: "b", fields: { estimate: "L" } }, // 5
    ]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // remaining sums weights[estimate]: 3 + 5 = 8, NOT a task count of 2.
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "8");

    // The axis uses the configured unit_label, never the raw
    // "weighted_enum".
    const axis = page.getByTestId("burndown-axis-label");
    await expect(axis).toContainText("size");
    await expect(axis).not.toContainText("weighted_enum");
    // And the no-weights fallback note is absent, since weights exist.
    await expect(page.getByTestId("burndown-enum-fallback")).toHaveCount(0);

    // Completing the L task drops the line by exactly its weight (5).
    await tracker.run(["set", String(seeded[1]), "status", "done"]);
    await page.reload();
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "3");
  });

  // @verifies SPR-16
  test("SPR-16: a sprint with zero tasks states 'nothing to burn down' rather than empty axes", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Empty", "--start", "2026-03-02", "--end", "2026-03-06", "--state", "future",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);

    const empty = page.getByTestId("burndown-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/nothing to burn down/i);
    await expect(page.getByTestId("burndown-initial-total")).toHaveText("0");
    // No NaN-scaled axis, and no division-by-zero artifact anywhere.
    await expect(page.getByTestId("burndown")).not.toContainText("NaN");
    await expect(page.getByTestId("burndown")).not.toContainText("Infinity");
  });

  // @verifies SPR-18
  test("SPR-18: a ~90-day window thins its tick labels but keeps one point per day", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -89);
    await tracker.run([
      "sprint", "create", "Long", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([{ title: "one", fields: { estimate: "2" } }]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // The series still has one data point per day — 90 of them.
    const points = page.locator('[data-testid^="burndown-point-"]');
    await expect(points).toHaveCount(90);

    // But the labels are thinned rather than overprinted into a smear.
    const ticks = page.locator('[data-testid^="burndown-tick-"]');
    const tickCount = await ticks.count();
    expect(tickCount).toBeGreaterThan(1);
    expect(tickCount).toBeLessThanOrEqual(12);

    // Positive control that thinning is real, not an empty selector.
    await expect(page.getByTestId(`burndown-tick-${today}`)).toHaveCount(1);
  });

  // @verifies SPR-21
  test("SPR-21: a wholly-future sprint draws the ideal line and marks days that have not happened", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, 10);
    const end = addDays(today, 14);
    await tracker.run([
      "sprint", "create", "Ahead", "--start", start, "--end", end, "--state", "future",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([
      { title: "a", fields: { estimate: "4" } },
      { title: "b", fields: { estimate: "2" } },
    ]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // The ideal line is drawn across the whole window.
    await expect(page.getByTestId("burndown-ideal")).toBeVisible();
    // The actual series is flat at initialTotal for days not yet happened.
    await expect(page.getByTestId("burndown-initial-total")).toHaveText("6");
    for (const d of daysBetween(start, end)) {
      await expect(page.getByTestId(`burndown-point-${d}`))
        .toHaveAttribute("data-remaining", "6");
    }

    // Future days are visually distinguished, so the flat line is not
    // misread as "no progress".
    await expect(page.getByTestId("burndown-future-region")).toBeVisible();
  });

  // @verifies SPR-22
  test("SPR-22: a single-day sprint renders one visible point without NaN", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    await tracker.run([
      "sprint", "create", "OneDay", "--start", today, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([{ title: "a", fields: { estimate: "3" } }]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // Exactly one sample.
    await expect(page.locator('[data-testid^="burndown-point-"]')).toHaveCount(1);
    const point = page.getByTestId(`burndown-point-${today}`);
    await expect(point).toHaveAttribute("data-remaining", "3");

    // Rendered visibly, not as a zero-width plot pinned to the edge.
    const cx = await point.getAttribute("cx");
    const r = await point.getAttribute("r");
    expect(Number(cx)).toBeGreaterThan(0);
    expect(Number.isNaN(Number(cx))).toBe(false);
    expect(Number(r)).toBeGreaterThan(0);

    // The ideal degenerates without NaN or an infinite slope.
    const idealPoints = await page.getByTestId("burndown-ideal").getAttribute("points");
    expect(idealPoints ?? "").not.toContain("NaN");
    expect(idealPoints ?? "").not.toContain("Infinity");
  });

  // @verifies SPR-23
  test("SPR-23: a task joining mid-sprint steps the total UP on its join day", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -3);
    await tracker.run([
      "sprint", "create", "Scope", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    // One task in from the beginning...
    const seeded = await tracker.seed([
      { title: "original", fields: { estimate: "4" } },
      { title: "added later", fields: { estimate: "6" } },
    ]);
    await assignById(tracker, [[String(seeded[0]), id]]);
    // ...and a second joining "later". Both histories are written
    // today, so today is the join day for the second.
    await assignById(tracker, [[String(seeded[1]), id]]);

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-chart")).toBeVisible();

    // The step is visible on the join day: the total rises to 10.
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "10");

    // Earlier days are NOT retroactively rewritten to hide the change:
    // before the tasks existed the remaining was 0.
    await expect(page.getByTestId(`burndown-point-${String(start)}`))
      .toHaveAttribute("data-remaining", "0");

    // Removing a task steps the total back DOWN on its departure day.
    await tracker.run(["unset", String(seeded[1]), "sprint"]);
    await page.reload();
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "4");
  });

  // @verifies SPR-30
  test("SPR-30: completing then reopening shows both transitions, keyed on status category", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -2);
    await tracker.run([
      "sprint", "create", "Reopened", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([{ title: "flips", fields: { estimate: "7" } }]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "7");

    // Completed → burns down.
    await tracker.run(["set", String(seeded[0]), "status", "done"]);
    await page.reload();
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "0");

    // Reopened → rises again.
    await tracker.run(["set", String(seeded[0]), "status", "in_progress"]);
    await page.reload();
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "7");
  });

  // @verifies SPR-29
  test("SPR-29: changing estimation.unit re-renders against the new unit on refresh", async ({
    tracker,
    page,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, -2);
    await tracker.run([
      "sprint", "create", "Units", "--start", start, "--end", today, "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);
    const seeded = await tracker.seed([{ title: "a", fields: { estimate: "3" } }]);
    await assignById(tracker, seeded.map(k => [k, id] as const));

    await page.goto(`${tracker.baseURL}/sprints/${id}`);
    await expect(page.getByTestId("burndown-axis-label")).toContainText("pts");

    // Switch points → hours, with no server restart.
    await setEstimation(
      tracker.root,
      "estimation:\n  enabled: true\n  unit: hours\n  unit_label: hrs\n  scale: free\n\n",
    );
    await page.reload();

    await expect(page.getByTestId("burndown-axis-label")).toContainText("hrs");
    // No stale "points"/"pts" label survives anywhere on the chart.
    await expect(page.getByTestId("burndown")).not.toContainText("pts");
    await expect(page.getByTestId("burndown")).not.toContainText(/points/i);
    // The summed value is still read from the same estimates.
    await expect(page.getByTestId(`burndown-point-${today}`))
      .toHaveAttribute("data-remaining", "3");
  });

  // @verifies SPR-34
  test("SPR-34: a burndown that fails to compute says so; the rest of the page stays editable", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Broken", "--start", "2026-02-02", "--end", "2026-02-06", "--state", "active",
    ]);
    const id = String((await readSprints(tracker.root))[0]?.id);

    // Force the burndown read to fail, leaving every other route alone.
    await page.route(`**/api/sprints/${id}/burndown`, route =>
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal", error: "history could not be read",
          message: "history could not be read", recovery: { kind: "retry" },
        }),
      }),
    );

    await page.goto(`${tracker.baseURL}/sprints/${id}`);

    // An error naming the sprint, in the chart's region.
    const err = page.getByTestId("burndown-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("Broken");
    // Never empty axes standing in for a failure — that reads as
    // "no work", which is a different fact.
    await expect(page.getByTestId("burndown-chart")).toHaveCount(0);
    await expect(page.getByTestId("burndown-empty")).toHaveCount(0);

    // The rest of the detail still renders AND stays editable (SPR-8:
    // edit behind the Edit control, then Save).
    await expect(page.getByTestId("sprint-meta")).toBeVisible();
    await page.getByTestId("sprint-meta-edit").click();
    await page.getByTestId("sprint-meta-name").fill("Still editable");
    await page.getByTestId("sprint-meta-save").click();
    await expect
      .poll(async () => (await readSprintRecord(tracker.root, id))["name"])
      .toBe("Still editable");
  });

  // @verifies SPR-35
  test("SPR-35: a weights key absent from preset_values is reported where the chart would be", async ({
    tracker,
    page,
  }) => {
    // `XXL` is not in preset_values — the schema rejects this outright.
    await setEstimation(
      tracker.root,
      "estimation:\n  enabled: true\n  unit: custom_enum\n  unit_label: size\n"
      + "  preset_values: [XS, S, M]\n  weights:\n    XS: 1\n    XXL: 9\n\n",
    );
    await tracker.run([
      "sprint", "create", "BadWeights", "--start", "2026-02-02", "--end", "2026-02-06", "--state", "active",
    ]).catch(() => undefined);

    await page.goto(`${tracker.baseURL}/sprints`);

    // The config error is surfaced, naming the offending key and that
    // it is not in preset_values.
    const region = page.getByTestId("board-config-error");
    await expect(region).toBeVisible();
    await expect(region).toContainText("XXL");
    await expect(region).toContainText(/preset_values/);
    // It is never silently ignored: no partially-weighted line is drawn.
    await expect(page.getByTestId("burndown-actual")).toHaveCount(0);
  });
});

/** Adds `n` days to a YYYY-MM-DD string, in UTC. */
function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `start` to `end` inclusive. */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

test.describe("SPR — sprint-scoped task list (M4.7)", () => {
  // @verifies SPR-13
  test("SPR-13: the shared filter bar narrows within the sprint and never drops the scope", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Scoped", "--start", "2026-04-06", "--end", "2026-04-17", "--state", "active",
    ]);
    await tracker.run([
      "sprint", "create", "Other", "--start", "2026-05-04", "--end", "2026-05-15", "--state", "future",
    ]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const scoped = String(byName.get("Scoped"));
    const other = String(byName.get("Other"));

    const seeded = await tracker.seed([
      { title: "in scope open" },
      { title: "in scope done", fields: { status: "done" } },
      { title: "elsewhere" },
    ]);
    await assignById(tracker, [
      [String(seeded[0]), scoped],
      [String(seeded[1]), scoped],
      [String(seeded[2]), other],
    ]);

    await page.goto(`${tracker.baseURL}/sprints/${scoped}`);

    // Initially exactly this sprint's tasks — the same set as the
    // overview column, and the same count.
    await expect(page.getByTestId("sprint-task-count")).toHaveText("2");
    await expect(page.getByTestId("sprint-task-list").locator("[data-task-key]")).toHaveCount(2);
    await expect(page.getByTestId(`sprint-task-${String(seeded[2])}`)).toHaveCount(0);

    // The bar is the shared one: it offers the list's facets.
    await expect(page.getByRole("button", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Priority" })).toBeVisible();
    // ...minus `sprint`, which this route *is*.
    await expect(page.getByRole("button", { name: "Sprint", exact: true })).toHaveCount(0);

    // Applying a status filter narrows WITHIN the sprint.
    await page.goto(`${tracker.baseURL}/sprints/${scoped}?status=done`);
    await expect(page.getByTestId("sprint-task-list").locator("[data-task-key]")).toHaveCount(1);
    await expect(page.getByTestId(`sprint-task-${String(seeded[1])}`)).toBeVisible();
    // The scope is not dropped: the other sprint's task stays out even
    // though it would match a bare `status` filter.
    await expect(page.getByTestId(`sprint-task-${String(seeded[2])}`)).toHaveCount(0);

    // Filter state serializes into the URL and the pasted URL
    // reproduces the filtered, sprint-scoped list.
    const pasted = page.url();
    expect(pasted).toContain("status=done");
    await page.goto("about:blank");
    await page.goto(pasted);
    await expect(page.getByTestId("sprint-detail")).toHaveAttribute("data-sprint-id", scoped);
    await expect(page.getByTestId("sprint-task-list").locator("[data-task-key]")).toHaveCount(1);
    await expect(page.getByTestId(`sprint-task-${String(seeded[1])}`)).toBeVisible();
  });

  // @verifies SPR-13
  test("SPR-13: a hand-edited sprint param cannot retarget the page away from its route", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "Here", "--start", "2026-04-06", "--end", "2026-04-17", "--state", "active",
    ]);
    await tracker.run([
      "sprint", "create", "There", "--start", "2026-05-04", "--end", "2026-05-15", "--state", "future",
    ]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const here = String(byName.get("Here"));
    const there = String(byName.get("There"));

    const seeded = await tracker.seed([{ title: "mine" }, { title: "theirs" }]);
    await assignById(tracker, [
      [String(seeded[0]), here],
      [String(seeded[1]), there],
    ]);

    // The URL asks for the OTHER sprint's tasks while the route says
    // "Here". The route param wins — the header and the list must not
    // describe two different sprints.
    await page.goto(`${tracker.baseURL}/sprints/${here}?sprint=${there}`);
    await expect(page.getByTestId("sprint-meta-name-value")).toHaveText("Here");
    await expect(page.getByTestId(`sprint-task-${String(seeded[0])}`)).toBeVisible();
    await expect(page.getByTestId(`sprint-task-${String(seeded[1])}`)).toHaveCount(0);
  });

  // @verifies SPR-14
  test("SPR-14: reassigning a task away drops it from the list and decrements the count", async ({
    tracker,
    page,
  }) => {
    await tracker.run([
      "sprint", "create", "From", "--start", "2026-04-06", "--end", "2026-04-17", "--state", "active",
    ]);
    await tracker.run([
      "sprint", "create", "To", "--start", "2026-05-04", "--end", "2026-05-15", "--state", "future",
    ]);
    const byName = new Map((await readSprints(tracker.root)).map(s => [s.name, s.id]));
    const from = String(byName.get("From"));
    const to = String(byName.get("To"));

    const seeded = await tracker.seed([{ title: "moving" }, { title: "staying" }]);
    await assignById(tracker, [
      [String(seeded[0]), from],
      [String(seeded[1]), from],
    ]);

    await page.goto(`${tracker.baseURL}/sprints/${from}`);
    await expect(page.getByTestId("sprint-task-count")).toHaveText("2");

    // Reassign it to the other sprint, the way the task meta panel does.
    await assignById(tracker, [[String(seeded[0]), to]]);
    await page.reload();

    // Dropped from this page's list; the count decrements.
    await expect(page.getByTestId(`sprint-task-${String(seeded[0])}`)).toHaveCount(0);
    await expect(page.getByTestId("sprint-task-count")).toHaveText("1");
    await expect(page.getByTestId(`sprint-task-${String(seeded[1])}`)).toBeVisible();

    // The overview shows the card in its new column.
    await page.goto(`${tracker.baseURL}/sprints`);
    await expect(page.getByTestId(`sprint-count-${from}`)).toHaveText("1");
    await expect(page.getByTestId(`sprint-count-${to}`)).toHaveText("1");
  });
});

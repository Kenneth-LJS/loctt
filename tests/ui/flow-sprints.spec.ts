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

    const err = page.getByTestId("sprints-config-error");
    await expect(err).toBeVisible();
    // Names the file, the offending sprint, and the specific rule.
    await expect(err).toContainText("sprints.yaml");
    await expect(err).toContainText("sprints[0]");
    await expect(err).toContainText("must not be before start_date");
    // Tells the user to fix the file and reload; offers no repair.
    await expect(err).toContainText("reload");
    await expect(err).toContainText("will not repair");

    // A48: the parse is all-or-nothing, so this must say the FILE
    // failed — never the empty state, which would read as "no sprints".
    await expect(page.getByTestId("sprints-empty")).toHaveCount(0);
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
});

/**
 * Transcribed from docs/dev/ui-test-cases/flow-settings.md — the M4.2
 * workflow-panel cases — and flow-cross-surface.md XS-31.
 *
 * Several of these assert the file on disk after the write, so a
 * client that posted the wrong value cannot pass on a 200 alone. Where
 * the server could plausibly repair a client mistake (it re-validates
 * and re-serialises the whole document), the request itself is
 * asserted too — in `apps/web/src/client/settings/workflowEdits.test.ts`,
 * which owns the rules that decide what gets sent.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

function workflowPath(root: string): string {
  return path.join(root, ".loctt", "config", "workflow.yaml");
}

/**
 * Replaces the `custom_fields: []` the starter workflow ships with.
 *
 * Appending a second `custom_fields:` key would make the document
 * invalid YAML-wise ambiguous and the panel would render the wrong
 * one — the fixture has to edit the key that is already there.
 */
function withCustomFields(yaml: string, lines: readonly string[]): string {
  return yaml.replace(/^custom_fields: \[\]$/m, ["custom_fields:", ...lines].join("\n"));
}

/**
 * The rendered row keys of a reorderable panel, in order.
 *
 * Waits for the list to have rows first: `evaluateAll` on an empty
 * locator returns `[]` rather than retrying, so reading it before the
 * query resolved yields `undefined` keys and every later step waits on
 * `…-handle-undefined`.
 */
async function rowKeys(
  page: import("@playwright/test").Page,
  prefix: string,
): Promise<string[]> {
  const rows = page.getByTestId(`${prefix}-list`).locator("[data-position]");
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((els, p: string) =>
    els.map(e => (e.getAttribute("data-testid") ?? "").replace(`${p}-row-`, "")), prefix);
}

/**
 * The `key`s of one top-level workflow collection, in file order.
 *
 * Extracted by walking indentation rather than by a regex bounded on
 * the *next* section name: `saveWorkflowConfig` re-serialises the
 * document, and the blank lines the starter file ships with do not
 * survive, so a `\n\ntask_types:` bound matched before the first write
 * and silently matched nothing after it.
 */
function collectionKeys(yaml: string, collection: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex(l => l === `${collection}:`);
  if (start === -1) return [];
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) continue;
    // Back to column zero means the next top-level key.
    if (!/^\s/.test(line)) break;
    const m = /^ {2}- key: (\S+)/.exec(line);
    if (m?.[1] !== undefined) keys.push(m[1]);
  }
  return keys;
}

function calendarPath(root: string): string {
  return path.join(root, ".loctt", "config", "calendar.yaml");
}

async function workflowYaml(root: string): Promise<string> {
  return readFile(workflowPath(root), "utf8");
}

test.describe("SET — the statuses panel", () => {
  // @verifies SET-3
  test("SET-3: statuses render in file order with key, category, the default marker and the file path", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);

    const yaml = await workflowYaml(tracker.root);
    // Every status in the file, in the file's order — scoped to the
    // `statuses:` block, since `- key:` also matches priorities,
    // task types and relationships.
    const statusKeys = collectionKeys(yaml, "statuses");
    expect(statusKeys.length).toBeGreaterThan(2);

    for (const [i, key] of statusKeys.entries()) {
      const row = page.getByTestId(`statuses-row-${key}`);
      await expect(row).toBeVisible();
      // File order, not alphabetical and not whatever React rendered.
      await expect(row).toHaveAttribute("data-position", String(i + 1));
      // The key itself, shown.
      await expect(page.getByTestId(`statuses-key-${key}`)).toHaveText(key);
      // And the category, from the four the schema allows.
      await expect(page.getByTestId(`statuses-category-${key}`))
        .toHaveValue(/^(pending|active|completed|discarded)$/);
    }

    // Exactly one default, and the marker says what it decides.
    const marked = page.locator('[data-default-status="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText("new tasks land here");

    // SET-3: the absolute path of the file the panel reflects.
    await expect(page.getByTestId("workflow-config-path"))
      .toContainText(workflowPath(tracker.root));
  });

  // @verifies SET-3
  test("SET-3: the panel is a lens — a hand edit shows on refresh", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);
    const before = await workflowYaml(tracker.root);
    const firstKey = /^ {2}- key: (\S+)/m.exec(before)?.[1] as string;
    await expect(page.getByTestId(`statuses-label-${firstKey}`)).toBeVisible();

    // Rename that status's label in the file, the way a user with a
    // terminal would.
    const oldLabelLine = new RegExp(`(- key: ${firstKey}\\n\\s+label: )(.+)`);
    await writeFile(
      workflowPath(tracker.root),
      before.replace(oldLabelLine, "$1Renamed by hand"),
      "utf8",
    );

    await page.reload();
    await expect(page.getByTestId(`statuses-label-${firstKey}`))
      .toHaveValue("Renamed by hand");
  });
});

test.describe("SET — reorder", () => {
  // @verifies SET-6
  test("SET-6: a keyboard reorder writes the new status order to workflow.yaml and survives a cold reload", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);
    const list = page.getByTestId("statuses-list");
    await expect(list).toBeVisible();

    const keysBefore = await rowKeys(page, "statuses");
    expect(keysBefore.length).toBeGreaterThan(2);
    const second = keysBefore[1] as string;

    // Move the second status up one, through the handle's keyboard
    // affordance — the same code path the drag drop calls.
    await page.getByTestId(`statuses-handle-${second}`).focus();
    await page.keyboard.press("ArrowUp");

    await expect(page.getByTestId(`statuses-row-${second}`))
      .toHaveAttribute("data-position", "1");

    // The far end: the file, in the new order. A client that kept the
    // change in React state passes every on-screen assertion and
    // fails this one.
    await expect.poll(async () => {
      const yaml = await workflowYaml(tracker.root);
      const keys = [...yaml.matchAll(/^ {2}- key: (\S+)/gm)].map(m => m[1] as string);
      return keys.indexOf(second) < keys.indexOf(keysBefore[0] as string);
    }).toBe(true);

    // SET-6: a **cold reload**, not just the next render. Client state
    // that outlives a refetch but not a refresh is the failure mode.
    await page.reload();
    await expect(page.getByTestId(`statuses-row-${second}`))
      .toHaveAttribute("data-position", "1");
  });

  // @verifies SET-6
  test("SET-6: a drag over another row shows a live drop indicator", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);
    const keys = await rowKeys(page, "statuses");
    const [first, second] = keys as [string, string];

    // Nothing is indicated before the drag starts.
    await expect(page.locator("[data-drop-indicator]")).toHaveCount(0);

    // HTML5 drag events, dispatched directly: Playwright's dragTo does
    // not drive the native dragover/drop pair reliably headless.
    await page.getByTestId(`statuses-row-${first}`).dispatchEvent("dragstart");
    await page.getByTestId(`statuses-row-${second}`).dispatchEvent("dragover");

    // The indicator is a data attribute, not only a Tailwind ring — a
    // class-only distinction is not something a test can tell from any
    // other ring, which is how three M3 cases went unassertable.
    await expect(page.getByTestId(`statuses-row-${second}`))
      .toHaveAttribute("data-drop-indicator", "below");
    await expect(page.getByTestId(`statuses-row-${first}`))
      .toHaveAttribute("data-dragging", "true");
  });

  // @verifies SET-21
  test("SET-21: moving a priority to the front recomputes its value and rewrites no task", async ({
    page,
    tracker,
  }) => {
    const [taskKey] = await tracker.seed([{ title: "keeps its priority" }]);
    await page.goto(`${tracker.baseURL}/settings/priorities`);

    const keys = await rowKeys(page, "priorities");
    expect(keys.length).toBeGreaterThan(1);
    const last = keys[keys.length - 1] as string;

    const { readdir } = await import("node:fs/promises");
    const taskDir = path.join(tracker.root, ".loctt", "tasks");
    const taskFilePath = path.join(
      taskDir, (await readdir(taskDir))[0] as string, "task.md",
    );
    const taskBefore = await readFile(taskFilePath, "utf8");

    // Walk the lowest priority to the top, one keyboard move at a
    // time. Each move is its own PUT, so the next press has to wait
    // for the row to actually land before it fires again.
    for (let target = keys.length - 1; target > 0; target -= 1) {
      await page.getByTestId(`priorities-handle-${last}`).focus();
      await page.keyboard.press("ArrowUp");
      await expect(page.getByTestId(`priorities-row-${last}`))
        .toHaveAttribute("data-position", String(target));
      // Each move is its own read-modify-write round trip. Pressing
      // again before it settles sends a second edit built from a
      // document the first one has already superseded, and the two
      // reorders collapse into one — so wait for the write to land in
      // the file, not merely for the row to move on screen.
      await expect.poll(async () => {
        const yaml = await workflowYaml(tracker.root);
        return collectionKeys(yaml, "priorities").indexOf(last) + 1;
      }).toBe(target);
    }
    await expect(page.getByTestId(`priorities-row-${last}`))
      .toHaveAttribute("data-position", "1");

    // Its value is now the lowest, so a priority sort puts it first —
    // the whole point of SET-21. A reorder that only moved array
    // positions leaves the old value in the file and the sort unmoved.
    await expect.poll(async () => {
      const yaml = await workflowYaml(tracker.root);
      const entries = [...yaml.matchAll(/- key: (\S+)\n\s+label: .*\n\s+value: (\d+)/g)]
        .map(m => ({ key: m[1] as string, value: Number(m[2]) }))
        .filter(e => collectionKeys(yaml, "priorities").includes(e.key));
      if (entries.length < 2) return "no entries parsed";
      const mine = entries.find(e => e.key === last);
      if (mine === undefined) return "missing";
      return entries.every(e => e.key === last || e.value > mine.value);
    }).toBe(true);

    // SET-21: "Existing tasks are untouched — only workflow.yaml
    // changed; no task frontmatter was rewritten." Byte-for-byte, so
    // even an updated_at touch would fail this.
    expect(await readFile(taskFilePath, "utf8")).toBe(taskBefore);
    expect(taskBefore).toContain(taskKey as string);
  });
});

test.describe("SET — delete with remap", () => {
  // @verifies SET-17
  test("SET-17: deleting a status in use shows the count and demands a choice", async ({
    page,
    tracker,
  }) => {
    // Nine tasks in one status, as the case describes.
    const wf = JSON.parse(
      await (await fetch(`${tracker.baseURL}/api/workflow`)).text(),
    ) as { statuses: { key: string; default?: boolean }[] };
    const doomed = wf.statuses.find(s => s.default !== true)?.key as string;
    const keep = wf.statuses.find(s => s.default === true)?.key as string;
    for (let i = 0; i < 9; i += 1) {
      await tracker.run(["create", `Task ${String(i)}`, "--status", doomed]);
    }

    await page.goto(`${tracker.baseURL}/settings/statuses`);

    // SET-17: the reference count is on the row, before the confirm.
    await expect(page.getByTestId(`statuses-refcount-${doomed}`)).toHaveText("9 tasks");

    await page.getByTestId(`statuses-delete-${doomed}`).click();
    // And repeated in the confirm.
    await expect(page.getByTestId("remap-refcount")).toContainText("9 tasks");

    // No default is preselected — the confirm requires a choice.
    await expect(page.getByTestId("remap-confirm")).toBeDisabled();
    await expect(page.getByTestId("remap-clear")).not.toBeChecked();
    await expect(page.getByTestId(`remap-to-${keep}`)).not.toBeChecked();

    // BUG-2 (SET-17): the "clear" option states the real consequence —
    // the field is cleared/emptied on those tasks, not left dangling with
    // a drift marker or a Diagnostics warning.
    await expect(page.getByTestId("remap-clear-warning"))
      .toContainText(/emptied|cleared|no status/i);
    await expect(page.getByTestId("remap-clear-warning"))
      .not.toContainText(/drift marker/i);
    await expect(page.getByTestId("remap-clear-warning"))
      .not.toContainText(/Diagnostics/i);

    // Choosing remap moves all nine and reports the count.
    await page.getByTestId(`remap-to-${keep}`).check();
    await expect(page.getByTestId("remap-confirm")).toBeEnabled();
    await page.getByTestId("remap-confirm").click();

    await expect(page.getByTestId(`statuses-row-${doomed}`)).toHaveCount(0);
    await expect.poll(async () => (await workflowYaml(tracker.root)).includes(`key: ${doomed}`))
      .toBe(false);

    // The far end, through a second surface: the CLI agrees the nine
    // moved. `--query` because `list` has no `--status` flag.
    const listed = await tracker.run(["list", "--query", `status = ${keep}`]);
    expect(listed.split("\n").filter(l => /T-\d+/.test(l))).toHaveLength(9 + 0);
  });

  // @verifies SET-19
  test("SET-19: an enum value's own reference count gates its delete", async ({
    page,
    tracker,
  }) => {
    // A custom enum field with two values, one of them held by tasks.
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      withCustomFields(yaml, [
        "  - key: sprint_field",
        "    label: Sprint",
        "    type: enum",
        "    multi: false",
        "    searchable: false",
        "    values:",
        "      - key: sprint_1",
        "        label: Sprint 1",
        "      - key: sprint_2",
        "        label: Sprint 2",
      ]),
      "utf8",
    );

    const [a, b] = await tracker.seed([{ title: "one" }, { title: "two" }]);
    for (const k of [a, b]) {
      await tracker.run(["set", k as string, "sprint_field", "sprint_1"]);
    }

    await page.goto(`${tracker.baseURL}/settings/custom-fields`);
    // SET-19: the value row shows its own count.
    await expect(page.getByTestId("custom-field-value-refcount-sprint_field-sprint_1"))
      .toHaveText("2");
    await expect(page.getByTestId("custom-field-value-refcount-sprint_field-sprint_2"))
      .toHaveText("0");

    await page.getByTestId("custom-field-value-delete-sprint_field-sprint_1").click();
    // The count is repeated in the confirm, the same way statuses do.
    await expect(page.getByTestId("remap-refcount")).toContainText("2 tasks");
    await expect(page.getByTestId("remap-confirm")).toBeDisabled();

    // BUG-2 (SET-19): the clear branch states the value is emptied from
    // those tasks' frontmatter — not left as a raw key with a drift
    // marker or surfaced by Diagnostics.
    await expect(page.getByTestId("remap-clear-warning"))
      .toContainText(/emptied|cleared|no value/i);
    await expect(page.getByTestId("remap-clear-warning"))
      .not.toContainText(/drift marker/i);
    await expect(page.getByTestId("remap-clear-warning"))
      .not.toContainText(/Diagnostics/i);

    await page.getByTestId("remap-to-sprint_2").check();
    await page.getByTestId("remap-confirm").click();

    await expect.poll(async () => (await workflowYaml(tracker.root)).includes("sprint_1"))
      .toBe(false);
    // The far end for the task side: its frontmatter now holds the
    // remap target, not the deleted value.
    const { readdir } = await import("node:fs/promises");
    const taskDir = path.join(tracker.root, ".loctt", "tasks");
    const contents = await Promise.all(
      (await readdir(taskDir)).map(d =>
        readFile(path.join(taskDir, d, "task.md"), "utf8")),
    );
    const forA = contents.find(c => c.includes(`key: ${a as string}`)) ?? "";
    expect(forA).toContain("sprint_2");
    expect(forA).not.toContain("sprint_1");
  });
});

test.describe("SET — relationships", () => {
  // @verifies SET-4
  test("SET-4: relationships show graph and ranked as labelled controls, with the user's own keys", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/relationships`);
    const list = page.getByTestId("relationships-list");
    await expect(list).toBeVisible();

    const yaml = await workflowYaml(tracker.root);
    // Nothing hardcodes `blocks` — the panel renders whatever the file
    // declares, so the row count tracks the file.
    const declared = [...yaml.matchAll(/relationships:\n((?:\s+.*\n)+)/g)]
      .flatMap(m => [...(m[1] ?? "").matchAll(/^ {2}- key: (\S+)/gm)].map(x => x[1] as string));
    expect(declared.length).toBeGreaterThan(0);
    await expect(list).toHaveAttribute("data-row-count", String(declared.length));

    for (const key of declared) {
      await expect(page.getByTestId(`relationship-${key}`)).toBeVisible();
      // `graph` is a named control over the three the schema allows —
      // not an unlabelled icon, and not the removed `structural`.
      await expect(page.getByTestId(`relationship-graph-${key}`))
        .toHaveValue(/^(none|acyclic|tree)$/);
      await expect(page.getByTestId(`relationship-ranked-${key}`)).toBeVisible();
    }
  });

  // @verifies SET-5
  test("SET-5: a symmetric relationship folds to one row, and the checkbox drives `kind`", async ({
    page,
    tracker,
  }) => {
    const yaml = await workflowYaml(tracker.root);
    // A directional relationship we can fold, declared by hand.
    await writeFile(
      workflowPath(tracker.root),
      yaml.replace(
        /^relationships:$/m,
        [
          "relationships:",
          "  - key: supersedes",
          "    label: Supersedes",
          "    kind: directional",
          "    inverse: superseded_by",
          "    inverse_label: Superseded by",
        ].join("\n"),
      ),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/relationships`);

    // A custom key with the user's own labels — nothing hardcodes
    // blocks / depends_on.
    const row = page.getByTestId("relationship-supersedes");
    await expect(row).toContainText("Supersedes");
    await expect(row).toHaveAttribute("data-relationship-kind", "directional");
    await expect(page.getByTestId("relationship-inverse-supersedes"))
      .toHaveValue("superseded_by");

    // Tick symmetric: the inverse fields go in the same interaction,
    // replaced by an explicit "same as forward" rather than blanks.
    await page.getByTestId("relationship-symmetric-supersedes").check();
    await expect(row).toHaveAttribute("data-relationship-kind", "symmetric");
    await expect(page.getByTestId("relationship-inverse-supersedes")).toHaveCount(0);
    await expect(page.getByTestId("relationship-inverse-note-supersedes"))
      .toContainText("same as forward");

    // The file carries `kind: symmetric` and NO `symmetric:` boolean —
    // the schema has no such field and would reject it under .strict().
    await expect.poll(async () => {
      const after = await workflowYaml(tracker.root);
      const block = /- key: supersedes\n((?:\s{4}.*\n)+)/.exec(after)?.[1] ?? "";
      return {
        kind: /kind: symmetric/.test(block),
        boolean: /^\s+symmetric:/m.test(block),
        inverse: /inverse:/.test(block),
      };
    }).toEqual({ kind: true, boolean: false, inverse: false });

    // Unticking restores the previous inverse values, not blanks.
    await page.getByTestId("relationship-symmetric-supersedes").uncheck();
    await expect(page.getByTestId("relationship-inverse-supersedes"))
      .toHaveValue("superseded_by");
    await expect(page.getByTestId("relationship-inverse-label-supersedes"))
      .toHaveValue("Superseded by");
  });
});

test.describe("SET — custom fields", () => {
  // @verifies SET-7
  test("SET-7: each declared type renders with its label, key, multi and searchable", async ({
    page,
    tracker,
  }) => {
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      withCustomFields(yaml, [
        "  - key: notes",
        "    label: Notes",
        "    type: string",
        "    multi: false",
        "    searchable: true",
        "  - key: story_points",
        "    label: Story points",
        "    type: number",
        "    multi: false",
        "    searchable: false",
        "  - key: reviewed_on",
        "    label: Reviewed on",
        "    type: date",
        "    multi: false",
        "    searchable: false",
        "  - key: urgent",
        "    label: Urgent",
        "    type: boolean",
        "    multi: false",
        "    searchable: false",
        "  - key: size",
        "    label: Size",
        "    type: enum",
        "    multi: false",
        "    searchable: false",
        "    values:",
        "      - key: xs",
        "        label: XS",
        "      - key: s",
        "        label: S",
      ]),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/custom-fields`);

    for (const [key, type] of [
      ["notes", "string"], ["story_points", "number"], ["reviewed_on", "date"],
      ["urgent", "boolean"], ["size", "enum"],
    ] as const) {
      const row = page.getByTestId(`custom-field-${key}`);
      await expect(row).toBeVisible();
      // The declared type, exposed rather than only styled.
      await expect(row).toHaveAttribute("data-field-type", type);
      await expect(row).toHaveAttribute("data-field-multi", "false");
      await expect(page.getByTestId(`custom-field-searchable-${key}`)).toBeVisible();
    }
    // Only `notes` is searchable in the file above.
    await expect(page.getByTestId("custom-field-searchable-notes")).toBeChecked();
    await expect(page.getByTestId("custom-field-searchable-size")).not.toBeChecked();

    // The enum row expands to its declared values.
    await expect(page.getByTestId("custom-field-value-size-xs")).toContainText("XS");
    await expect(page.getByTestId("custom-field-value-size-s")).toContainText("S");
  });

  // @verifies SET-16
  test("SET-16: the type control is disabled and says why, while label and searchable stay editable", async ({
    page,
    tracker,
  }) => {
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      withCustomFields(yaml, [
        "  - key: story_points",
        "    label: Story points",
        "    type: number",
        "    multi: false",
        "    searchable: true",
      ]),
      "utf8",
    );
    // A task holding a value under the declared type, which is what
    // makes the lock load-bearing. Through the API because `loctt set`
    // takes strings and a `number` field rejects "5".
    const [k] = await tracker.seed([{ title: "estimated" }]);
    const put = await fetch(`${tracker.baseURL}/api/tasks/${k as string}/set`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loctt-client": "test" },
      body: JSON.stringify({ field: "story_points", value: 5 }),
    });
    expect(put.status, await put.text()).toBeLessThan(300);

    await page.goto(`${tracker.baseURL}/settings/custom-fields`);

    // Disabled, not merely validated on submit. `toHaveJSProperty`
    // rather than `toBeDisabled` — the control sits inside a <label>,
    // and Playwright's disabled check retargets to the labelled
    // control, which would make this assertion about the wrong node.
    await expect(page.getByTestId("custom-field-type-story_points"))
      .toHaveJSProperty("disabled", true);
    await expect(page.getByTestId("custom-field-multi-story_points"))
      .toHaveJSProperty("disabled", true);

    // And it states the reason, naming the stored values.
    await expect(page.getByTestId("custom-field-type-lock-story_points"))
      .toContainText(/stored under this type/i);
    // The honest alternative, rather than pretending the change works.
    await expect(page.getByTestId("custom-field-type-lock-story_points"))
      .toContainText(/new field/i);

    // The lock is targeted: label and searchable are still editable.
    await expect(page.getByTestId("custom-field-searchable-story_points"))
      .toHaveJSProperty("disabled", false);
    await page.getByTestId("custom-field-label-story_points").fill("Points");
    await page.getByTestId("custom-field-label-story_points").blur();
    await expect.poll(async () => (await workflowYaml(tracker.root)).includes("label: Points"))
      .toBe(true);
    // …and the type in the file did not move.
    expect(await workflowYaml(tracker.root)).toContain("type: number");
  });

  // @verifies SET-8
  test("SET-8: the weights sub-table is editable and the panel names the sort fallback", async ({
    page,
    tracker,
  }) => {
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      withCustomFields(yaml, [
        "  - key: size",
        "    label: Size",
        "    type: enum",
        "    multi: false",
        "    searchable: false",
        "    values:",
        "      - key: xs",
        "        label: XS",
        "      - key: s",
        "        label: S",
        "      - key: m",
        "        label: M",
      ]),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/custom-fields`);

    // With no weights set, the panel says which fallback applies.
    await expect(page.getByTestId("custom-field-values-size"))
      .toHaveAttribute("data-sort-basis", "declared");
    await expect(page.getByTestId("custom-field-sort-note-size"))
      .toContainText(/declared order/i);

    // Set a weight; it reaches the file as the value's `value`.
    await page.getByTestId("custom-field-weight-size-xs").fill("1");
    await page.getByTestId("custom-field-weight-size-xs").blur();
    await expect.poll(async () => {
      const after = await workflowYaml(tracker.root);
      return /- key: xs\n\s+label: XS\n\s+value: 1/.test(after);
    }).toBe(true);

    await expect(page.getByTestId("custom-field-values-size"))
      .toHaveAttribute("data-sort-basis", "weight");
    await expect(page.getByTestId("custom-field-sort-note-size"))
      .toContainText(/weights/i);

    // Clearing it again returns the stated fallback — SET-8's last
    // bullet, which is about the panel *saying* which applies.
    await page.getByTestId("custom-field-weight-size-xs").fill("");
    await page.getByTestId("custom-field-weight-size-xs").blur();
    await expect(page.getByTestId("custom-field-values-size"))
      .toHaveAttribute("data-sort-basis", "declared");
  });
});

test.describe("SET — estimation", () => {
  // @verifies SET-35
  test("SET-35: custom_enum without preset values is blocked on the field, and nothing is written", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/estimation`);
    const before = await workflowYaml(tracker.root);

    await page.getByTestId("estimation-enabled").check();
    await page.getByTestId("estimation-unit").selectOption("custom_enum");

    // Attached to the preset-values field, not a generic toast.
    const problem = page.getByTestId("estimation-preset-values-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(/preset values/i);
    // And it names the unit_label requirement too.
    await expect(problem).toContainText(/unit label/i);
    await expect(page.getByTestId("estimation-preset-values"))
      .toHaveAttribute("aria-invalid", "true");

    // Save is blocked, and nothing was written — this is a fact about
    // the request never leaving, not about a server 400.
    await expect(page.getByTestId("estimation-save")).toBeDisabled();
    expect(await workflowYaml(tracker.root)).toBe(before);

    // Switching back to a numeric mode clears the error.
    await page.getByTestId("estimation-unit").selectOption("points");
    await expect(page.getByTestId("estimation-preset-values-problem")).toHaveCount(0);
    await expect(page.getByTestId("estimation-save")).toBeEnabled();
  });

  // @verifies SET-9
  test("SET-9: switching modes states the aggregate and a complete custom_enum saves", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/estimation`);

    await page.getByTestId("estimation-enabled").check();
    await page.getByTestId("estimation-unit").selectOption("points");
    // Numeric: aggregates are a sum.
    await expect(page.getByTestId("estimation-aggregate-note")).toContainText(/sum/i);

    await page.getByTestId("estimation-unit").selectOption("custom_enum");
    // Enum: counts per category, and a select over the presets.
    await expect(page.getByTestId("estimation-aggregate-note"))
      .toContainText(/counts per category/i);

    await page.getByTestId("estimation-unit-label").fill("size");
    await page.getByTestId("estimation-preset-values").fill("XS, S, M, L");
    await expect(page.getByTestId("estimation-save")).toBeEnabled();
    await page.getByTestId("estimation-save").click();

    await expect.poll(async () => {
      const after = await workflowYaml(tracker.root);
      return /unit: custom_enum/.test(after)
        && /unit_label: size/.test(after)
        && /- XS/.test(after);
    }).toBe(true);
  });
});

test.describe("SET — calendar", () => {
  // @verifies SET-36
  test("SET-36: one unparseable holiday marks that row, blocks the save, and keeps the others", async ({
    page,
    tracker,
  }) => {
    const holidays = Array.from({ length: 12 }, (_, i) =>
      `  - date: 2026-0${String((i % 9) + 1)}-1${String(i % 9)}\n    label: H${String(i)}`);
    await writeFile(
      calendarPath(tracker.root),
      [
        "timezone: UTC",
        "first_day_of_week: 1",
        "working_days: [1, 2, 3, 4, 5]",
        "holidays:",
        ...holidays,
        "",
      ].join("\n"),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/calendar`);
    await expect(page.getByTestId("calendar-holiday-count")).toContainText("12");
    const before = await readFile(calendarPath(tracker.root), "utf8");

    // Add a thirteenth with the case's own value.
    await page.getByTestId("calendar-holiday-add").click();
    await page.getByTestId("calendar-holiday-date-12").fill("2026-13-45");

    // The specific row is marked, with the expected format shown, and
    // the message names the value that failed.
    await expect(page.getByTestId("calendar-holiday-12"))
      .toHaveAttribute("data-holiday-invalid", "true");
    const problem = page.getByTestId("calendar-holiday-problem-12");
    await expect(problem).toContainText("2026-13-45");
    await expect(problem).toContainText("YYYY-MM-DD");

    // The other 12 are not discarded.
    await expect(page.getByTestId("calendar-holiday-0")).toBeVisible();
    await expect(page.getByTestId("calendar-holiday-0"))
      .not.toHaveAttribute("data-holiday-invalid", "true");
    await expect(page.getByTestId("calendar-blocked")).toContainText("12");

    // Save is blocked, and the file is untouched — the panel does not
    // save 12 of 13 and report success.
    await expect(page.getByTestId("calendar-save")).toBeDisabled();
    expect(await readFile(calendarPath(tracker.root), "utf8")).toBe(before);

    // Removing the bad row unblocks it, and the twelve survive.
    await page.getByTestId("calendar-holiday-remove-12").click();
    await expect(page.getByTestId("calendar-save")).toBeEnabled();
    await expect(page.getByTestId("calendar-holiday-count")).toContainText("12");
  });

  // @verifies SET-23
  test("SET-23: duplicate holiday dates are shown as duplicates, not deduplicated", async ({
    page,
    tracker,
  }) => {
    await writeFile(
      calendarPath(tracker.root),
      [
        "timezone: UTC",
        "first_day_of_week: 1",
        "working_days: [1, 2, 3, 4, 5]",
        "holidays:",
        "  - date: 2026-05-01",
        "    label: May Day",
        "  - date: 2026-12-25",
        "    label: Christmas",
        "  - date: 2026-05-01",
        "    label: Also May Day",
        "",
      ].join("\n"),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/calendar`);

    // All three rows render — a panel that deduplicated would show two.
    await expect(page.getByTestId("calendar-holiday-count")).toContainText("3");
    // And BOTH occurrences carry the marker, so the user can see the
    // pair rather than being told one row is somehow wrong.
    await expect(page.getByTestId("calendar-holiday-0"))
      .toHaveAttribute("data-holiday-duplicate", "true");
    await expect(page.getByTestId("calendar-holiday-2"))
      .toHaveAttribute("data-holiday-duplicate", "true");
    await expect(page.getByTestId("calendar-holiday-1"))
      .not.toHaveAttribute("data-holiday-duplicate", "true");
    await expect(page.getByTestId("calendar-holiday-duplicate-0"))
      .toContainText("2026-05-01");
  });

  // @verifies SET-24
  test("SET-24: an unresolvable timezone names the file and the value, and is not offered as a choice", async ({
    page,
    tracker,
  }) => {
    await writeFile(
      calendarPath(tracker.root),
      [
        "timezone: Mars/Olympus_Mons",
        "first_day_of_week: 1",
        "working_days: [1, 2, 3, 4, 5]",
        "holidays: []",
        "",
      ].join("\n"),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/calendar`);

    // PARTIAL — see docs/dev/known-gaps.md. `CalendarConfigSchema`'s
    // `IanaTimezone` brand rejects an unknown zone at *load*, so
    // `GET /api/calendar` answers 400 and the panel never receives the
    // stored config. SET-24's first three bullets assume the panel is
    // handed the value and renders around it; what it can assert today
    // is that the failure names the file and the offending value
    // rather than a stack trace or an empty form.
    const pane = page.getByTestId("settings-pane");
    await expect(pane).toContainText("calendar.yaml");
    await expect(pane).toContainText("Mars/Olympus_Mons");
    await expect(pane).not.toContainText(/ at Object\.| at async /);
    // Not an empty form that would read as "this tracker has no
    // calendar configured".
    await expect(page.getByTestId("calendar-timezone")).toHaveCount(0);
  });

  // @verifies SET-24
  test("SET-24: the picker does not offer a zone this runtime cannot resolve", async ({
    page,
    tracker,
  }) => {
    // The half of SET-24 that IS reachable: whatever the picker
    // offers, an unresolvable zone is not among the options.
    await page.goto(`${tracker.baseURL}/settings/calendar`);
    // Wait for the panel before reading the options: `evaluateAll` on
    // an unresolved locator returns `[]` rather than retrying, so
    // reading it mid-load asserts "zero options" against a select that
    // has not rendered.
    await expect(page.getByTestId("calendar-panel")).toBeVisible();
    const select = page.getByTestId("calendar-timezone");
    await expect(select.locator("option").first()).toBeAttached();
    const options = await select.locator("option")
      .evaluateAll(els => els.map(e => (e as HTMLOptionElement).value));
    expect(options.length).toBeGreaterThan(1);

    // Asserting only that `Mars/Olympus_Mons` is absent would hold for
    // any list at all — it was never a candidate. What has to hold is
    // that **every** option resolves on this runtime, which is the
    // property "the invalid current value is not offered" is a case of.
    // Verified in the page, so the check runs against the browser's own
    // Intl rather than Node's.
    const unresolvable = await page.evaluate((zones: string[]) =>
      zones.filter(z => {
        try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return false; }
        catch { return true; }
      }), options);
    expect(unresolvable).toEqual([]);
    expect(options).not.toContain("Mars/Olympus_Mons");
  });

  // @verifies SET-25
  // @verifies XS-31
  test("SET-25/XS-31: changing the timezone rewrites no stored date and the panel says which fields move", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "dated", fields: { due_date: "2026-05-01" } }]);
    const { readdir } = await import("node:fs/promises");
    const taskDir = path.join(tracker.root, ".loctt", "tasks");
    const dirs = await readdir(taskDir);
    const taskFile = path.join(taskDir, dirs[0] as string, "task.md");
    const before = await readFile(taskFile, "utf8");
    expect(before).toContain("2026-05-01");

    await page.goto(`${tracker.baseURL}/settings/calendar`);
    // The panel states which fields are date-only and which are
    // datetimes, so the user knows what a zone change does.
    const note = page.getByTestId("calendar-timezone-note");
    await expect(note).toContainText("due_date");
    await expect(note).toContainText(/date-only/i);
    await expect(note).toContainText("updated_at");

    await page.getByTestId("calendar-timezone").selectOption("Asia/Singapore");
    // XS-31: working days go with it in the same save.
    await page.getByTestId("calendar-working-day-6").check();
    await page.getByTestId("calendar-save").click();
    await expect(page.getByTestId("calendar-saved")).toBeVisible();

    // The stored date did not move — only its presentation could.
    expect(await readFile(taskFile, "utf8")).toContain("2026-05-01");
    expect(await readFile(calendarPath(tracker.root), "utf8"))
      .toContain("Asia/Singapore");
    void key;

    // XS-31: the new working days are what a fresh read returns.
    await page.reload();
    await expect(page.getByTestId("calendar-working-day-6")).toBeChecked();
  });

  // @verifies SET-41
  test("SET-41: an over-large calendar payload names the limit and says the prior config stands", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/calendar`);
    await expect(page.getByTestId("calendar-panel")).toBeVisible();
    const before = await readFile(calendarPath(tracker.root), "utf8");

    // The server caps a request body at 1 MB and answers 413. Rather
    // than typing a megabyte of holidays through the UI, the same
    // rejection is delivered on the wire — what the case is about is
    // what the *panel* does with it, and a raw 413 surfaced to the
    // user is the failure it names.
    await page.route("**/api/calendar", route => {
      if (route.request().method() !== "PUT") return route.continue();
      return route.fulfill({ status: 413, contentType: "text/plain", body: "Payload Too Large" });
    });

    await page.getByTestId("calendar-holiday-add").click();
    await page.getByTestId("calendar-holiday-date-0").fill("2026-05-01");
    await page.getByTestId("calendar-save").click();

    const err = page.getByTestId("calendar-save-error");
    await expect(err).toBeVisible();
    // Not a bare 413 — the limit and what exceeded it, in the user's
    // own terms, with the current count against it.
    await expect(err).not.toHaveText(/^413$|Payload Too Large/);
    await expect(err).toContainText(/too large/i);
    await expect(err).toContainText(/holidays/i);
    await expect(err).toContainText("1");
    // The prior config remains in effect, and the panel says so.
    await expect(err).toContainText(/still in effect/i);
    expect(await readFile(calendarPath(tracker.root), "utf8")).toBe(before);
    // …and it tells the user what to trim.
    await expect(err).toContainText(/trim/i);
  });

  // @verifies SET-22
  test("SET-22: clearing every working day is refused with the reason named", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/calendar`);
    const before = await readFile(calendarPath(tracker.root), "utf8").catch(() => "");

    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      const box = page.getByTestId(`calendar-working-day-${String(d)}`);
      if (await box.isChecked()) await box.uncheck();
    }

    // `CalendarConfigSchema` rejects an empty working week outright, so
    // the panel blocks before the request rather than "accepting it
    // with a warning" — recorded as A67. What the case is really
    // about is that the user is told working-day computations cannot
    // resolve, and they are.
    const alert = page.getByTestId("calendar-no-working-days");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/working-day computations/i);
    await expect(alert).toContainText(/cannot resolve/i);
    await expect(page.getByTestId("calendar-save")).toBeDisabled();
    expect(await readFile(calendarPath(tracker.root), "utf8").catch(() => "")).toBe(before);
  });
});

test.describe("SET — the panels under stress and failure", () => {
  // @verifies SET-20
  test("SET-20: 25 statuses all render and the panel scrolls rather than clipping", async ({
    page,
    tracker,
  }) => {
    const yaml = await workflowYaml(tracker.root);
    const extra = Array.from({ length: 21 }, (_, i) =>
      `  - key: extra_${String(i)}\n    label: Extra ${String(i)}\n    category: active`);
    const existing = /^statuses:$/m;
    await writeFile(
      workflowPath(tracker.root),
      yaml.replace(existing, ["statuses:", ...extra].join("\n")),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/statuses`);
    const list = page.getByTestId("statuses-list");
    const count = Number(await list.getAttribute("data-row-count"));
    expect(count).toBeGreaterThanOrEqual(25);

    // Every one of them is in the DOM — a panel that clipped would
    // render fewer rows than the file declares.
    await expect(list.locator("[data-position]")).toHaveCount(count);
    // …and the panel scrolls rather than growing the page unbounded.
    const scrollable = await list.evaluate(el => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    // The last one is reachable.
    await page.getByTestId("statuses-row-extra_20").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("statuses-row-extra_20")).toBeVisible();
  });

  // @verifies SET-34
  test("SET-34: a failed reorder write snaps back and re-dragging is possible immediately", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);
    const keys = await rowKeys(page, "statuses");
    const second = keys[1] as string;
    const before = await workflowYaml(tracker.root);

    // The write fails the way a permission error would.
    await page.route("**/api/workflow", route => {
      if (route.request().method() !== "PUT") return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "io_failed",
          message: "EACCES: permission denied, open '.loctt/config/workflow.yaml'",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      });
    });

    await page.getByTestId(`statuses-handle-${second}`).focus();
    await page.keyboard.press("ArrowUp");

    // The list snaps back rather than showing an order that was not
    // saved. This is the assertion the whole case turns on.
    await expect(page.getByTestId(`statuses-row-${second}`))
      .toHaveAttribute("data-position", "2");
    expect(await workflowYaml(tracker.root)).toBe(before);

    // The error names the file, says it was not saved, and gives the
    // next action.
    const err = page.getByTestId("workflow-save-error");
    await expect(err).toContainText("workflow.yaml");
    await expect(err).toContainText(/not saved/i);
    await expect(err).toContainText(/permission/i);

    // Re-dragging is possible immediately — the panel is not disabled.
    await expect(page.getByTestId(`statuses-handle-${second}`))
      .toHaveJSProperty("disabled", false);
  });

  // @verifies SET-33
  test("SET-33: an invalid workflow.yaml names the file and offers a reload rather than an empty list", async ({
    page,
    tracker,
  }) => {
    // A status missing its required `category` — the case's example.
    await writeFile(
      workflowPath(tracker.root),
      "key:\n  prefix: T-\nstatuses:\n  - key: todo\n    label: Todo\n"
      + "priorities: []\ntask_types: []\nrelationships: []\ncustom_fields: []\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/statuses`);

    const pane = page.getByTestId("workflow-panel-error");
    await expect(pane).toBeVisible();
    // Not an empty list, which would read as "you have no statuses".
    await expect(page.getByTestId("statuses-list")).toHaveCount(0);
    // Distinguished from an unreachable server, and named as such.
    await expect(page.locator('[data-workflow-error="config-invalid"]')).toBeVisible();
    // The file, the entry and the missing field — not a stack trace.
    await expect(pane).toContainText("workflow.yaml");
    await expect(pane).toContainText(/category/i);
    await expect(pane).not.toContainText(/ at Object\.| at async /);

    // A Reload re-parses without a server restart: fix the file and
    // the error clears. The repaired document needs `category` AND the
    // exactly-one-default rule the schema enforces across entries —
    // writing back only the missing field leaves it invalid for a
    // different reason and the panel would still be red.
    await writeFile(
      workflowPath(tracker.root),
      "key:\n  prefix: T-\nstatuses:\n  - key: todo\n    label: Todo\n"
      + "    category: pending\n    default: true\n"
      + "priorities: []\ntask_types: []\nrelationships: []\ncustom_fields: []\n",
      "utf8",
    );
    await page.getByTestId("workflow-reload").click();
    await expect(page.getByTestId("statuses-row-todo")).toBeVisible();
  });

  // @verifies SET-28
  test("SET-28: a hand-rewrite under an open panel is not overwritten by a stale copy", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/statuses`);
    await expect(page.getByTestId("statuses-list")).toBeVisible();
    const keys = await rowKeys(page, "statuses");
    const second = keys[1] as string;

    // The file gains a status while the panel sits open, holding a
    // copy that no longer has it.
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      yaml.replace(
        /^statuses:$/m,
        "statuses:\n  - key: added_by_hand\n    label: Added by hand\n    category: active",
      ),
      "utf8",
    );

    // Now reorder from the stale panel.
    await page.getByTestId(`statuses-handle-${second}`).focus();
    await page.keyboard.press("ArrowUp");

    // SET-28: the hand-added status must survive. A panel that PUT its
    // stale copy would delete `added_by_hand` — and the server would
    // accept that, because nothing on disk references it. This is the
    // assertion that the panel re-reads (or refuses) rather than
    // saving over.
    await expect.poll(async () => (await workflowYaml(tracker.root)).includes("added_by_hand"))
      .toBe(true);

    // And after reloading, the panel shows the hand-edited content —
    // not a merged hybrid.
    await page.reload();
    await expect(page.getByTestId("statuses-row-added_by_hand")).toBeVisible();
  });

  // @verifies SET-18
  test("SET-18: a task on a hand-deleted status shows the raw key with a drift marker, and editing clears it", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "drifting" }]);
    await tracker.run(["set", key as string, "status", "in_progress"]);

    // Hand-delete the status from the file while a task still holds
    // it — the state SET-17's "leave them dangling" branch produces,
    // reached here the way the case describes it.
    const yaml = await workflowYaml(tracker.root);
    await writeFile(
      workflowPath(tracker.root),
      yaml.replace(
        "  - key: in_progress\n    label: In progress\n    category: active\n",
        "",
      ),
      "utf8",
    );
    expect(collectionKeys(await workflowYaml(tracker.root), "statuses"))
      .not.toContain("in_progress");

    await page.goto(`${tracker.baseURL}/tasks/${key as string}`);

    // The **status field's own** marker, by its test id. A body-wide
    // regex passed here against the activity feed's drift badge while
    // the status field itself was untested — the marker has to be on
    // the control that shows the drifted value.
    const marker = page.getByTestId("meta-unrecognized-status");
    await expect(marker).toBeVisible();
    // It carries the raw key — never blank, and never silently coerced
    // to the first status, which is the failure that loses the user's
    // data quietly.
    await expect(marker).toContainText("in_progress");
    await expect(marker).toContainText("not in the current config");

    // Editing the task to a valid status clears the marker for it.
    await tracker.run(["set", key as string, "status", "done"]);
    await page.reload();
    await expect(page.getByTestId("meta-unrecognized-status")).toHaveCount(0);
  });

  // @verifies SET-1
  // @verifies SET-1
  //
  // SET-1's *first* bullet, which nothing asserted: "Landing on
  // `/settings` redirects to a concrete section rather than rendering
  // an empty pane." The existing SET-1 test only ever visits
  // `/settings/<section>`, so the bare path went unchecked — and it
  // fell through to the app-level 404 while `/settings/typo` rendered
  // the shell correctly. The typo'd URL was handled better than the
  // canonical one.
  test("SET-1: the bare /settings redirects to a concrete section", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings`);

    // Redirected to a real section, not left on a bare path.
    await expect(page).toHaveURL(/\/settings\/[a-z-]+$/);
    // And that section actually rendered — a redirect to an empty pane
    // would satisfy the URL assertion alone.
    await expect(page.getByTestId("settings-nav")).toBeVisible();

    // `replace: true`, so back leaves settings rather than stepping
    // onto the bare path and redirecting again — which would trap the
    // user in a loop they cannot back out of.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/settings/);
  });

  test("SET-1: every workflow section is a real route reachable by URL and by back", async ({
    page,
    tracker,
  }) => {
    // Pasting a section URL into a fresh tab opens that panel with the
    // nav item highlighted.
    await page.goto(`${tracker.baseURL}/settings/calendar`);
    await expect(page.getByTestId("calendar-panel")).toBeVisible();
    await expect(page.getByTestId("settings-nav-calendar"))
      .toHaveAttribute("aria-current", "page");

    // Clicking each nav item changes the URL.
    for (const section of ["statuses", "priorities", "task-types", "relationships"]) {
      await page.getByTestId(`settings-nav-${section}`).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${section}$`));
      await expect(page.getByTestId(`settings-nav-${section}`))
        .toHaveAttribute("aria-current", "page");
      // Every one resolves to a real panel, not a placeholder.
      await expect(page.getByTestId("settings-not-built")).toHaveCount(0);
    }

    // Back steps through the sections visited, not out of the app.
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/task-types$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/priorities$/);

    // Leaving settings and returning via back restores the last
    // section, not the default one.
    await page.goto(`${tracker.baseURL}/list`);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/priorities$/);
  });

  // @verifies SET-10
  test("SET-10: the calendar panel's stored config is what a date picker reads", async ({
    page,
    tracker,
  }) => {
    await writeFile(
      calendarPath(tracker.root),
      [
        "timezone: Europe/Berlin",
        "first_day_of_week: 1",
        "working_days: [1, 2, 3, 4, 5]",
        "holidays:",
        "  - date: 2026-05-01",
        "    label: Labour Day",
        "",
      ].join("\n"),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/calendar`);
    // The panel is a faithful lens on the file.
    await expect(page.getByTestId("calendar-timezone")).toHaveValue("Europe/Berlin");
    await expect(page.getByTestId("calendar-first-day")).toHaveValue("1");
    for (const d of [1, 2, 3, 4, 5]) {
      await expect(page.getByTestId(`calendar-working-day-${String(d)}`)).toBeChecked();
    }
    for (const d of [0, 6]) {
      await expect(page.getByTestId(`calendar-working-day-${String(d)}`)).not.toBeChecked();
    }
    await expect(page.getByTestId("calendar-holiday-date-0")).toHaveValue("2026-05-01");

    // Changing first day to Sunday reaches the file, which is what the
    // pickers read on their next render.
    await page.getByTestId("calendar-first-day").selectOption("0");
    await page.getByTestId("calendar-save").click();
    await expect(page.getByTestId("calendar-saved")).toBeVisible();
    expect(await readFile(calendarPath(tracker.root), "utf8"))
      .toContain("first_day_of_week: 0");
  });
});

/**
 * Transcribed from docs/dev/ui-test-cases/flow-tasks.md,
 * flow-errors.md and flow-cross-surface.md — M2.2b, the meta panel's
 * failure and concurrency behaviour.
 *
 * **Two of these cases are satisfied by construction, and that is
 * exactly why they are dangerous to test.** `useSetField` sends
 * `{ field, value }`, so XS-7's "the body does not contain `title`,
 * `body`, `labels`…" and TSK-34's "never sends a whole-frontmatter
 * overwrite" are already true of every write the app makes. A test
 * that changed a field and asserted the write landed would pass
 * whether the body carried one field or twenty — vacuity shape 2. So
 * the tests for those two **read the request body off the wire** and
 * assert on its keys, which is the only thing that can distinguish a
 * field-level write from a whole-object one.
 *
 * The same discipline as `flow-task-meta.spec.ts` otherwise: writes
 * are read back off disk rather than off the screen, and no test
 * reloads the page unless the case is about a reload.
 */

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page, Request } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

/** The frontmatter block of the task with this key. */
async function frontmatterOf(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return text;
  }
  throw new Error(`no task on disk with key ${key}`);
}

/** The on-disk directory of the task with this key. */
async function dirOf(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) {
      return path.join(tasksDir, id);
    }
  }
  throw new Error(`no task on disk with key ${key}`);
}

async function waitForFile(
  root: string,
  key: string,
  predicate: (text: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  let last = "";
  while (Date.now() < deadline) {
    last = await frontmatterOf(root, key);
    if (predicate(last)) return last;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`task.md for ${key} never ${what}. Last:\n${last}`);
}

async function writeWorkflow(root: string, yaml: string): Promise<void> {
  await writeFile(path.join(root, ".loctt", "config", "workflow.yaml"), yaml, "utf8");
}

function trigger(page: Page, label: string) {
  return page.getByTestId(`meta-edit-${label}`);
}

function options(page: Page, label: string) {
  return page.getByTestId(`meta-options-${label}`);
}

const notice = (page: Page) => page.getByTestId("meta-field-error");

test.describe("XS-7 / TSK-34 / XS-8 — the shape of the write", () => {
  // @verifies XS-7
  test("XS-7: the request body carries the changed field and nothing else", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    // Seeded with a *populated* task, deliberately. Against a task
    // with only a title and a status, a client that PUT the whole
    // frontmatter would send a body with barely more keys than a
    // field-level one — and this test would be unable to tell them
    // apart. Every one of these fields is a key that must be absent.
    const [key] = await tracker.seed([
      {
        title: "A task with a lot of frontmatter",
        fields: {
          status: "building",
          task_type: "defect",
          due_date: "2027-01-01",
          estimate: "5",
        },
      },
    ]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["label", "create", "backend"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Building");

    // The only thing that can tell a field-level write from a
    // whole-object one. Asserting on the *outcome* cannot: both write
    // priority, and both leave the file valid.
    const bodies: Record<string, unknown>[] = [];
    const methods: string[] = [];
    const urls: string[] = [];
    page.on("request", (req: Request) => {
      if (!/\/api\/tasks\//.test(req.url())) return;
      if (req.method() === "GET") return;
      methods.push(req.method());
      urls.push(req.url());
      const raw = req.postData();
      if (raw !== null) bodies.push(JSON.parse(raw) as Record<string, unknown>);
    });

    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "This week" }).click();

    await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*p1_week\s*$/m.test(t),
      "took priority p1_week",
    );

    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    if (body === undefined) throw new Error("no write body was captured");

    // First bullet: only the changed field. `{field, value}` is core's
    // `setField` shape — the body names *which* field rather than
    // being a frontmatter fragment.
    //
    // GIT-19 (commit 9938221) legitimately added a third key,
    // `expectedId` — the stable ULID the tab fetched, sent as the
    // wrong-task precondition so a background rekey can't land the edit
    // on a different task. It is a precondition, NOT a frontmatter
    // field, so it does not violate this bullet's intent ("only the
    // changed field, not a whole-frontmatter fragment"). Per CLAUDE.md's
    // edit-a-green-test rule, this assertion was widened because the
    // behavior legitimately changed — but the no-bleed intent is
    // preserved: every key must be one of {field, value, expectedId},
    // and the frontmatter-key check below still fails on any leak.
    expect(Object.keys(body).sort()).toEqual(["expectedId", "field", "value"]);
    expect(body["field"]).toBe("priority");
    expect(body["value"]).toBe("p1_week");
    expect(typeof body["expectedId"]).toBe("string");

    // Second and third bullets, asserted on the serialized body so a
    // nested whole-frontmatter object would be caught too. Every one of
    // these is set on this task or auto-managed, so a whole-object PUT
    // would carry all of them.
    const raw = JSON.stringify(body);
    for (const forbidden of [
      "title", "body", "labels", "status", "task_type", "due_date", "estimate",
      "id", "key", "key_history", "created_at", "project", "archived",
      "archived_at", "status_updated_at", "completed_date", "board_rank",
    ]) {
      expect(raw, `the body must not carry ${forbidden}`).not.toContain(`"${forbidden}"`);
    }

    // And it went to the field-level verb rather than to the resource.
    // A PUT on `/api/tasks/:ref` is what the case rules out by name;
    // there is no such route, and this is what would notice if one
    // appeared.
    expect(methods).toEqual(["POST"]);
    expect(urls[0]).toMatch(/\/api\/tasks\/[^/]+\/set$/);
  });

  // @verifies TSK-34
  test("TSK-34: a CLI status change survives a UI priority write, and is picked up", async ({
    page,
    tracker,
  }) => {
    // Waiting out the real 30-second `staleTime` and then driving a
    // real focus transition takes longer than the suite default. The
    // alternative — `page.reload()` — is the XS-1 vacuity: it
    // refetches from the server regardless of every client mechanism
    // this test exists to check.
    test.setTimeout(120_000);
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Concurrent task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Triaging");

    const bodies: Record<string, unknown>[] = [];
    page.on("request", (req: Request) => {
      if (!/\/api\/tasks\/.*\/(set|unset)$/.test(req.url())) return;
      const raw = req.postData();
      if (raw !== null) bodies.push(JSON.parse(raw) as Record<string, unknown>);
    });

    // The CLI writes status while the page is open and unaware.
    await tracker.run(["set", key, "status", "verifying"]);

    // First bullet: the panel picks the CLI's status up. No reload —
    // a reload refetches regardless of any client mechanism, which is
    // the XS-1 defect shape. The window refocus below drives the real
    // `refetchOnWindowFocus` edge instead.
    await refocus(page);
    await expect(trigger(page, "status")).toContainText("Verifying", { timeout: 20_000 });

    // Second bullet: the UI writes priority only.
    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "Someday" }).click();

    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*p5_someday\s*$/m.test(t),
      "took priority p5_someday",
    );
    // The CLI's status is still on disk. This is the assertion the
    // case is about, and it is read off the file rather than the
    // screen.
    expect(fm).toMatch(/^status:\s*verifying\s*$/m);

    // Third bullet. It is satisfied by construction, which is why it
    // is asserted on the *body* rather than on the outcome above: the
    // status assertion would also pass for a whole-object write built
    // from a snapshot that had already caught up.
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    if (body === undefined) throw new Error("no write body was captured");
    // GIT-19 (commit 9938221) added the `expectedId` precondition key —
    // the stable ULID the tab holds, sent so a background rekey can't
    // land this write on the wrong task. It is a precondition, not a
    // frontmatter field, so the no-bleed intent (the body carries only
    // the changed field, never the CLI-written `status`) is preserved.
    // Per CLAUDE.md's edit-a-green-test rule, this assertion was widened
    // because the behavior legitimately changed; the `status`/`title`
    // absence checks below still guard against a whole-object write.
    expect(Object.keys(body).sort()).toEqual(["expectedId", "field", "value"]);
    expect(body["field"]).toBe("priority");
    expect(typeof body["expectedId"]).toBe("string");
    expect(JSON.stringify(body)).not.toContain("status");
    expect(JSON.stringify(body)).not.toContain("title");
  });

  // @verifies XS-8
  test("XS-8: a CLI assignee write and a UI priority write both survive", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const created = await tracker.run([
      "user", "create", "Alex Reed", "--email", "alex@example.com",
    ]);
    const userId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(created)?.[1];
    if (userId === undefined) throw new Error("could not parse the created user id");

    const [key] = await tracker.seed([{ title: "Race task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    // The page has loaded and cached a task with no assignee. That
    // cached copy is what must not be written back.
    await expect(trigger(page, "assignee")).toContainText("—");

    // The CLI sets assignee. The UI is not told and does not refetch.
    await tracker.run(["set", key, "assignee", userId]);

    // …and *without refreshing*, the UI changes a different field.
    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "Not now" }).click();

    // First bullet, through the CLI — the surface the case names, and
    // one that cannot be fooled by anything the client believes.
    await expect
      .poll(async () => tracker.run(["show", key]), { timeout: 15_000 })
      .toMatch(/Not now|p7_no/);
    // `loctt show` prints the assignee's stored id, not their name
    // (`task-crud.ts`: `Assignee: ${fm.assignee}`), so this matches the
    // exact id rather than the display name. An alternation that also
    // accepted any ULID would match the task's own `id` line and
    // assert nothing.
    const shown = await tracker.run(["show", key]);
    expect(shown).toMatch(new RegExp(`^Assignee:\\s*${userId}\\s*$`, "m"));

    // And on disk, unambiguously: both fields, neither reverted.
    const fm = await frontmatterOf(tracker.root, key);
    expect(fm).toMatch(/^priority:\s*p7_no\s*$/m);
    expect(fm).toMatch(new RegExp(`^assignee:\\s*${userId}\\s*$`, "m"));

    // Second bullet: after its own write settles the panel refetches,
    // so it shows the assignee it never knew about. Not a reload.
    await expect(trigger(page, "assignee")).toContainText("Alex Reed", {
      timeout: 20_000,
    });
    await expect(trigger(page, "priority")).toContainText("Not now");
  });
});

test.describe("XS-4 — a CLI edit lands under an open page", () => {
  // @verifies XS-4
  test("XS-4: the panel converges on a CLI write without clobbering an open editor", async ({
    page,
    tracker,
  }) => {
    // Waiting out the real 30-second `staleTime` and then driving a
    // real focus transition takes longer than the suite default. The
    // alternative — `page.reload()` — is the XS-1 vacuity: it
    // refetches from the server regardless of every client mechanism
    // this test exists to check.
    test.setTimeout(120_000);
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Staleness task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Triaging");
    // The `title` carries the exact ISO stamp; the visible text is the
    // relative form. Both are asserted below — the text because it is
    // what the user reads, the stamp because "just now" is the same
    // string for a write five seconds after the load and would make
    // the assertion vacuous inside the first 45 seconds.
    const stampBefore = await page.getByTestId("meta-updated")
      .locator("time").getAttribute("title");
    expect(stampBefore).not.toBeNull();

    // **Second bullet, and the reason this test is shaped this way.**
    //
    // The edit has to be genuinely pending *at the moment the refetch
    // lands*. A test that opened the editor after the refetch, or
    // closed it before, would pass without exercising the interaction
    // at all — the mechanism under test is the guard in `TextField`
    // that suppresses `setDraft(value)` while `editing`, and it is
    // only reachable while an editor is open with a dirty draft.
    //
    // So: open the estimate editor, type a draft, leave it open and
    // unsaved, and only *then* let the CLI write and the refetch fire.
    await trigger(page, "estimate").click();
    const input = page.getByTestId("meta-input-estimate");
    await expect(input).toBeFocused();
    await input.fill("13");
    await expect(input).toHaveValue("13");

    // The CLI changes the status — XS-4's first bullet — **and** the
    // estimate, which is the field the user has open.
    //
    // The estimate write is what makes the second bullet testable. With
    // the CLI touching only `status`, the open editor's `value` prop
    // never changes, so the guard in `TextField` that suppresses
    // `setDraft` while `editing` is never even consulted: the test
    // passes with the guard deleted, which is vacuity shape 1. Writing
    // the same field the user is editing is the only arrangement in
    // which "not clobbered by the refetch" has anything to clobber.
    await tracker.run(["set", key, "status", "shipped"]);
    await tracker.run(["set", key, "estimate", "99"]);

    // Drive the refetch through the real focus transition rather than
    // a reload — a reload would remount the panel and destroy the
    // pending edit, which is the very thing under test.
    await refocus(page);

    // First bullet: the status row moves.
    await expect(trigger(page, "status")).toContainText("Shipped", { timeout: 20_000 });

    // Second bullet: the pending edit survived the refetch that just
    // repainted the status row beside it *and* brought a new value for
    // this very field. The input is still open, still focused, and
    // still holds the user's draft rather than the CLI's 99.
    await expect(input).toHaveValue("13");
    await expect(input).not.toHaveValue("99");
    await expect(input).toBeFocused();

    // Positive counterpart to that absence: the draft is not merely
    // *present*, it is still live — committing it writes the value the
    // user typed rather than whatever the refetch brought.
    await input.press("Enter");
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^estimate:\s*13\s*$/m.test(t),
      "took estimate 13",
    );
    // And the CLI's status is untouched by that commit — the user's
    // estimate won over the CLI's 99 because the user acted last, but
    // nothing else moved with it.
    expect(fm).toMatch(/^status:\s*shipped\s*$/m);
    expect(fm).not.toMatch(/^estimate:\s*99\s*$/m);

    // Third bullet: the footer reflects the CLI write. Compared against
    // what it read before rather than against a literal, so this
    // cannot pass on a footer that renders a constant.
    await expect
      .poll(
        async () => page.getByTestId("meta-updated").locator("time").getAttribute("title"),
        { timeout: 20_000 },
      )
      .not.toBe(stampBefore);

    // And it is a *relative* time on screen, not a date. A date is
    // day-granularity, so a CLI write and the page load beside it
    // render the identical string — the user cannot see that anything
    // changed, which is what this bullet asks for. This is the
    // assertion that would go red if the footer went back to
    // `shortDate`.
    await expect(page.getByTestId("meta-updated"))
      .toContainText(/just now|\d+[mhdw] ago/);
  });
});

test.describe("TSK-29 — an orphaned status value", () => {
  // @verifies TSK-29
  test("TSK-29: an orphaned status is shown, repairable, and not rewritten on load", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Orphan task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "status", "verifying"]);

    // Remove exactly the status this task references. The other six
    // stay, so the panel still has a real vocabulary to offer — a
    // config with no statuses at all would make the second bullet
    // pass trivially.
    await writeWorkflow(
      tracker.root,
      SEVEN_STATUS_WORKFLOW.replace(
        "  - key: verifying\n    label: Verifying\n    category: active\n",
        "",
      ),
    );

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // First bullet: the raw stored key, marked. Both halves — the key
    // must be visible (it is the only thing that says *which* value to
    // repair) and it must be marked (or the user reads it as a label).
    const orphan = page.getByTestId("meta-unrecognized-status");
    await expect(orphan).toBeVisible();
    await expect(orphan).toContainText("verifying");
    await expect(orphan).toContainText("not in the current config");

    // Third bullet: nothing was rewritten by the load. Read off disk,
    // because the panel showing "verifying" would also be true of an
    // app that had already written `triage` and was rendering stale
    // state.
    expect(await frontmatterOf(tracker.root, key)).toMatch(/^status:\s*verifying\s*$/m);

    // Fourth bullet: an unrelated field still writes, and the orphan
    // survives it. This is the bullet the core freeze (`46507e8`) made
    // impossible until it was fixed.
    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "This sprint" }).click();
    const afterUnrelated = await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*p3_sprint\s*$/m.test(t),
      "took priority p3_sprint",
    );
    expect(afterUnrelated).toMatch(/^status:\s*verifying\s*$/m);
    // And the panel still flags it — the write did not quietly
    // normalise the display either.
    await expect(orphan).toContainText("verifying");

    // Second bullet: the dropdown offers the six that remain, and
    // choosing one repairs the task on disk.
    await trigger(page, "status").click();
    const list = options(page, "status");
    await expect(list.getByRole("option")).toHaveCount(6);
    await expect(list.getByRole("option", { name: "Verifying" })).toHaveCount(0);
    await list.getByRole("option", { name: "In review" }).click();

    const repaired = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_review\s*$/m.test(t),
      "was repaired to in_review",
    );
    expect(repaired).not.toMatch(/^status:\s*verifying\s*$/m);
    await expect(page.getByTestId("meta-unrecognized-status")).toHaveCount(0);
  });
});

test.describe("TSK-46 / TSK-47 / ERR-43 — a rejected write", () => {
  // @verifies TSK-46
  // @verifies ERR-43
  test("TSK-46: a since-archived assignee is shown disabled in the querying picker, so no write is sent (K90)", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const created = await tracker.run([
      "user", "create", "Robin Vale", "--email", "robin@example.com",
    ]);
    const userId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(created)?.[1];
    if (userId === undefined) throw new Error("could not parse the created user id");

    // Assigned to somebody else first, so "the task's existing values
    // are untouched" is a claim with something to be untouched. Against
    // an unassigned task the third bullet passes for free.
    const other = await tracker.run([
      "user", "create", "Sam Okafor", "--email", "sam@example.com",
    ]);
    const otherId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(other)?.[1];
    if (otherId === undefined) throw new Error("could not parse the second user id");

    const [key] = await tracker.seed([{ title: "Archived-assignee task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "assignee", otherId]);
    await tracker.run(["set", key, "status", "building"]);

    // Loaded *before* the archive, so the picker is stale — the
    // "stale picker or a race with an archive happening elsewhere"
    // the case names. A page loaded after would render the option
    // disabled and never send the write.
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "assignee")).toContainText("Sam Okafor");
    await expect(page.getByTestId("meta-options-assignee")).toHaveCount(0);

    await tracker.run(["user", "archive", userId]);

    // K90: the assignee picker queries the server when opened, so even a
    // page loaded before the archive shows Robin as archived-disabled the
    // moment the list is opened — the "stale picker" that used to send a
    // doomed write no longer exists on this path. The write is therefore
    // prevented at the control rather than sent-and-refused; the
    // server-side archived-reference guard still holds and is covered by
    // core (`config/archived-guard.test.ts`, `…-fails-closed.test.ts`)
    // and the MCP guard tests. What this UI case now asserts is the
    // client-side prevention: the archived user is present, named,
    // marked, and unselectable, and nothing is written.
    await trigger(page, "assignee").click();
    const robin = options(page, "assignee").getByRole("option", { name: /Robin Vale/ });
    // Present and named — not silently dropped — and marked archived...
    await expect(robin).toBeVisible();
    await expect(robin).toContainText("archived");
    // ...but not choosable: the option is disabled, so no write is sent.
    await expect(robin).toBeDisabled();
    // The panel explains why archived entities are not offered.
    await expect(options(page, "assignee")).toContainText(/archived/i);

    // The assignee is unchanged on screen and on disk — no optimistic
    // flash of Robin, and the status set beside it is untouched.
    await expect(trigger(page, "assignee")).toContainText("Sam Okafor");
    await expect(trigger(page, "assignee")).not.toContainText("Robin Vale");
    const fm = await frontmatterOf(tracker.root, key);
    expect(fm).toMatch(new RegExp(`^assignee:\\s*${otherId}\\s*$`, "m"));
    expect(fm).not.toContain(userId);
    expect(fm).toMatch(/^status:\s*building\s*$/m);
  });

  // @verifies TSK-47
  // @verifies ERR-3
  // @verifies ERR-43
  test("TSK-47/ERR-3: a failed status write rolls back visibly, says not saved, and retries", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Failing write task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "status", "building"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Building");
    const updatedBefore = await page.getByTestId("meta-updated").innerText();
    const fmBefore = await frontmatterOf(tracker.root, key);

    // Fail the write at the wire rather than by corrupting the
    // tracker: the case is about what the panel does with a rejection,
    // and a real 500 from the server would also be a server test.
    // The envelope is the one the server sends, so nothing here is a
    // shape the app would not otherwise meet.
    let failing = true;

    // The task GET is blocked while the write is failing, and released
    // with it. Without this the rollback is untestable: `onSettled`
    // invalidates the task query, and the refetch repaints the true
    // value from the server — so deleting `onError`'s rollback
    // entirely leaves the screen looking identical a moment later.
    // Verified: with the GET open, removing the rollback kept this
    // test green.
    await page.route(`**/api/tasks/${key}`, async route => {
      if (failing) { await route.abort(); return; }
      await route.fallback();
    });

    await page.route(`**/api/tasks/*/set`, async route => {
      if (!failing) { await route.fallback(); return; }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal",
          message: "the task file could not be written",
          field: "status",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      });
    });

    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Shipped" }).click();

    // First bullet: the panel reverts. A failed save must never look
    // like it succeeded.
    await expect(trigger(page, "status")).toContainText("Building", { timeout: 15_000 });
    await expect(trigger(page, "status")).not.toContainText("Shipped");

    // Second bullet: the field, the reason, and a retry control.
    const n = notice(page);
    await expect(n).toBeVisible();
    await expect(n).toHaveAttribute("data-field", "status");
    await expect(n).toContainText("Status");
    await expect(n).toContainText(key);
    await expect(n).toContainText("could not be written");
    // ERR-3's second bullet: the data-state claim in words, not just
    // "an error occurred".
    await expect(n).toContainText("Your change was not saved.");
    await expect(page.getByTestId("meta-field-error-retry")).toBeVisible();

    // Third bullet: the footer's updated timestamp does not advance.
    expect(await page.getByTestId("meta-updated").innerText()).toBe(updatedBefore);

    // Fourth bullet: the file still holds the old status. Read off
    // disk rather than by reloading — a reload would refetch and could
    // mask a client that had kept the optimistic value.
    const fmAfter = await frontmatterOf(tracker.root, key);
    expect(fmAfter).toMatch(/^status:\s*building\s*$/m);
    expect(fmAfter).toBe(fmBefore);

    // ERR-3's fourth bullet: retry re-attempts *the same field-level
    // write*. With the route released it must land `shipped` — the
    // value the user chose — rather than re-sending the rolled-back
    // `building`, which would look like a success and change nothing.
    failing = false;
    await page.getByTestId("meta-field-error-retry").click();
    const repaired = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*shipped\s*$/m.test(t),
      "took status shipped on retry",
    );
    expect(repaired).not.toMatch(/^status:\s*building\s*$/m);
    await expect(notice(page)).toHaveCount(0);
  });

  // @verifies ERR-43
  test("ERR-43: a rejected enum value is reported in labels, not stored keys", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Label-copy task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Triaging");

    // The server's real rejection for a status it does not know. Sent
    // through the route so the *value* is one the picker would never
    // offer — which is what makes core produce the `valid:` list this
    // case is about.
    await page.route(`**/api/tasks/*/set`, async route => {
      const body = route.request().postDataJSON() as { field: string };
      if (body.field !== "status") { await route.fallback(); return; }
      await route.continue({
        postData: JSON.stringify({ field: "status", value: "gone_from_config" }),
      });
    });

    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "In review" }).click();

    const n = notice(page);
    await expect(n).toBeVisible();

    // First bullet: the valid options are the user's labels.
    await expect(n).toContainText("Triaging");
    await expect(n).toContainText("In review");
    await expect(n).toContainText("Abandoned");
    // …and the stored keys are gone. The two halves together: a
    // message that appended labels beside keys would pass the first
    // three assertions.
    const text = await n.innerText();
    expect(text).not.toContain("triage,");
    expect(text).not.toContain("in_review");
    expect(text).not.toContain("abandoned");

    // Second bullet: the value the config does not declare is shown
    // raw *and marked as unrecognized*, so it is not read as a label.
    await expect(n).toContainText("gone_from_config");
    await expect(n).toContainText("unrecognized value");

    // Third bullet: nothing here names a status LocTT was not told
    // about. This config has no "To Do", "In Progress" or "Done", so
    // any of those in the copy would be hardcoded.
    for (const invented of ["To Do", "In Progress", "Done", "Backlog"]) {
      expect(text).not.toContain(invented);
    }
  });
});

test.describe("ERR-4 / XS-57 — outcomes the app cannot or must not guess", () => {
  // @verifies ERR-4
  test("ERR-4: a write with no response says the outcome is unknown, not that it failed", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Silent-server task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "priority")).toContainText("—");

    // The request leaves and nothing ever comes back — the state the
    // case describes. The client's own deadline is what turns silence
    // into an answer; without one the panel spins forever and the
    // case is unreachable, which is what `useSetField` did before
    // M2.2b gave it a `timeoutMs`. Shortened here so the test does not
    // sit out the real fifteen seconds — the mechanism is the same.
    await page.addInitScript(() => {
      (globalThis as { __LOCTT_SET_FIELD_TIMEOUT_MS__?: number })
        .__LOCTT_SET_FIELD_TIMEOUT_MS__ = 1_500;
    });
    await page.reload();
    await expect(trigger(page, "priority")).toContainText("—");

    await page.route(`**/api/tasks/*/set`, async () => {
      // Never fulfilled, never aborted.
      await new Promise(() => { /* hangs */ });
    });

    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "Drop everything" }).click();

    const n = notice(page);
    await expect(n).toBeVisible({ timeout: 20_000 });
    await expect(n).toHaveAttribute("data-data-state", "unknown");

    const text = await n.innerText();
    // First bullet, both directions, asserted on the **data-state
    // line** rather than on the whole notice. The two claims this case
    // forbids are the two sentences that line carries for the other
    // states, so matching it exactly is what distinguishes "does not
    // assert saved" from "happens not to contain that substring" —
    // and a loose `not.toContain("was saved")` would fail on the
    // honest copy, which says "cannot tell whether this was saved".
    const state = await page.getByTestId("meta-field-error-state").innerText();
    expect(state).not.toBe("Your change was saved.");
    expect(state).not.toBe("Your change was not saved.");
    expect(state).toContain("cannot tell whether this was saved");

    // Second bullet: how to find out, named concretely.
    expect(text).toMatch(/Reload/);
    expect(state).toContain("loctt show");

    // Third bullet: no re-send is offered as the action, because a
    // write that may have landed could double-apply. The positive
    // counterpart is the Reload control above — the user is not left
    // without a move.
    await expect(page.getByTestId("meta-field-error-retry")).toHaveCount(0);
    await expect(page.getByTestId("meta-field-error-reload")).toBeVisible();
  });

  // @verifies XS-57
  test("XS-57: a write to a task deleted from the CLI names the key and offers the way out", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Doomed task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "status", "building"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Building");

    // Deleted out from under the open page. `rm` on the directory
    // rather than `loctt delete`, so nothing about the CLI's own
    // confirmation flow is in the way of the case.
    await rm(await dirOf(tracker.root, key), { recursive: true, force: true });

    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "Someday" }).click();

    const n = notice(page);
    await expect(n).toBeVisible({ timeout: 15_000 });
    await expect(n).toHaveAttribute("data-code", "not_found");

    const text = await n.innerText();
    // First bullet: names the key, not the ULID. Core's own sentence
    // is `task not found: "<ULID>"`, so passing it through would fail
    // here — and a ULID is 26 chars of Crockford base32, which this
    // matches without knowing which one.
    expect(text).toContain(key);
    expect(text).toContain("no longer exists");
    expect(text).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);

    // Second bullet: the optimistic change rolled back visibly.
    await expect(trigger(page, "priority")).toContainText("—");
    await expect(trigger(page, "priority")).not.toContainText("Someday");

    // Third bullet: a different sentence from "server unreachable",
    // and retry is not the action offered.
    expect(text).toContain("deleted by another process");
    expect(text).not.toContain("not responding");
    expect(text).not.toContain("loctt ui");
    await expect(page.getByTestId("meta-field-error-retry")).toHaveCount(0);

    // Fourth bullet: a route back to the list, and it works.
    const back = page.getByTestId("meta-field-error-back");
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/list/);
  });
});

/**
 * Drives a real hidden → visible transition, so
 * `refetchOnWindowFocus` fires.
 *
 * Not `page.reload()`, which is the XS-1 vacuity: a reload refetches
 * from the server whatever the client cache is configured to do, so
 * every staleness mechanism could be deleted and the test would not
 * see it. This dispatches the visibility change the focus manager
 * listens for, which is the mechanism itself.
 */
async function refocus(page: Page): Promise<void> {
  // `refetchOnWindowFocus` only refetches a query that is **stale**,
  // and the shared `staleTime` is 30 seconds. Refocusing inside that
  // window is a no-op — correctly, per XS-2's contract — so the wait
  // is part of the mechanism rather than a sleep papering over a race.
  await page.waitForTimeout(31_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * The same seven-status config `flow-task-meta.spec.ts` uses, and for
 * the same reason: against the shipped default a panel with a
 * hardcoded To Do / In Progress / Done list passes most of these, and
 * ERR-43's third bullet ("no message hardcodes a status name") cannot
 * be tested at all.
 */
const SEVEN_STATUS_WORKFLOW = `key:
  prefix: "T-"

statuses:
  - key: triage
    label: Triaging
    category: pending
    default: true
  - key: specced
    label: Specced
    category: pending
  - key: building
    label: Building
    category: active
  - key: in_review
    label: In review
    category: active
  - key: verifying
    label: Verifying
    category: active
  - key: shipped
    label: Shipped
    category: completed
  - key: abandoned
    label: Abandoned
    category: discarded

priorities:
  - key: p0_now
    label: Drop everything
    value: 7
  - key: p1_week
    label: This week
    value: 6
  - key: p3_sprint
    label: This sprint
    value: 5
  - key: p4_quarter
    label: This quarter
    value: 4
  - key: p5_someday
    label: Someday
    value: 3
  - key: p6_nice
    label: Nice to have
    value: 2
  - key: p7_no
    label: Not now
    value: 1

task_types:
  - key: chore
    label: Chore
  - key: defect
    label: Defect
  - key: investigation
    label: Investigation

relationships:
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
    graph: acyclic
  - key: relates_to
    label: Relates to
    kind: symmetric

custom_fields: []

estimation:
  enabled: true
  unit: points
  unit_label: pts
`;

/* ================================================================== *
 * TSK-39 — a task deleted underneath an open detail view
 * TSK-56 — a save blocked by an in-progress schema migration
 * ================================================================== */

test.describe("TSK-39 — the open task is deleted elsewhere", () => {
  // @verifies TSK-39
  test("TSK-39: a hard-delete under the open view is reported, naming the key, with a way back", async ({
    page,
    tracker,
  }) => {
    // Waiting out the real 30-second `staleTime` and driving a real
    // focus transition is what makes the *view* notice the deletion
    // rather than a reload manufacturing a fresh fetch (the XS-1
    // vacuity). So this needs the longer budget.
    test.setTimeout(120_000);

    // A component that crashes on render looks identical in Playwright
    // to one that renders nothing — so watch for it explicitly.
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    const [key] = await tracker.seed([{ title: "About to vanish" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    // The editing surfaces are live before the delete — so their
    // disappearance afterwards is a real change, not a page that never
    // rendered them.
    await expect(page.getByTestId("meta-edit-status")).toBeVisible();

    // Hard-delete from the CLI while the page is open and unaware.
    await tracker.run(["delete", key, "--yes"]);
    // The task file is gone on disk.
    await expect
      .poll(async () => {
        const dir = path.join(tracker.root, ".loctt", "tasks");
        const ids = await readdir(dir);
        for (const id of ids) {
          try {
            const t = await readFile(path.join(dir, id, "task.md"), "utf8");
            if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(t)) return true;
          } catch { /* not a task dir */ }
        }
        return false;
      }, { timeout: 10_000 })
      .toBe(false);

    // The view notices on the next focus-driven refetch — not a reload.
    await refocus(page);

    // First bullet: the view states the task no longer exists, naming
    // the key. `TaskNotFound` renders `role="alert"` and puts the key
    // in the heading.
    const notFound = page.getByRole("alert").filter({ hasText: "No task with the key" });
    await expect(notFound).toBeVisible({ timeout: 20_000 });
    await expect(notFound).toContainText(key);

    // Second bullet: the user is not left editing a phantom — the meta
    // panel and its edit controls are unmounted, not merely disabled.
    await expect(page.getByTestId("meta-edit-status")).toHaveCount(0);
    await expect(page.getByTestId("task-key-chip")).toHaveCount(0);

    // Third bullet: a route back to the list is offered.
    const back = page.getByRole("link", { name: /task list/i });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/list$/);

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

test.describe("TSK-56 — a field write during an in-progress migration", () => {
  // @verifies TSK-56
  test("TSK-56: the panel explains the migration, rolls the value back, and tells the user to wait", async ({
    page,
    tracker,
  }) => {
    // Holding the lock uses core's own helper; importing it here keeps
    // the hold in this process rather than spawning a second `loctt`.
    const { withMigrationLock } = await import("@loctt/core");

    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Blocked by migration" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(trigger(page, "status")).toContainText("Triaging");

    // Hold the migration lock for the duration of the edit attempt.
    // `isMigrationLocked` checks only the advisory lock on
    // `.schema-version`, so this needs no schema-version bump — the
    // tracker stays at its current, supported version, and the boot
    // guard (a *version* mismatch) never fires.
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const lockDone = withMigrationLock(
      path.join(tracker.root, ".loctt"),
      () => held,
    );
    // Give the lock a moment to be acquired before the write races it.
    await new Promise(r => setTimeout(r, 100));

    // Attempt a field edit. The panel is optimistic, so it will show
    // "Verifying" momentarily before the rejection rolls it back.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Verifying" }).click();

    // First bullet: the failure states the tracker is being migrated
    // and that the change was not saved — not a generic error.
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("meta-field-error-message"))
      .toContainText(/migration is in progress/i);
    // Third bullet: told to wait, in words.
    await expect(page.getByTestId("meta-field-error-message"))
      .toContainText(/wait/i);
    // "not saved" is the data-state the notice reports.
    await expect(page.getByTestId("meta-field-error-state"))
      .toContainText(/not.*saved/i);

    // Second bullet: the optimistic value is rolled back — the trigger
    // shows the original status again, and nothing was written to disk.
    await expect(trigger(page, "status")).toContainText("Triaging");
    const fm = await frontmatterOf(tracker.root, key);
    expect(fm).toMatch(/^status:\s*triage\s*$/m);

    // Release the lock so the fixture tears down cleanly.
    release();
    await lockDone;

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

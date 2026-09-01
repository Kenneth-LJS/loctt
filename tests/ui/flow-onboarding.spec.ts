/**
 * The init wizard (M4.6) — flow-onboarding.md § A, § B, § C.
 *
 * The fixture in `fixtures/tracker.ts` is deliberately not used: it
 * runs `loctt init` before starting the server and its readiness probe
 * waits for a 200 from `/api/info`. Every case here is about a
 * directory that has *no* usable tracker, which is exactly the state
 * the fixture removes.
 *
 * Everything asserts against a real server writing real files. The
 * far-end assertions read `.loctt/` off disk rather than trusting the
 * redirect: a wizard that navigates to `/list` without creating a
 * tracker would pass every URL assertion in this file.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { execa } from "execa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close(() => { reject(new Error("could not determine a free port")); });
        return;
      }
      const { port } = addr;
      srv.close(() => { resolve(port); });
    });
  });
}

interface Uninitialized {
  readonly root: string;
  readonly baseURL: string;
  stop(): Promise<void>;
  cli(args: readonly string[]): Promise<string>;
}

/**
 * Boots `loctt ui` on a directory with no usable tracker.
 *
 * Readiness cannot wait for a 200 on a tracker-bearing route, so it
 * waits for `/api/info` to answer 200 with `exists:false` — or, for
 * the empty-`.loctt/` case, `initState:"empty"`. Both are states the
 * server reaches only once it is actually listening.
 */
async function bootUninitialized(
  opts: { emptyLocttDir?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<Uninitialized> {
  const root = await mkdtemp(path.join(workspaceRoot, "loctt-onb-"));
  if (opts.emptyLocttDir === true) await mkdir(path.join(root, ".loctt"));
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${String(port)}`;
  const child = execa(
    process.execPath,
    [cliEntry, "ui", "--port", String(port), "--no-open"],
    { cwd: root, env: { ...process.env, ...opts.env }, reject: false },
  );

  const deadline = Date.now() + 15_000;
  let last = "never answered";
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`server not ready within 15000ms: ${last}`);
    }
    try {
      const res = await fetch(`${baseURL}/api/info`);
      if (res.status === 200) {
        const body = await res.json() as { initState?: string };
        if (body.initState === "absent" || body.initState === "empty") break;
        last = `initState ${String(body.initState)}`;
      } else {
        last = `status ${String(res.status)}`;
      }
    } catch (err) {
      last = String(err);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  return {
    root,
    baseURL,
    cli: async (args) => {
      const r = await execa(process.execPath, [cliEntry, ...args], { cwd: root, reject: false });
      if (r.exitCode !== 0) throw new Error(`loctt ${args.join(" ")} failed: ${r.stderr}`);
      return r.stdout;
    },
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([
        child.catch(() => undefined),
        new Promise(r => setTimeout(r, 2000)),
      ]);
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Fills the wizard's two fields. */
async function fillWizard(page: Page, name: string, prefix: string): Promise<void> {
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Key prefix").fill(prefix);
}

// ---------------------------------------------------------------
// A. Happy path
// ---------------------------------------------------------------

// @verifies ONB-1
// @verifies ONB-2
// @verifies ONB-29
// @verifies A11Y-48
test("an uninitialized directory routes to the wizard on every route, never to an empty list", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    // ONB-29: *every* route the app serves, not just `/`.
    for (const route of ["/", "/list", "/board", "/timeline", "/tasks/T-1", "/settings/general"]) {
      await page.goto(`${t.baseURL}${route}`);

      // ONB-1 / A11Y-48: the heading names the situation in the
      // user's terms. `getByRole` rather than a text match, because
      // A11Y-48 is about what is *announced* — a div styled to look
      // like a heading would pass a text assertion and fail the case.
      await expect(
        page.getByRole("heading", { name: /no tracker in this directory/i }),
        `route ${route} did not show the wizard heading`,
      ).toBeVisible();

      // ONB-1: the app *lands on* `/init`, whatever path was
      // requested — the address bar, not just the rendered screen.
      await page.waitForURL(/\/init$/, { timeout: 10_000 });

      // ONB-1 / ONB-29: no empty-data presentation anywhere. These are
      // absence assertions, so the positive control above (the heading
      // is visible) is what stops them passing on a blank page.
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByText(/no tasks (yet|found)/i)).toHaveCount(0);
      await expect(page.getByText(/\b0 tasks\b/i)).toHaveCount(0);

      // ONB-1: the sidebar's task-bearing groups are absent — no count
      // badge renders a `0` implying a tracker exists.
      await expect(page.getByLabel("Toggle sidebar")).toHaveCount(0);
      await expect(page.getByText("Saved filters")).toHaveCount(0);
      await expect(page.getByText("Recently viewed")).toHaveCount(0);
    }

    // ONB-2 / A11Y-48: the workspace label is present as readable
    // text, and framed as where the tracker will be created.
    const label = path.basename(t.root);
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/will create its/i)).toBeVisible();
  } finally {
    await t.stop();
  }
});

// @verifies ONB-3
// @verifies ONB-4
// @verifies ONB-5
test("the form collects name and prefix, previews the first key, and names the default user", async ({ page }) => {
  const t = await bootUninitialized({ env: { USER: "ken" } });
  try {
    await page.goto(`${t.baseURL}/list`);

    // ONB-3: both fields present, labelled in the CLI's vocabulary.
    await expect(page.getByLabel("Project name")).toBeVisible();
    const prefix = page.getByLabel("Key prefix");
    await expect(prefix).toBeVisible();
    // The CLI's default is `T-`, and the preview shows the first key.
    await expect(prefix).toHaveValue("T-");
    await expect(page.getByText("T-1")).toBeVisible();

    // The preview is live, not a static string.
    await prefix.fill("WEB-");
    await expect(page.getByText("WEB-1")).toBeVisible();

    // ONB-3: typing a project name does not overwrite a hand-edited
    // prefix. This is the bullet a name→prefix autofill would break.
    //
    // The name is deliberately unrelated to the prefix. "Website" was
    // used here first and made the assertion vacuous: the obvious
    // autofill (first three letters, upper-cased) derives "WEB-" from
    // it, which is exactly the value being asserted — so the test
    // passed with the autofill in place. Measured, not reasoned: the
    // mutation was applied and all 15 specs stayed green.
    await page.getByLabel("Project name").fill("Customer Portal");
    await expect(prefix).toHaveValue("WEB-");

    // Typing further into the name must not creep either.
    await page.getByLabel("Project name").fill("Customer Portal v2");
    await expect(prefix).toHaveValue("WEB-");

    // ONB-4: the toggle explains what it skips — the docs are named
    // and described, not just referred to.
    const docs = page.getByLabel("Skip the starter docs");
    await expect(docs).toBeVisible();
    // Default matches `loctt init`, whose docs default is on: the
    // *skip* toggle is therefore off.
    await expect(docs).not.toBeChecked();
    await expect(page.getByText(/\.loctt\/docs\//)).toBeVisible();

    // ONB-5: the auto-user note names the identity, and says where to
    // change it. No auth field anywhere — LocTT has none.
    await expect(page.getByText(/you'll be set up as/i)).toBeVisible();
    await expect(page.getByText("ken", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/settings\s*→\s*users/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByLabel(/email/i)).toHaveCount(0);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-6
// @verifies ONB-7
test("submitting writes a real tracker the CLI agrees with, and lands on the list", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");

    const submit = page.getByRole("button", { name: /set up tracker/i });
    await submit.click();

    // ONB-6: the URL is `/list`, not `/init`.
    await page.waitForURL(/\/list$/, { timeout: 15_000 });

    // ONB-6: the shell is fully populated on arrival — not still
    // showing init-time placeholders.
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();
    // The new project is in the sidebar's Projects group.
    await expect(page.getByText("Website").first()).toBeVisible();

    // ONB-7 — the far end. A redirect proves nothing about what was
    // written, so read the files. This is what a wizard that navigated
    // without creating anything would fail.
    const locttDir = path.join(t.root, ".loctt");
    await expect(stat(path.join(locttDir, "config"))).resolves.toBeTruthy();
    await expect(stat(path.join(locttDir, "state.yaml"))).resolves.toBeTruthy();
    await expect(stat(path.join(locttDir, ".schema-version"))).resolves.toBeTruthy();

    // The prefix the user typed reached disk, in both the files that
    // carry it — not a default that a layer repaired on the way.
    const workflow = await readFile(path.join(locttDir, "config", "workflow.yaml"), "utf8");
    expect(workflow).toContain("WEB-");
    const projects = await readFile(path.join(locttDir, "config", "projects.yaml"), "utf8");
    expect(projects).toContain("WEB-");
    expect(projects).toContain("Website");
    const state = await readFile(path.join(locttDir, "state.yaml"), "utf8");
    expect(state).toContain("WEB-");

    // ONB-7: `loctt info` reports the prefix and next key the preview
    // promised — the CLI and the UI agree about the same tracker.
    const info = await t.cli(["info"]);
    expect(info).toContain("WEB-1");
  } finally {
    await t.stop();
  }
});

// @verifies ONB-6
test("the submit control enters a busy state and is not double-submittable", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    // Count the POSTs. The assertion is about how many inits were
    // *requested*, which a disabled-attribute check cannot see.
    let posts = 0;
    page.on("request", req => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/init") posts += 1;
    });

    // Hold the response open so the busy state is observable at all.
    await page.route("**/api/init", async route => {
      await new Promise(r => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");
    // Located by role+type, not by its label: the label is *part of*
    // the busy state ("Set up tracker" → "Setting up…"), so a
    // name-matched locator stops resolving the moment the assertion
    // becomes meaningful.
    const submit = page.locator('button[type="submit"]');
    await submit.click();

    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/setting up/i);
    // Clicking again while busy must not queue a second init.
    await submit.click({ force: true, timeout: 2000 }).catch(() => undefined);

    await page.waitForURL(/\/list$/, { timeout: 20_000 });
    expect(posts, "POST /api/init was sent more than once").toBe(1);
  } finally {
    await t.stop();
  }
});

// ---------------------------------------------------------------
// B. Edge cases
// ---------------------------------------------------------------

// @verifies ONB-15
test("a deep link into an uninitialized tracker shows the wizard, not a task-not-found", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.goto(`${t.baseURL}/tasks/T-4`);
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toBeVisible();
    await page.waitForURL(/\/init$/, { timeout: 10_000 });
    // The screen must not claim the task does not exist — that would
    // be a false statement about data.
    await expect(page.getByText(/not found/i)).toHaveCount(0);
    await expect(page.getByText(/doesn't exist|does not exist/i)).toHaveCount(0);

    // After init the user lands on `/list`; the deep link is not
    // pretended to be restorable, because T-4 cannot exist yet.
    await fillWizard(page, "Tasks", "T-");
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForURL(/\/list$/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/list");
  } finally {
    await t.stop();
  }
});

// @verifies ONB-16
test("an empty .loctt/ is treated as uninitialized, with copy that accounts for the folder", async ({ page }) => {
  const t = await bootUninitialized({ emptyLocttDir: true });
  try {
    await page.goto(`${t.baseURL}/list`);

    // Routes to the wizard, not to a crash and not to a schema banner.
    // The banner is the specific wrong answer here: before this ticket
    // an empty `.loctt/` failed the schema guard, so every route
    // including `/api/info` answered 409 and the user was told their
    // tracker was unrecognized.
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toBeVisible();
    await expect(page.getByText(/schema/i)).toHaveCount(0);
    await expect(page.getByText(/loctt migrate/i)).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/\b0 tasks\b/i)).toHaveCount(0);

    // The copy does not promise to *create* a folder that is already
    // there, and says what will happen to it instead.
    await expect(page.getByText(/already\s+exists/i)).toBeVisible();
    await expect(page.getByText(/nothing in it to overwrite/i)).toBeVisible();
    await expect(page.getByText(/will create its/i)).toHaveCount(0);

    // And it still initializes *into* that directory — the button the
    // wizard offers has to actually work. Before this ticket core
    // refused an existing `.loctt/` outright, so this screen rendered
    // and then failed with "exists but is incomplete".
    await fillWizard(page, "Website", "WEB-");
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForURL(/\/list$/, { timeout: 15_000 });

    // The far end: real files, carrying the values the user typed —
    // not defaults that a repair path substituted on the way.
    const locttDir = path.join(t.root, ".loctt");
    await expect(stat(path.join(locttDir, "state.yaml"))).resolves.toBeTruthy();
    await expect(stat(path.join(locttDir, ".schema-version"))).resolves.toBeTruthy();
    const projects = await readFile(path.join(locttDir, "config", "projects.yaml"), "utf8");
    expect(projects).toContain("WEB-");
    expect(projects).toContain("Website");
    expect(await readFile(path.join(locttDir, "state.yaml"), "utf8")).toContain("WEB-");
  } finally {
    await t.stop();
  }
});

// @verifies ONB-17
test("a second init against the same tracker moves forward rather than reporting breakage", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");

    // Simulate the losing tab: init the tracker out from under the
    // page, then submit. This is the state the second tab is in when
    // the first one wins — the tracker exists and its own POST will
    // be refused.
    await t.cli(["init", "--prefix", "WEB-", "--project-label", "Website"]);

    await page.getByRole("button", { name: /set up tracker/i }).click();

    // A definite outcome: forward to the list, not a hang and not a
    // generic failure implying the tracker is broken.
    await page.waitForURL(/\/list$/, { timeout: 15_000 });
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();

    // Exactly one project and one key counter — no duplicate, no
    // doubled counter.
    const projects = await readFile(
      path.join(t.root, ".loctt", "config", "projects.yaml"), "utf8",
    );
    expect(projects.match(/^\s*-\s+id:/gm)?.length ?? 0).toBe(1);
    const info = await t.cli(["info"]);
    expect(info).toContain("WEB-1");
  } finally {
    await t.stop();
  }
});

// @verifies ONB-19
// @verifies ONB-20
test("invalid prefix and empty name are rejected in-field, with the rule stated", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    let posts = 0;
    page.on("request", req => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/init") posts += 1;
    });

    await page.goto(`${t.baseURL}/list`);
    const prefix = page.getByLabel("Key prefix");

    // ONB-19: fires on blur, not only on submit.
    await prefix.fill("we b/x");
    await prefix.blur();
    // The message states the actual rule, not "invalid input".
    await expect(page.getByText(/cannot contain/i)).toBeVisible();
    await expect(page.getByText(/trailing - is conventional/i)).toBeVisible();
    await expect(page.getByText(/invalid input/i)).toHaveCount(0);
    // The key preview does not promise a key that cannot be allocated.
    await expect(page.getByText("we b/x1")).toHaveCount(0);
    await expect(page.getByText(/no key preview/i)).toBeVisible();

    // Submitting anyway does not send the request.
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForTimeout(500);
    expect(posts, "a blocked submit still sent POST /api/init").toBe(0);
    expect(new URL(page.url()).pathname).toBe("/init");

    // ONB-20: an empty name is a named required-field error, and
    // focus moves to the first invalid field.
    await prefix.fill("T-");
    await page.getByLabel("Project name").fill("");
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await expect(page.getByText(/enter a project name/i)).toBeVisible();
    await expect(page.getByLabel("Project name")).toBeFocused();
    expect(posts).toBe(0);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-21
test("$USER unset still names a real user, and init creates one with a non-empty name", async ({ page }) => {
  // `env` replaces the variable rather than adding one: the wizard's
  // note and the user core creates must both fall back.
  const t = await bootUninitialized({ env: { USER: "", USERNAME: "" } });
  try {
    await page.goto(`${t.baseURL}/list`);

    // The note renders a real name — never empty, never `undefined`.
    const note = page.getByText(/you'll be set up as/i);
    await expect(note).toBeVisible();
    await expect(note).not.toContainText("undefined");
    await expect(note).toContainText(/\bas\s+\S+/);
    await expect(page.getByText(/settings\s*→\s*users/i)).toBeVisible();

    await fillWizard(page, "Tasks", "T-");
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForURL(/\/list$/, { timeout: 15_000 });

    // After init the created user has a non-empty display name, and
    // the header shows it rather than an empty string.
    const users = await t.cli(["user", "list"]);
    expect(users.trim().length).toBeGreaterThan(0);
    expect(users).not.toContain("undefined");
  } finally {
    await t.stop();
  }
});

// @verifies ONB-22
test("a 200-character project name does not widen the form or scroll the page sideways", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.goto(`${t.baseURL}/list`);
    const long = "L".repeat(200);
    await fillWizard(page, long, "T-");

    // The page does not scroll horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, "the page scrolls horizontally with a 200-char name").toBe(false);

    // The key preview stays on-screen and readable.
    const preview = page.getByText("T-1");
    await expect(preview).toBeVisible();
    const box = await preview.boundingBox();
    const width = page.viewportSize()?.width ?? 1280;
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-27
// @verifies ONB-35
test("/init on an initialized tracker redirects to the list instead of offering a second init", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForURL(/\/list$/, { timeout: 15_000 });

    // ONB-27: Back does not return to a stale wizard.
    await page.goBack();
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toHaveCount(0);

    // ONB-35 / ONB-27: `/init` by URL on a working tracker redirects.
    await page.goto(`${t.baseURL}/init`);
    await page.waitForURL(/\/list$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /set up tracker/i })).toHaveCount(0);

    // And the existing tracker was not clobbered: still one project,
    // still the prefix from the first init.
    const projects = await readFile(
      path.join(t.root, ".loctt", "config", "projects.yaml"), "utf8",
    );
    expect(projects).toContain("Website");
    expect(projects.match(/^\s*-\s+id:/gm)?.length ?? 0).toBe(1);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-28
test("a slow init keeps the form disabled and explains what is happening", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.route("**/api/init", async route => {
      await new Promise(r => setTimeout(r, 4000));
      await route.continue();
    });

    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");
    await page.getByRole("button", { name: /set up tracker/i }).click();

    // The busy state persists and the form stays visibly disabled.
    await expect(page.getByRole("button", { name: /setting up/i })).toBeDisabled();
    await expect(page.getByLabel("Project name")).toBeDisabled();
    await expect(page.getByLabel("Key prefix")).toBeDisabled();

    // After a few seconds it says what work is in progress, rather
    // than sitting on an unexplained spinner.
    await expect(page.getByText(/creating directories/i)).toBeVisible({ timeout: 6000 });

    await page.waitForURL(/\/list$/, { timeout: 20_000 });
  } finally {
    await t.stop();
  }
});

// ---------------------------------------------------------------
// C. Error cases
// ---------------------------------------------------------------

// @verifies ONB-30
test("a failing init shows the error on the wizard, keeps the typed values, and retries in place", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    // Fail the first init the way a permission error does, then let
    // the retry through. Routing the failure rather than chmod-ing
    // the directory keeps the test able to run as root in CI, where
    // a read-only directory is still writable.
    let failed = false;
    await page.route("**/api/init", async route => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "rejected_write",
            error: "Could not create .loctt: the directory is not writable.",
            message: "Could not create .loctt: the directory is not writable.",
            data_state: "not_saved",
            recovery: { kind: "retry" },
            detail: "EACCES: permission denied",
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");
    await page.getByRole("button", { name: /set up tracker/i }).click();

    // The error appears on the init screen — not as a toast that
    // disappears, and not by navigating away.
    await expect(page.getByText(/not writable/i)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/init");
    // It says the change did not land, so the user knows where they
    // stand before retrying.
    await expect(page.getByText(/was not saved/i)).toBeVisible();

    // The form retained what the user typed.
    await expect(page.getByLabel("Project name")).toHaveValue("Website");
    await expect(page.getByLabel("Key prefix")).toHaveValue("WEB-");

    // A retry re-attempts without a full page reload.
    let reloaded = false;
    page.on("load", () => { reloaded = true; });
    await page.getByRole("button", { name: /^retry$/i }).click();
    await page.getByRole("button", { name: /set up tracker/i }).click();
    await page.waitForURL(/\/list$/, { timeout: 15_000 });
    expect(reloaded, "retry caused a full page reload").toBe(false);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-31
test("an init that fails partway does not claim success and re-reads /api/info on reload", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    let infoReads = 0;
    page.on("request", req => {
      if (new URL(req.url()).pathname === "/api/info") infoReads += 1;
    });

    await page.route("**/api/init", async route => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal",
          error: ".loctt may exist partially and is not usable as-is.",
          message: ".loctt may exist partially and is not usable as-is.",
          data_state: "unknown",
          recovery: { kind: "command", command: "loctt init" },
          detail: "server died mid-init",
        }),
      });
    });

    await page.goto(`${t.baseURL}/list`);
    await fillWizard(page, "Website", "WEB-");
    await page.getByRole("button", { name: /set up tracker/i }).click();

    // The state of the data is stated, and a concrete next action given.
    await expect(page.getByText(/not usable as-is/i)).toBeVisible();
    await expect(page.getByText(/loctt init/)).toBeVisible();

    // It did not navigate to `/list` and did not claim success.
    expect(new URL(page.url()).pathname).toBe("/init");
    await expect(page.getByLabel("Toggle sidebar")).toHaveCount(0);

    // Reloading re-evaluates `/api/info` rather than trusting a cached
    // "initialized" flag from the failed attempt.
    const before = infoReads;
    await page.reload();
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toBeVisible();
    expect(infoReads, "reload did not re-read /api/info").toBeGreaterThan(before);
  } finally {
    await t.stop();
  }
});

// @verifies ONB-32
test("a failing /api/info shows a server error, not the init wizard", async ({ page }) => {
  const t = await bootUninitialized();
  try {
    await page.route("**/api/info", async route => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal",
          error: "Could not read tracker info.",
          message: "Could not read tracker info.",
          recovery: { kind: "retry" },
        }),
      });
    });

    await page.goto(`${t.baseURL}/list`);

    // The load-bearing assertion: offering to initialize a tracker
    // that may well exist would be actively wrong.
    await expect(page.getByRole("heading", { name: /no tracker in this directory/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /set up tracker/i })).toHaveCount(0);
    // Positive control — the page said *something*, so the absence
    // assertions above are not passing on a blank render.
    await expect(page.getByText(/could not read tracker info|unreachable|try again|retry/i).first())
      .toBeVisible();
  } finally {
    await t.stop();
  }
});

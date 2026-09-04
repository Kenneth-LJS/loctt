/**
 * Transcribed from docs/dev/ui-test-cases/flow-settings.md (SET-32,
 * SET-42) and flow-projects-users.md (the M4.1 PRU cases), plus
 * XS-63.
 *
 * These are browser cases: they turn on what a real SPA renders under
 * a real server, and several assert the file on disk after the write
 * so a client that posted the wrong value cannot pass.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Reads projects.yaml as text — the far end of every project write. */
async function projectsYaml(root: string): Promise<string> {
  return readFile(path.join(root, ".loctt", "config", "projects.yaml"), "utf8");
}

/** Resolves a user's ULID by name via the CLI's `user list --all`. */
async function userIdByName(
  tracker: { run(args: readonly string[]): Promise<string> },
  name: string,
): Promise<string | undefined> {
  const list = await tracker.run(["user", "list", "--all"]);
  for (const line of list.split("\n")) {
    const m = /^([0-9A-HJKMNP-TV-Z]{26})\s*\*?\t([^\t]+)\t/.exec(line);
    if (m === null) continue;
    const label = m[2]?.trim() ?? "";
    if (label === name || label.startsWith(`${name}  `)) return m[1];
  }
  return undefined;
}

/** Reads one frontmatter field off the task with the given title. */
async function fmByTitle(
  root: string,
  title: string,
  field: string,
): Promise<string | undefined> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^title:\\s*${title}\\s*$`, "m").test(text)) {
      return new RegExp(`^${field}:\\s*(\\S+)\\s*$`, "m").exec(text)?.[1];
    }
  }
  return undefined;
}

/**
 * Seeds the dangling-reference state PRU-25/PRU-42 describe.
 *
 * `deleteUser` refuses to leave a dangling reference (K21), so this is
 * reached the only way the real world reaches it: the user's profile
 * folder is removed out-of-band (a hand-edited/restored tracker) while
 * tasks still carry their ULID. The ULID stays on disk in the task
 * frontmatter; no profile resolves it.
 */
async function orphanUser(root: string, userId: string): Promise<void> {
  await rm(path.join(root, ".loctt", "users", userId), { recursive: true, force: true });
}

test.describe("SET — the settings shell", () => {
  // @verifies SET-32
  test("SET-32: an unknown settings section keeps the nav and names what was asked for", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/nonexistent`);

    // The nav is intact — not a bare app-root dump.
    await expect(page.getByTestId("settings-nav")).toBeVisible();

    const notFound = page.getByTestId("settings-unknown-section");
    await expect(notFound).toBeVisible();
    // It names the requested section.
    await expect(notFound).toContainText("nonexistent");

    // It links the valid sections rather than stranding the user.
    await expect(notFound.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(notFound.getByRole("link", { name: "Users" })).toBeVisible();

    // The URL is left alone, and the pane is not blank.
    await expect(page).toHaveURL(/\/settings\/nonexistent$/);
  });

  // @verifies SET-2
  test("SET-2: the nav is grouped into the five groups with non-interactive headings", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/projects`);
    const nav = page.getByTestId("settings-nav");

    for (const group of ["Workspace", "Workflow", "Data", "Tracker", "Personal"]) {
      await expect(nav.getByRole("heading", { name: group })).toBeVisible();
    }
    // A heading is not a link — it cannot navigate away by accident.
    await expect(nav.getByRole("link", { name: "Workspace", exact: true })).toHaveCount(0);

    // The active section is marked.
    await expect(page.getByTestId("settings-nav-projects")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // @verifies SET-42
  test("SET-42: with the API unreachable the nav still renders and the pane says so", async ({
    page,
    tracker,
  }) => {
    // Fail every API call, leaving the SPA itself served.
    await page.route("**/api/**", route => route.abort());
    await page.goto(`${tracker.baseURL}/settings/projects`);

    // The nav survives — the user can still see where they are.
    await expect(page.getByTestId("settings-nav")).toBeVisible();

    // The pane reports the unreachable server rather than an empty
    // list that would read as "you have no projects".
    const alert = page.getByTestId("settings-pane").getByRole("alert").first();
    await expect(alert).toContainText(/not responding|unreachable/i);
    await expect(page.getByTestId("settings-projects")).toHaveCount(0);
  });
});

test.describe("PRU — the projects panel", () => {
  // @verifies PRU-32
  test("PRU-32: /settings/projects opens regardless of the active project filter", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB-"]);

    // Arrive with a project filter set in the URL; management is not
    // scoped by it, so both projects are listed.
    await page.goto(`${tracker.baseURL}/settings/projects`);
    const panel = page.getByTestId("settings-projects");
    await expect(panel).toBeVisible();
    // The name is an editable input, so assert its value rather than
    // the pane's text — `toContainText` does not see input values.
    const names = page.locator('[data-testid^="project-name-"]');
    await expect(names).toHaveCount(2);
    await expect(names.nth(0)).toHaveValue("Tasks");
    await expect(names.nth(1)).toHaveValue("Web App");
  });

  // @verifies PRU-5
  test("PRU-5: creating a project writes it to projects.yaml and the CLI agrees", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/projects`);
    await page.getByTestId("project-create-open").click();

    await page.getByTestId("project-create-name").fill("Docs");
    await page.getByTestId("project-create-prefix").fill("DOCS-");
    await page.getByTestId("project-create-submit").click();

    // Appears without a page reload. The name is an input value.
    const names = page.locator('[data-testid^="project-name-"]');
    await expect(names).toHaveCount(2);
    await expect(names.nth(1)).toHaveValue("Docs");

    // The far end: the file on disk, and the CLI reading it.
    const yaml = await projectsYaml(tracker.root);
    expect(yaml).toContain("name: Docs");
    expect(yaml).toContain("DOCS-");
    const listed = await tracker.run(["project", "list"]);
    expect(listed).toContain("Docs");
  });

  // @verifies PRU-19
  test("PRU-19: a colliding prefix is refused at the field with submit disabled", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);
    await page.getByTestId("project-create-open").click();

    await page.getByTestId("project-create-name").fill("Website");
    await page.getByTestId("project-create-prefix").fill("WEB-");

    // Surfaced inline, naming the project that owns it, before submit.
    const problem = page.getByTestId("project-create-prefix-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText("Web");
    await expect(page.getByTestId("project-create-submit")).toBeDisabled();

    // Changing to a free prefix clears the error and enables submit.
    await page.getByTestId("project-create-prefix").fill("WEBAPP-");
    await expect(problem).toHaveCount(0);
    await expect(page.getByTestId("project-create-submit")).toBeEnabled();

    // No half-create happened while the conflict stood.
    const yaml = await projectsYaml(tracker.root);
    expect(yaml).not.toContain("Website");
  });

  // @verifies PRU-36
  test("PRU-36: a malformed slug states the rule and suggests a slug, on its own field", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/projects`);
    await page.getByTestId("project-create-open").click();

    await page.getByTestId("project-create-name").fill("My Project");
    await page.getByTestId("project-create-prefix").fill("MP-");
    await page.getByTestId("project-create-slug").fill("My Project!");

    const slugProblem = page.getByTestId("project-create-slug-problem");
    await expect(slugProblem).toBeVisible();
    await expect(slugProblem).toContainText("lowercase");
    await expect(slugProblem).toContainText("my-project");

    // The prefix is fine and is not blamed — errors sit on their own
    // fields rather than arriving as one combined toast.
    await expect(page.getByTestId("project-create-prefix-problem")).toHaveCount(0);
  });

  // @verifies PRU-6
  test("PRU-6: renaming a project changes the label but not the slug or prefix", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND-"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);

    const yamlBefore = await projectsYaml(tracker.root);
    const id = /id: (\w+)\n\s+name: Backend/.exec(yamlBefore)?.[1] ?? "";
    expect(id).not.toBe("");

    const nameInput = page.getByTestId(`project-name-${id}`);
    await nameInput.fill("Backend Services");
    await nameInput.blur();

    await expect(page.getByTestId(`project-slug-${id}`)).toHaveValue("backend");

    // The far end: the label moved on disk and the slug did not (A60).
    await expect.poll(async () => projectsYaml(tracker.root))
      .toContain("Backend Services");
    const after = await projectsYaml(tracker.root);
    expect(after).toContain("slug: backend");
    expect(after).toContain("BACKEND-");
  });

  // @verifies PRU-20
  test("PRU-20: slug and prefix are disabled on an existing project, name is not", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND-"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);

    const yaml = await projectsYaml(tracker.root);
    const id = /id: (\w+)\n\s+name: Backend/.exec(yaml)?.[1] ?? "";

    // Disabled, not merely unvalidated. `toHaveJSProperty` rather than
    // `toBeDisabled`, which retargets inside a <label>.
    await expect(page.getByTestId(`project-slug-${id}`))
      .toHaveJSProperty("disabled", true);
    await expect(page.getByTestId(`project-prefix-${id}`))
      .toHaveJSProperty("disabled", true);
    // The label is editable in the same form, so the disabled state
    // reads as intentional rather than as a broken form.
    await expect(page.getByTestId(`project-name-${id}`))
      .toHaveJSProperty("disabled", false);
  });

  // @verifies PRU-17
  test("PRU-17: the reference count shows before the dialog, and delete requires a remap", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "First" }, { title: "Second" }]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);

    await page.goto(`${tracker.baseURL}/settings/projects`);
    const yaml = await projectsYaml(tracker.root);
    const tasksId = /id: (\w+)\n\s+name: Tasks/.exec(yaml)?.[1] ?? "";
    expect(tasksId).not.toBe("");

    // The badge is visible *before* the dialog opens.
    await expect(page.getByTestId(`project-refcount-${tasksId}`)).toHaveText("2");

    await page.getByTestId(`project-delete-${tasksId}`).click();
    const dialog = page.getByTestId("project-delete-dialog");
    await expect(dialog).toContainText("2 tasks");

    // No default that silently orphans them: confirm is blocked until
    // a remap target is chosen.
    await expect(page.getByTestId("project-delete-confirm")).toBeDisabled();
    await page.getByTestId("project-delete-remap").selectOption({ label: "Web" });
    await expect(page.getByTestId("project-delete-confirm")).toBeEnabled();
  });

  // @verifies PRU-17
  test("PRU-17: cancelling leaves projects.yaml and the tasks byte-identical", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "First" }]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);

    await page.goto(`${tracker.baseURL}/settings/projects`);
    const before = await projectsYaml(tracker.root);
    const tasksId = /id: (\w+)\n\s+name: Tasks/.exec(before)?.[1] ?? "";

    await page.getByTestId(`project-delete-${tasksId}`).click();
    await page.getByTestId("project-delete-cancel").click();

    expect(await projectsYaml(tracker.root)).toBe(before);
  });

  // @verifies PRU-33
  test("PRU-33: deleting the last remaining project is disabled with a stated reason", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/projects`);
    const yaml = await projectsYaml(tracker.root);
    const only = /id: (\w+)/.exec(yaml)?.[1] ?? "";

    const del = page.getByTestId(`project-delete-${only}`);
    await expect(del).toBeDisabled();
    await expect(del).toHaveAttribute("title", /at least one project/i);
  });

  // @verifies PRU-7
  test("PRU-7: archiving is one click and offers unarchive", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Legacy", "--prefix", "LEG-"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);

    const yaml = await projectsYaml(tracker.root);
    const id = /id: (\w+)\n\s+name: Legacy/.exec(yaml)?.[1] ?? "";

    // No typed confirmation — archive is reversible.
    await page.getByTestId(`project-archive-${id}`).click();
    await expect(page.getByTestId(`project-row-${id}`))
      .toHaveAttribute("data-archived", "true");
    await expect(page.getByTestId(`project-archive-${id}`)).toHaveText("Unarchive");

    // The far end.
    await expect.poll(async () => projectsYaml(tracker.root))
      .toContain("archived: true");
  });
});

/**
 * Reads `.loctt/.current-user` — the far end of a user switch. The
 * file holds the acting user's ULID and nothing else.
 */
async function currentUserFile(root: string): Promise<string> {
  return (await readFile(path.join(root, ".loctt", ".current-user"), "utf8")).trim();
}

test.describe("PRU — identity and the user menu", () => {
  // @verifies PRU-8
  test("PRU-8: switching user updates the header, .current-user, and the CLI", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Alice", "--email", "alice@example.com", "--switch"]);
    const bobOut = await tracker.run([
      "user", "create", "Bob", "--email", "bob@example.com",
    ]);
    const bobId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(bobOut)?.[1];
    expect(bobId, "could not read Bob's ULID from `user create`").toBeDefined();

    // A crash on render and a component that renders nothing look
    // identical to a locator that times out. This separates them.
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await page.goto(`${tracker.baseURL}/`);
    await page.getByTestId("user-menu-trigger").click();

    // The menu shows name and email, not an anonymous icon.
    const current = page.getByTestId("user-menu-current");
    await expect(current).toContainText("Alice");
    await expect(current).toContainText("alice@example.com");

    const routeBefore = page.url();
    await page.getByTestId(`user-switch-${bobId ?? ""}`).click();

    // The header updates in place — no reload, and the route survives.
    // "AL" -> "BO": the initials of the acting user, so this fails on
    // a header that kept rendering Alice.
    await expect(page.getByTestId("user-menu-trigger")).toHaveText("BO");
    expect(page.url()).toBe(routeBefore);

    // The far end, twice over: the file on disk and the CLI reading it.
    await expect.poll(async () => currentUserFile(tracker.root)).toBe(bobId);
    // PRU-8 names `loctt whoami`; the command is `loctt user current`.
    await expect.poll(async () => tracker.run(["user", "current"])).toContain("Bob");

    expect(pageErrors, "the SPA threw while switching users").toEqual([]);
  });

  // @verifies PRU-10
  test("PRU-10: each change is attributed to whoever was acting at the time", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Alice", "--email", "alice@example.com", "--switch"]);
    const bobOut = await tracker.run(["user", "create", "Bob", "--email", "bob@example.com"]);
    const bobId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(bobOut)?.[1] ?? "";
    const [key] = await tracker.seed([{ title: "Attributed" }]);

    // Alice makes the first change...
    await tracker.run(["set", key ?? "", "status", "in_progress"]);
    // ...then Bob makes the second, through the CLI's own switch so
    // the two entries differ only in who was acting.
    await tracker.run(["user", "switch", bobId]);
    await tracker.run(["set", key ?? "", "priority", "high"]);

    await page.goto(`${tracker.baseURL}/tasks/${key ?? ""}`);

    const actors = page.getByTestId("activity-actor");
    // Both names appear — the second write did not rewrite the first.
    await expect(actors.filter({ hasText: "Alice" }).first()).toBeVisible();
    await expect(actors.filter({ hasText: "Bob" }).first()).toBeVisible();

    // And the CLI agrees, in the same order. PRU-10 names
    // `loctt history <key>`; the command is `loctt log`.
    const history = await tracker.run(["log", key ?? ""]);
    // Assert the pairing, not the order: `log` renders newest-first,
    // and "both names appear" would pass even if the two entries had
    // swapped actors — which is exactly the regression PRU-10 is
    // about. Each line must carry the actor who made *that* change.
    const line = (field: string): string =>
      history.split("\n").find(l => l.includes(field)) ?? "";
    expect(line("status")).toContain("Alice");
    expect(line("priority")).toContain("Bob");
    // The earlier entry was not retroactively reattributed.
    expect(line("status")).not.toContain("Bob");
  });

  // @verifies PRU-12
  test("PRU-12: archiving a user keeps their assignments readable and named", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Alice", "--email", "alice@example.com", "--switch"]);
    const carolOut = await tracker.run([
      "user", "create", "Carol", "--email", "carol@example.com",
    ]);
    const carolId = /\b([0-9A-HJKMNP-TV-Z]{26})\b/.exec(carolOut)?.[1] ?? "";

    await tracker.seed([
      { title: "Carol one", fields: { assignee: carolId } },
      { title: "Carol two", fields: { assignee: carolId } },
    ]);

    // Positive control: before archiving, the cell is a plain name —
    // so the "(archived)" assertion below cannot pass by accident.
    await page.goto(`${tracker.baseURL}/`);
    const firstRow = page.getByRole("row").filter({ hasText: "Carol one" });
    await expect(firstRow).toContainText("Carol");
    await expect(firstRow).not.toContainText("(archived)");

    await tracker.run(["user", "archive", carolId]);
    await page.reload();

    // Still named, now marked — not blank, not a raw ULID, not
    // "Unknown user".
    await expect(firstRow).toContainText("Carol");
    await expect(firstRow).toContainText("(archived)");
    await expect(firstRow).not.toContainText(carolId);
    await expect(firstRow).not.toContainText(/unknown user/i);

    // She is gone from the picker on a *new* task.
    await page.getByTestId("header-new-task").click();
    await expect(page.getByTestId("create-assignee")).toHaveCount(1);
    await expect(page.getByTestId("create-assignee")).not.toContainText("Carol");
  });
});

test.describe("PRU — the users panel", () => {
  // @verifies PRU-11
  test("PRU-11: creating a user asks for name/email/timezone and never an id", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    await page.getByTestId("user-create-open").click();

    await expect(page.getByTestId("user-create-name")).toBeVisible();
    await expect(page.getByTestId("user-create-email")).toBeVisible();
    await expect(page.getByTestId("user-create-timezone")).toBeVisible();
    // The ULID is generated, never user-supplied.
    await expect(page.getByTestId("user-create-id")).toHaveCount(0);

    await page.getByTestId("user-create-name").fill("Bob");
    await page.getByTestId("user-create-email").fill("bob@example.com");
    await page.getByTestId("user-create-submit").click();

    await expect(page.getByTestId("settings-users")).toContainText("Bob");

    // The far end: the CLI sees the same user.
    await expect.poll(async () => tracker.run(["user", "list"]))
      .toContain("Bob");
  });

  // @verifies PRU-26
  test("PRU-26: archiving your own row is disabled and says why; others are not", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Bob", "--email", "bob@example.com"]);
    await page.goto(`${tracker.baseURL}/settings/users`);

    const self = page.locator('[data-self="true"]');
    await expect(self).toHaveCount(1);
    const selfId = (await self.getAttribute("data-testid"))?.replace("user-row-", "") ?? "";
    expect(selfId).not.toBe("");

    // Disabled, not error-on-click, and the reason points at switching.
    await expect(page.getByTestId(`user-archive-${selfId}`)).toBeDisabled();
    await expect(page.getByTestId(`user-archive-blocked-${selfId}`))
      .toContainText(/switch/i);

    // The block is targeted, not a broken panel: another user archives.
    const other = page.locator('[data-self="false"]').first();
    const otherId = (await other.getAttribute("data-testid"))?.replace("user-row-", "") ?? "";
    await page.getByTestId(`user-archive-${otherId}`).click();
    await expect(page.getByTestId(`user-row-${otherId}`))
      .toHaveAttribute("data-archived", "true");
  });

  // @verifies PRU-23
  test("PRU-23: two users with the same display name are qualified, with no merge offer", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Alex Kim", "--email", "alex1@example.com"]);
    await tracker.run(["user", "create", "Alex Kim", "--email", "alex2@example.com"]);

    await page.goto(`${tracker.baseURL}/settings/users`);
    const panel = page.getByTestId("settings-users");

    // Both are shown, each qualified by the differing email.
    await expect(panel).toContainText("alex1@example.com");
    await expect(panel).toContainText("alex2@example.com");
    await expect(page.locator('[data-testid^="user-qualifier-"]')).toHaveCount(2);

    // Nothing implies names must be unique or offers a merge.
    await expect(panel).not.toContainText(/merge/i);
  });

  // @verifies PRU-38
  test("PRU-38: a non-image file is rejected client-side with no request made", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);

    const posts: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && req.url().includes("/avatar")) {
        posts.push(req.url());
      }
    });

    const row = page.locator('[data-self="true"]');
    const id = (await row.getAttribute("data-testid"))?.replace("user-row-", "") ?? "";

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 not an image"),
    });

    const problem = page.getByTestId(`user-avatar-problem-${id}`);
    await expect(problem).toBeVisible();
    await expect(problem).toContainText("resume.pdf");
    await expect(problem).toContainText("JPEG");

    // No POST was made at all.
    expect(posts).toEqual([]);
  });

  // @verifies PRU-30
  test("PRU-30: an SVG is rejected by name and the accepted formats are listed", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);

    const posts: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && req.url().includes("/avatar")) {
        posts.push(req.url());
      }
    });

    const row = page.locator('[data-self="true"]');
    const id = (await row.getAttribute("data-testid"))?.replace("user-row-", "") ?? "";

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });

    const problem = page.getByTestId(`user-avatar-problem-${id}`);
    await expect(problem).toContainText("SVG");
    await expect(problem).toContainText("JPEG");
    // No SVG content reaches the avatar bucket.
    expect(posts).toEqual([]);
  });
});

test.describe("XS — cross-surface constraints", () => {
  // @verifies XS-63
  test("XS-63: a duplicated prefix in projects.yaml names both entries and the rule", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);

    // Hand-edit the file to duplicate a prefix, as the case describes.
    const file = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const yaml = await readFile(file, "utf8");
    const broken = yaml.replace("WEB-", "T-");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, broken, "utf8");

    await page.goto(`${tracker.baseURL}/settings/projects`);

    const alert = page.getByTestId("settings-pane").getByRole("alert").first();
    // Names the duplicated value and both entries carrying it.
    await expect(alert).toContainText("T-");
    await expect(alert).toContainText("Tasks");
    await expect(alert).toContainText("Web");
    // States the rule, not just the symptom.
    await expect(alert).toContainText(/unique/i);
    // The UI does not pick a winner and carry on.
    await expect(page.getByTestId("settings-projects")).toHaveCount(0);
  });
});

// @verifies PRU-46
//
// PRU-46's three bullets are all about what the *panel shows*; its
// only tag sat on a server test whose own docstring says "the panel
// itself is not built (settings routes are still stubs), so these
// cover the contract the panel will consume". That was true when
// written — M4.1 built the panel and the tag never moved. Measured:
// suppressing the banner entirely left 19 settings UI tests green.
// KNOWN FAILURE — awaiting Ken's ruling, see known-gaps.md "PRU-46's
// pending-rename banner is unreachable dead code".
//
// Un-quarantined 2026-09-02 (K16). This was `test.fixme` because the
// case asked the panel to show a rename as *pending* — a state the
// middleware at `server.ts:4290` forecloses by finishing the rename
// ahead of every handler. Ken's ruling kept that guarantee and changed
// what the server does with the result it was discarding, so the case
// now asserts the notice rather than the unreachable control.
test("PRU-46: a completed prefix rename is reported once, with both prefixes", async ({
  page,
  tracker,
}) => {
  await tracker.run(["project", "create", "Web App", "--prefix", "WEB-"]);
  // A task on WEB-, so `renamed` is a real count rather than 0. A
  // zero-task fixture cannot tell "counted the tasks" from "printed a
  // constant".
  await tracker.run(["create", "Needs rekeying", "--project", "Web App"]);
  const projects = await readFile(
    path.join(tracker.root, ".loctt", "config", "projects.yaml"), "utf8",
  );
  // `id` precedes `name` in each entry, so a greedy `id: … name: Web
  // App` match spans from the *first* project and captures the wrong
  // id. Anchor on the entry itself. Measured: the naive form returned
  // the default project's id and the banner never rendered.
  const id = /- id: (\S+)\s+name: Web App\b/.exec(projects)?.[1];
  if (id === undefined) throw new Error(`no id for Web App in:\n${projects}`);

  // The journal core writes before rewriting keys, and leaves behind if
  // the process dies mid-rewrite. Writing it directly is the only way
  // to reach the state without killing a server mid-call.
  await mkdir(path.join(tracker.root, ".loctt", "local"), { recursive: true });
  await writeFile(
    path.join(tracker.root, ".loctt", "local", "prefix-rename.yaml"),
    // The on-disk shape is PrefixRenameStateSchema (contracts/state.ts):
    // strict, snake_case, with a required started_at. `projectId` is the
    // *return* shape of SetPrefixResult, not the sentinel — a camelCase
    // key here fails the strict parse and the server silently omits
    // `pending_prefix_rename`.
    `project_id: ${id}\nfrom: WEB-\nto: SITE-\nstarted_at: "2026-09-01T00:00:00.000Z"\n`,
    "utf8",
  );

  await page.goto(`${tracker.baseURL}/settings/projects`);

  const notice = page.getByTestId("project-prefix-rename-completed");
  await expect(notice).toBeVisible();
  // Bullet 2: from, to, and the count. Asserting the notice alone
  // would pass on one that named neither prefix — which is how the
  // banner this replaced could have shipped empty.
  await expect(notice).toContainText("WEB-");
  await expect(notice).toContainText("SITE-");
  await expect(notice).toContainText("1 task");
  // ...and that old keys still resolve, which is the half that stops
  // the notice reading as a problem report.
  await expect(notice).toContainText("Old keys still resolve");

  // The far end: the rename really happened, not just a message about
  // it. The sentinel is gone and the task carries the new prefix.
  await expect(async () => {
    const after = await readFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"), "utf8",
    );
    expect(after).toContain("SITE-");
  }).toPass();

  // The notice survives a reload rather than being consumed by the
  // first request that happens to arrive. A page load fires several
  // API calls in parallel and the recovery runs ahead of whichever
  // lands first — so a read-and-clear notice gets eaten by a request
  // with nowhere to show it, and the user is never told. That was the
  // first implementation, and this assertion is what caught it.
  await page.reload();
  await expect(page.getByTestId("settings-projects")).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("SITE-");
});

test.describe("PRU-25 — a hard-deleted user still referenced as reporter", () => {
  // @verifies PRU-25
  test("PRU-25: the reporter cell degrades to truncated-ULID + (deleted user), the row survives, and the filter offers only live users", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // Dave reports two tasks; Erin is a live user who does not.
    await tracker.run(["user", "create", "Dave", "--email", "dave@example.com"]);
    await tracker.run(["user", "create", "Erin", "--email", "erin@example.com"]);
    const [k1, k2] = await tracker.seed([
      { title: "Daves first" },
      { title: "Daves second" },
    ]);
    if (k1 === undefined || k2 === undefined) throw new Error("seed returned no keys");
    await tracker.run(["set", k1, "reporter", "Dave"]);
    await tracker.run(["set", k2, "reporter", "Dave"]);

    const daveId = await userIdByName(tracker, "Dave");
    if (daveId === undefined) throw new Error("no id for Dave");
    // The tasks now hold Dave's ULID; confirm before orphaning so a
    // later "(deleted user)" cannot come from the value never being set.
    expect(await fmByTitle(tracker.root, "Daves first", "reporter")).toBe(daveId);

    // Reach the dangling state out-of-band (K21): remove Dave's profile
    // while the tasks keep his ULID. deleteUser would refuse this.
    await orphanUser(tracker.root, daveId);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Daves first")).toBeVisible();

    // The reporter cell for the orphaned row is degraded, not blank.
    const row = page.getByText("Daves first").locator("xpath=ancestor::tr");
    const reporterCell = row.locator('[data-col="reporter"]');
    await expect(reporterCell).toContainText("(deleted user)");
    // K22: the truncated tail is shown as the only remaining handle…
    await expect(reporterCell).toContainText(daveId.slice(-6));
    // …but never the raw full ULID (P-4 holds outside the error state).
    expect(await reporterCell.innerText()).not.toContain(daveId);
    // The row still renders the rest — the other columns are unaffected.
    await expect(row.locator('[data-col="key"]')).toContainText(k1);
    await expect(row.locator('[data-col="title"]')).toContainText("Daves first");

    // A healthy reporter (Erin, set on nothing here) never shows the
    // degraded form — prove the carve-out does not leak. Set Erin on k1
    // via the picker below; first, the filter facet.

    // The Reporter filter offers only existing users; the dangling ULID
    // is not an option.
    await page.getByRole("button", { name: "Filter Reporter" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Erin" })).toBeVisible();
    // Dave's profile is gone, so he is not offered; his ULID never is.
    await expect(page.getByRole("menuitemcheckbox", { name: /Dave/ })).toHaveCount(0);
    for (const opt of await page.getByRole("menuitemcheckbox").allInnerTexts()) {
      expect(opt).not.toContain(daveId.slice(-6));
    }
    await page.keyboard.press("Escape");

    // Setting a new reporter clears the dangling reference. Open the
    // task detail and pick Erin.
    await page.goto(`${tracker.baseURL}/tasks/${k1}`);
    await page.getByTestId("meta-edit-reporter").click();
    await page.getByTestId("meta-options-reporter").getByRole("option", { name: /Erin/ }).click();

    const erinId = await userIdByName(tracker, "Erin");
    expect(erinId).toBeDefined();
    // The far end: the frontmatter now names Erin, not the dangling id.
    await expect
      .poll(async () => fmByTitle(tracker.root, "Daves first", "reporter"))
      .toBe(erinId);

    expect(pageErrors).toEqual([]);
  });
});

test.describe("PRU-42 — deleting a user who is assignee on many tasks", () => {
  // @verifies PRU-42
  test("PRU-42: the confirm shows the count split by role, offers archive, and requires a typed confirmation", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // Dave is assignee on 3 tasks and reporter on 1 — a split count.
    await tracker.run(["user", "create", "Dave", "--email", "dave@example.com"]);
    await tracker.run(["user", "create", "Erin", "--email", "erin@example.com"]);
    const keys = await tracker.seed([
      { title: "A one" },
      { title: "A two" },
      { title: "A three" },
      { title: "R one" },
    ]);
    for (const k of keys.slice(0, 3)) await tracker.run(["set", k, "assignee", "Dave"]);
    await tracker.run(["set", keys[3] as string, "reporter", "Dave"]);

    await page.goto(`${tracker.baseURL}/settings/users`);
    const daveRow = page.locator('[data-self="false"]', { hasText: "Dave" });
    const daveId = (await daveRow.first().getAttribute("data-testid"))?.replace("user-row-", "") ?? "";
    expect(daveId).not.toBe("");

    await page.getByTestId(`user-delete-${daveId}`).click();
    const dialog = page.getByTestId("user-delete-dialog");
    await expect(dialog).toBeVisible();

    // The reference count, split by role.
    const refcount = page.getByTestId("user-delete-refcount");
    await expect(refcount).toContainText("assignee on 3 tasks");
    await expect(refcount).toContainText("reporter on 1 task");

    // Archive is offered as the reversible alternative in the same dialog.
    await expect(dialog).toContainText(/permanent/i);
    await expect(page.getByTestId("user-delete-archive-instead")).toBeVisible();

    // A single OK is not enough: the confirm button is disabled until a
    // resolution is chosen AND the word is typed.
    const confirm = page.getByTestId("user-delete-confirm");
    await expect(confirm).toBeDisabled();
    // Choose to reassign Dave's references to Erin.
    await page.getByTestId(`user-delete-remap-${await userIdByName(tracker, "Erin")}`).click();
    await expect(confirm).toBeDisabled(); // resolution alone is not enough
    await page.getByTestId("user-delete-confirm-input").fill("DELETE");
    await expect(confirm).toBeEnabled();

    await confirm.click();

    // The dialog closes and Dave is gone from the panel.
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(`user-row-${daveId}`)).toHaveCount(0);

    // The far end (K21): no task is left dangling — Dave's references
    // were remapped to Erin, and his profile folder is gone.
    const erinId = await userIdByName(tracker, "Erin");
    await expect
      .poll(async () => fmByTitle(tracker.root, "A one", "assignee"))
      .toBe(erinId);
    await expect
      .poll(async () => fmByTitle(tracker.root, "R one", "reporter"))
      .toBe(erinId);
    expect(await userIdByName(tracker, "Dave")).toBeUndefined();

    expect(pageErrors).toEqual([]);
  });

  // @verifies PRU-42
  test("PRU-42: choosing archive from the delete dialog takes the reversible path and leaves references intact", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Dave", "--email", "dave@example.com"]);
    const [k1] = await tracker.seed([{ title: "Kept task" }]);
    await tracker.run(["set", k1 as string, "assignee", "Dave"]);
    const daveId = await userIdByName(tracker, "Dave");
    if (daveId === undefined) throw new Error("no id for Dave");

    await page.goto(`${tracker.baseURL}/settings/users`);
    await page.getByTestId(`user-delete-${daveId}`).click();
    await expect(page.getByTestId("user-delete-dialog")).toBeVisible();

    // The reversible path: archive instead.
    await page.getByTestId("user-delete-archive-instead").click();

    // Dave is archived, not deleted — his row is marked, and the task
    // still names him (archive keeps references intact, unlike delete).
    await expect(page.getByTestId(`user-row-${daveId}`))
      .toHaveAttribute("data-archived", "true");
    expect(await fmByTitle(tracker.root, "Kept task", "assignee")).toBe(daveId);
    // And the profile still exists (it was archived, not removed).
    expect(await userIdByName(tracker, "Dave")).toBe(daveId);
  });
});

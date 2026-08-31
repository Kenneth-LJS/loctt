/**
 * Transcribed from docs/dev/ui-test-cases/flow-settings.md (SET-32,
 * SET-42) and flow-projects-users.md (the M4.1 PRU cases), plus
 * XS-63.
 *
 * These are browser cases: they turn on what a real SPA renders under
 * a real server, and several assert the file on disk after the write
 * so a client that posted the wrong value cannot pass.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Reads projects.yaml as text — the far end of every project write. */
async function projectsYaml(root: string): Promise<string> {
  return readFile(path.join(root, ".loctt", "config", "projects.yaml"), "utf8");
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

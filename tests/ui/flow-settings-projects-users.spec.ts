/**
 * Transcribed from docs/dev/ui-test-cases/flow-settings.md (SET-32,
 * SET-42) and flow-projects-users.md (the M4.1 PRU cases), plus
 * XS-63.
 *
 * These are browser cases: they turn on what a real SPA renders under
 * a real server, and several assert the file on disk after the write
 * so a client that posted the wrong value cannot pass.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { expect, test } from "./fixtures/tracker.ts";

/**
 * The stored avatar on disk: its real decoded dimensions and byte size.
 * K18 moved the resize to the server, so the far-end assertion is on
 * `users/<id>/avatar.<ext>`, not on the request body. Reads the file
 * the profile records rather than assuming `avatar.jpg`.
 */
async function storedAvatar(
  root: string,
  userId: string,
): Promise<{ width: number; height: number; bytes: number; ext: string } | undefined> {
  const dir = path.join(root, ".loctt", "users", userId);
  const profile = await readFile(path.join(dir, "profile.yaml"), "utf8");
  const name = /^avatar:\s*(\S+)\s*$/m.exec(profile)?.[1];
  if (name === undefined) return undefined;
  const file = path.join(dir, name);
  const info = await stat(file);
  const meta = await sharp(await readFile(file)).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: info.size,
    ext: path.extname(name).replace(/^\./, ""),
  };
}

/**
 * A real, minimal 2-frame animated GIF (2x2, red frame then blue).
 * Both sharp and Chromium decode it: sharp reports `pages === 2` and
 * the browser decodes frame 1 for the cropper. Hand-built because sharp
 * cannot synthesise an animation from a single `create` input.
 */
function build2FrameGif(): Buffer {
  const b: number[] = [];
  const push = (...xs: number[]) => { for (const x of xs) b.push(x & 0xff); };
  const lzw = (codes: number[], width: number): number[] => {
    let bits = 0, cur = 0; const out: number[] = [];
    for (const c of codes) {
      cur |= c << bits; bits += width;
      while (bits >= 8) { out.push(cur & 0xff); cur >>= 8; bits -= 8; }
    }
    if (bits > 0) out.push(cur & 0xff);
    return [out.length, ...out, 0x00];
  };
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  push(2, 0, 2, 0, 0x80, 0, 0);             // 2x2, global colour table (2 entries)
  push(0xff, 0x00, 0x00, 0x00, 0x00, 0xff); // red, blue
  push(0x21, 0xff, 0x0b);                    // NETSCAPE loop extension
  for (const c of "NETSCAPE2.0") push(c.charCodeAt(0));
  push(0x03, 0x01, 0x00, 0x00, 0x00);
  // Frame 1 (colour index 0 = red)
  push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
  push(0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00);
  push(0x02, ...lzw([4, 0, 0, 0, 0, 5], 3));
  // Frame 2 (colour index 1 = blue)
  push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
  push(0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00);
  push(0x02, ...lzw([4, 1, 1, 1, 1, 5], 3));
  push(0x3b); // trailer
  return Buffer.from(b);
}

/** The `id` of the active (self) user, read off its row in the panel. */
async function selfId(page: import("@playwright/test").Page): Promise<string> {
  const row = page.locator('[data-self="true"]');
  const id = (await row.getAttribute("data-testid"))?.replace("user-row-", "") ?? "";
  expect(id).not.toBe("");
  return id;
}


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
    // The label column is "Name", "Name  <email>", or — for an archived
    // user — "Name (archived)  <email>". Reduce it to the bare display
    // name before comparing: drop the email tail, then the archived
    // marker, so an archived user still matches by name (PRU-42 archives
    // Dave and then looks him up).
    const label = (m[2] ?? "")
      .replace(/\s{2,}<[^>]*>\s*$/, "")
      .replace(/\s*\(archived\)\s*$/, "")
      .trim();
    if (label === name) return m[1];
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

/**
 * Writes `list_columns` to the active (current) user's settings.yaml.
 *
 * K24 made `reporter` an opt-in column, so a test that needs the
 * reporter column visible seeds it here rather than relying on it being
 * default. The active user is whoever `.current-user` names — the one
 * the list view renders as. Merges into any existing settings so it
 * does not clobber other keys.
 */
async function setActiveUserListColumns(
  tracker: { root: string },
  columns: readonly string[],
): Promise<void> {
  const currentId = (
    await readFile(path.join(tracker.root, ".loctt", ".current-user"), "utf8")
  ).trim();
  const file = path.join(tracker.root, ".loctt", "users", currentId, "settings.yaml");
  let existing = "";
  try {
    existing = (await readFile(file, "utf8")).replace(/^list_columns:.*(\n {2}-.*)*\n?/m, "");
  } catch { /* no settings yet */ }
  const block = `list_columns:\n${columns.map(c => `  - ${c}`).join("\n")}\n`;
  await writeFile(file, `${existing.trimEnd()}\n${block}`.replace(/^\n/, ""), "utf8");
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
    // Edit-model (B2): the name is read-by-default text, not an input, so
    // assert its text content. Editing is behind a per-row Edit control.
    const names = page.locator('[data-testid^="project-name-"]');
    await expect(names).toHaveCount(2);
    await expect(names.nth(0)).toHaveText("Tasks");
    await expect(names.nth(1)).toHaveText("Web App");
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

    // Appears without a page reload. The name is read-by-default text.
    const names = page.locator('[data-testid^="project-name-"]');
    await expect(names).toHaveCount(2);
    await expect(names.nth(1)).toHaveText("Docs");

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

    // Edit-model (B2): open the row's edit form, change the name, Save.
    // The name no longer saves on blur.
    await page.getByTestId(`project-edit-${id}`).click();
    await page.getByTestId(`project-name-input-${id}`).fill("Backend Services");
    // The slug stays fixed and disabled inside the form.
    await expect(page.getByTestId(`project-slug-${id}`)).toHaveValue("backend");
    await page.getByTestId(`project-name-save-${id}`).click();

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

    // Edit-model (B2): the immutable fields are shown in the edit form.
    await page.getByTestId(`project-edit-${id}`).click();

    // Disabled, not merely unvalidated. `toHaveJSProperty` rather than
    // `toBeDisabled`, which retargets inside a <label>. The prefix input,
    // unlike the slug, is enabled — it changes via its own confirm
    // dialog (PRU-44), so PRU-20's immutability is only the slug plus the
    // requirement that no plain PUT rewrites the prefix.
    await expect(page.getByTestId(`project-slug-${id}`))
      .toHaveJSProperty("disabled", true);
    // The name is editable in the same form, so the disabled slug reads
    // as intentional rather than as a broken form.
    await expect(page.getByTestId(`project-name-input-${id}`))
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

  // @verifies PRU-48
  test("PRU-48: making a project the default writes it to config and moves the marker", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);

    const yaml = await projectsYaml(tracker.root);
    const webId = /id: (\w+)\n\s+name: Web\b/.exec(yaml)?.[1] ?? "";
    expect(webId).not.toBe("");

    // Make Web the default from the panel.
    await page.getByTestId(`project-set-default-${webId}`).click();

    // The marker moves to Web without a reload, and its button goes inert.
    await expect(page.getByTestId(`project-default-marker-${webId}`)).toBeVisible();
    await expect(page.getByTestId(`project-set-default-${webId}`)).toBeDisabled();
    await expect(page.getByTestId(`project-set-default-${webId}`)).toHaveText("Default");

    // The far end: config records the default, and new tasks land there.
    await expect.poll(async () => projectsYaml(tracker.root))
      .toMatch(new RegExp(`default:\\s*${webId}`));
    const created = await tracker.run(["create", "Lands in default"]);
    expect(created).toContain("WEB-");
  });

  // @verifies PRU-47
  //
  // PRU-47's far end: "Reloading shows the edited values; `loctt user`
  // agrees (P10)." The panel-level Vitest tests assert the PUT the dialog
  // issues; only a real round-trip proves the edit reached profile.yaml
  // and survives a reload — the exact gap the B2 fix-review flagged. This
  // also exercises the B2 bug-1 write path end-to-end: a valid email is
  // persisted (and read back non-blank), not degraded on read.
  test("PRU-47: editing a user's name and email persists, survives a reload, and the CLI agrees", async ({
    page,
    tracker,
  }) => {
    // A non-self user so nothing about the acting-user guards is in play.
    await tracker.run(["user", "create", "Robin", "--email", "robin@old.example"]);
    const robinId = await userIdByName(tracker, "Robin");
    expect(robinId).toBeTruthy();

    await page.goto(`${tracker.baseURL}/settings/users`);
    await page.getByTestId(`user-edit-${robinId}`).click();
    await expect(page.getByTestId(`user-edit-dialog-${robinId}`)).toBeVisible();

    await page.getByTestId(`user-edit-name-${robinId}`).fill("Robin Banks");
    await page.getByTestId(`user-edit-email-${robinId}`).fill("robin@new.example");
    await page.getByTestId(`user-edit-save-${robinId}`).click();

    // On success the dialog closes and the row shows the new values.
    await expect(page.getByTestId(`user-edit-dialog-${robinId}`)).toBeHidden();
    await expect(page.getByTestId(`user-row-${robinId}`)).toContainText("Robin Banks");
    await expect(page.getByTestId(`user-row-${robinId}`)).toContainText("robin@new.example");

    // The far end #1: profile.yaml on disk carries both edits — the email
    // is stored, not degraded to blank (B2 bug 1).
    const profile = await readFile(
      path.join(tracker.root, ".loctt", "users", robinId as string, "profile.yaml"),
      "utf8",
    );
    expect(profile).toContain("Robin Banks");
    expect(profile).toContain("robin@new.example");
    expect(profile).not.toContain("robin@old.example");

    // The far end #2: a full reload still shows the edited values — they
    // came from disk, not from a stale in-memory cache.
    await page.reload();
    await expect(page.getByTestId(`user-row-${robinId}`)).toContainText("Robin Banks");
    await expect(page.getByTestId(`user-row-${robinId}`)).toContainText("robin@new.example");

    // The far end #3: `loctt user` agrees (P10).
    const listed = await tracker.run(["user", "list", "--all"]);
    expect(listed).toContain("Robin Banks");
    expect(listed).toContain("robin@new.example");
  });

  // @verifies PRU-44
  test("PRU-44: changing a prefix from the edit form renames every task and states the count", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web", "--prefix", "WEB-"]);
    // Three tasks in Web so the blast radius is a real number.
    for (const t of ["One", "Two", "Three"]) {
      await tracker.run(["create", t, "--project", "web"]);
    }
    await page.goto(`${tracker.baseURL}/settings/projects`);

    const yaml = await projectsYaml(tracker.root);
    const webId = /id: (\w+)\n\s+name: Web\b/.exec(yaml)?.[1] ?? "";
    expect(webId).not.toBe("");

    // Edit-model (B2): the prefix control lives inside the edit form.
    await page.getByTestId(`project-edit-${webId}`).click();
    await page.getByTestId(`project-prefix-${webId}`).fill("SITE-");
    await page.getByTestId(`project-prefix-save-${webId}`).click();

    // The confirm states the blast radius before anything is written.
    const confirm = page.getByTestId(`project-prefix-confirm-${webId}`);
    await expect(confirm).toContainText("3 tasks");
    await page.getByTestId(`project-prefix-confirm-btn-${webId}`).click();

    // The far end: config and task keys on disk carry the new prefix.
    await expect.poll(async () => projectsYaml(tracker.root)).toContain("SITE-");
    await expect.poll(async () => tracker.run(["list", "--project", "web"]))
      .toContain("SITE-");
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

test.describe("PRU — avatar cropper, storage, and removal", () => {
  test.beforeEach(({ page }) => {
    // K18/K20 assert what lands on disk; a client-side pageerror during
    // decode/crop would silently skip the upload, so fail on one.
    page.on("pageerror", err => { throw err; });
  });

  // @verifies PRU-13
  test("PRU-13: the browser crops, the server stores <=500px and materially smaller", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    // A 1200x900 JPEG at ~2.1 MB — the case's source. High-entropy
    // per-channel noise defeats JPEG's compression so the source is
    // genuinely large; a plain counter pattern compresses too well.
    const noise = Buffer.alloc(1200 * 900 * 3);
    let seed = 0x9e3779b9;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed >> 16) & 0xff;
    }
    const source = await sharp(noise, { raw: { width: 1200, height: 900, channels: 3 } })
      .jpeg({ quality: 100 }).toBuffer();
    // A genuinely large source (the case names 2.1 MB; the assertion
    // that matters is the far-end reduction below, not the exact size).
    expect(source.byteLength).toBeGreaterThan(1_400_000);

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "photo.jpg", mimeType: "image/jpeg", buffer: source,
    });

    // The cropper opens; the preview renders from the crop (a canvas).
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();
    await expect(page.getByTestId(`avatar-crop-preview-${id}`)).toBeVisible();

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`avatar-crop-confirm-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);

    // The preview element renders from the cropped result, not the raw file.
    await expect(page.getByTestId(`user-avatar-preview-${id}`)).toBeVisible();

    // The far end on disk: <=500px longest edge, materially < 2.1 MB,
    // recorded in profile.yaml with a matching extension.
    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.width ?? 0)
      .toBeGreaterThan(0);
    const stored = await storedAvatar(tracker.root, id);
    expect(stored).toBeDefined();
    expect(Math.max(stored!.width, stored!.height)).toBeLessThanOrEqual(500);
    // Materially smaller — an order of magnitude below the source.
    expect(stored!.bytes).toBeLessThan(source.byteLength / 10);
    // copyAvatar always writes JPG; the recorded name matches the file.
    expect(stored!.ext).toBe("jpg");

    // The avatar now renders in the Settings panel (img, not initials)…
    await expect(page.getByTestId(`user-avatar-${id}`)).toBeVisible();
    await expect(page.getByTestId(`user-initials-${id}`)).toHaveCount(0);

    // …and in the header menu, as the stored image rather than initials.
    await page.getByTestId("user-menu-trigger").click();
    const menuAvatar = page.getByTestId("user-menu-current-avatar");
    await expect(menuAvatar).toBeVisible();
    expect(await menuAvatar.evaluate(el => el.tagName)).toBe("IMG");
  });

  // @verifies PRU-27
  test("PRU-27: a 4000x3000 source is clamped to <=500px, an order of magnitude smaller", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    const noise = Buffer.alloc(4000 * 3000 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 40503) & 0xff;
    const source = await sharp(noise, { raw: { width: 4000, height: 3000, channels: 3 } })
      .jpeg({ quality: 95 }).toBuffer();

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "huge.jpg", mimeType: "image/jpeg", buffer: source,
    });
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`avatar-crop-confirm-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);

    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.bytes ?? 0)
      .toBeGreaterThan(0);
    const stored = await storedAvatar(tracker.root, id);
    // <=500px longest edge, aspect preserved (a centred square crop of
    // a 4:3 photo is square once cropped, so the clamp is symmetric).
    expect(Math.max(stored!.width, stored!.height)).toBeLessThanOrEqual(500);
    // An order of magnitude smaller than the multi-MB source.
    expect(stored!.bytes).toBeLessThan(source.byteLength / 10);
    // No frozen dialog: the cropper is gone and the panel is interactive.
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toHaveCount(0);
  });

  // @verifies PRU-28
  test("PRU-28: a 64x64 source is not upscaled to 500px", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#3355aa" },
    }).png().toBuffer();

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "small.png", mimeType: "image/png", buffer: source,
    });
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();
    // Drop the crop size to the full image so the whole 64px is kept —
    // the default 0.9 crop would otherwise land at ~58px, still <=64.
    const slider = page.getByTestId(`avatar-crop-size-${id}`);
    await slider.fill(await slider.getAttribute("max") ?? "64");

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`avatar-crop-confirm-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);

    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.width ?? 0)
      .toBeGreaterThan(0);
    const stored = await storedAvatar(tracker.root, id);
    // The server does not enlarge: the stored longest edge stays <=64,
    // never blown up to 500.
    expect(Math.max(stored!.width, stored!.height)).toBeLessThanOrEqual(64);
    expect(Math.max(stored!.width, stored!.height)).toBeGreaterThan(1);
  });

  // @verifies PRU-29
  test("PRU-29: an animated GIF is flagged and stored as a single still frame", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    const twoFrameGif = build2FrameGif();

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "spin.gif", mimeType: "image/gif", buffer: twoFrameGif,
    });

    // PRU-29: the cropper opens and states it stores a single frame.
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();
    await expect(page.getByTestId(`avatar-animated-note-${id}`))
      .toContainText(/single frame/i);

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`avatar-crop-confirm-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);

    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.bytes ?? 0)
      .toBeGreaterThan(0);
    const stored = await storedAvatar(tracker.root, id);
    // Stored as a single-frame JPG, not the animated GIF.
    expect(stored!.ext).toBe("jpg");
    const meta = await sharp(await readFile(
      path.join(tracker.root, ".loctt", "users", id, "avatar.jpg"),
    )).metadata();
    // A JPEG has no multi-page animation; pages is undefined or 1.
    expect(meta.pages ?? 1).toBe(1);
  });

  // @verifies PRU-31
  test("PRU-31: removing an avatar clears profile.yaml and the file, reverting to initials", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    // First store an avatar.
    const source = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#227722" },
    }).png().toBuffer();
    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "a.png", mimeType: "image/png", buffer: source,
    });
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();
    await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`avatar-crop-confirm-${id}`).click(),
    ]);
    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.bytes ?? 0)
      .toBeGreaterThan(0);
    await expect(page.getByTestId(`user-avatar-${id}`)).toBeVisible();

    // Remove it.
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "DELETE"),
      page.getByTestId(`user-avatar-remove-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);

    // profile.yaml no longer records an avatar, and the file is gone.
    await expect.poll(async () => storedAvatar(tracker.root, id)).toBeUndefined();
    await expect(
      readFile(path.join(tracker.root, ".loctt", "users", id, "avatar.jpg")),
    ).rejects.toThrow();

    // Every surface reverts to initials in the same render — the
    // Settings cell…
    await expect(page.getByTestId(`user-initials-${id}`)).toBeVisible();
    await expect(page.getByTestId(`user-avatar-${id}`)).toHaveCount(0);

    // …and the header menu (a span with initials, no <img>).
    await page.getByTestId("user-menu-trigger").click();
    const menuAvatar = page.getByTestId("user-menu-current-avatar");
    await expect(menuAvatar).toBeVisible();
    expect(await menuAvatar.evaluate(el => el.tagName)).toBe("SPAN");
  });

  // @verifies PRU-39
  test("PRU-39: a truncated image fails at browser decode with nothing stored", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    const posts: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && req.url().includes("/avatar")) posts.push(req.url());
    });

    // A valid JPEG header followed by garbage / truncation — decodes fail.
    const good = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#888" },
    }).jpeg().toBuffer();
    const truncated = good.subarray(0, Math.floor(good.byteLength / 2));

    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "broken.jpg", mimeType: "image/jpeg", buffer: truncated,
    });

    // PRU-39: the failure is attributed honestly, and no cropper opens.
    const problem = page.getByTestId(`user-avatar-problem-${id}`);
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(/broken\.jpg/);
    await expect(problem).toContainText(/not changed|corrupt|decode/i);
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toHaveCount(0);

    // Nothing was posted or stored.
    expect(posts).toEqual([]);
    expect(await storedAvatar(tracker.root, id)).toBeUndefined();

    // The panel stays interactive: the input can be used again.
    await expect(page.getByTestId(`user-avatar-input-${id}`)).toBeEnabled();
  });

  // @verifies PRU-40
  test("PRU-40: a server-side failure keeps the crop for retry and names the failure", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/users`);
    const id = await selfId(page);

    // Fail the first POST at the network layer to stand in for a 500 /
    // disk-full server failure after a successful crop.
    let failed = false;
    await page.route(`**/api/users/${id}/avatar`, route => {
      if (route.request().method() === "POST" && !failed) {
        failed = true;
        void route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "unknown", message: "disk full", data_state: "not_saved" }),
        });
        return;
      }
      void route.continue();
    });

    const source = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#aa2222" },
    }).png().toBuffer();
    await page.getByTestId(`user-avatar-input-${id}`).setInputFiles({
      name: "c.png", mimeType: "image/png", buffer: source,
    });
    await expect(page.getByTestId(`avatar-cropper-${id}`)).toBeVisible();
    await page.getByTestId(`avatar-crop-confirm-${id}`).click();

    // The error states the image was prepared but not saved, and names it.
    const err = page.getByTestId(`user-avatar-error-${id}`);
    await expect(err).toBeVisible();
    await expect(err).toContainText(/prepared but not saved/i);
    await expect(err).toContainText(/disk full/);
    // Nothing landed on disk on the failed attempt.
    expect(await storedAvatar(tracker.root, id)).toBeUndefined();

    // Retry re-posts the already-cropped image without re-picking.
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/avatar`) && r.request().method() === "POST"),
      page.getByTestId(`user-avatar-retry-${id}`).click(),
    ]);
    expect(resp.status()).toBe(200);
    await expect.poll(async () => (await storedAvatar(tracker.root, id))?.bytes ?? 0)
      .toBeGreaterThan(0);
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

    // K24: reporter is an opt-in column, not a default one. This case is
    // about the reporter *cell* degrading, so the viewing user opts the
    // reporter column in via list_columns before we look at the list.
    // Written to the active (init) user, who is whoever the list view
    // renders as — the users created above are additional profiles.
    await setActiveUserListColumns(tracker, [
      "key", "title", "assignee", "reporter", "status",
    ]);

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

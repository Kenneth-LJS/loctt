/**
 * Generates the runthrough seed tracker (K144, B42) with the real,
 * built `loctt`, and writes it to `tests/fixtures/trackers/seed/`:
 *
 *   .loctt/           the tracker, checked in
 *   seed-index.json   slug → id/key/name for every seeded entity
 *
 * Run with `npm run seed:build` after `npm run build`. The output is
 * checked in; regenerate it only when the seed's content should change
 * (a format change goes through `npm run seed:upgrade` instead).
 *
 * Ids and timestamps are NOT deterministic: core has no clock or id
 * override (checked 2026-09-28: it reads only LOCTT_ROOT, LOCTT_DEBUG,
 * LOCTT_CLIENT_DIR and USER/USERNAME from the environment). Keys are
 * deterministic — they are allocated in creation order — but cases
 * still reference tasks through the index (`${task.<slug>.key}`) so a
 * reordering here cannot silently retarget a test.
 *
 * Everything goes through `loctt` itself: the CLI for almost all of it,
 * and `loctt mcp` for the number, boolean and multi-enum custom fields,
 * because `loctt set` stores its value as a string and the validator
 * then refuses it for those types (reported as a product bug, B42).
 */

import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { cliEntry, seedIndexPath, seedLoctt, seedRoot, TEMP_PREFIX, workspaceRoot } from "../lib/paths.ts";
import { doctorFindings, runCliArgv, withMcp } from "../lib/surfaces.ts";
import { TrackerView } from "../lib/tracker.ts";

interface TaskSpec {
  readonly slug: string;
  readonly title: string;
  readonly project?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly type?: string;
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start?: string;
  readonly due?: string;
  readonly estimate?: string;
  readonly milestone?: string;
  readonly sprint?: string;
  readonly labels?: readonly string[];
  readonly body?: string;
  /** Custom fields: strings go through `loctt set`, other types through MCP. */
  readonly fields?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

const WEB = "Web App";
const MOB = "Mobile";
const OPS = "Platform Ops";

/** Creation order fixes the keys: WEB-1…, then MOB-…, then OPS-…. */
const TASKS: readonly TaskSpec[] = [
  // Web App — checkout epic, three levels deep.
  { slug: "epic_checkout", title: "Checkout redesign", type: "feature", priority: "high", milestone: "Beta", assignee: "Ada", reporter: "Bea", start: "2026-08-03", due: "2026-10-30", labels: ["frontend"], body: "Rebuild checkout as three steps: cart, payment, confirmation.\n", fields: { team: "web", area: "ui", risk: 3, signed_off: false, review_on: "2026-10-15" } },
  { slug: "checkout_cart", title: "Cart page", type: "story", priority: "high", status: "done", sprint: "Sprint 1", estimate: "5", assignee: "Bea", labels: ["frontend"], fields: { team: "web", area: "ui" } },
  { slug: "cart_totals", title: "Cart totals rounding", type: "bug", priority: "medium", status: "done", sprint: "Sprint 1", estimate: "2", assignee: "Bea", labels: ["frontend"] },
  { slug: "cart_empty_state", title: "Empty cart state", type: "task", priority: "low", status: "done", sprint: "Sprint 1", estimate: "1", labels: ["frontend"] },
  { slug: "checkout_payment", title: "Payment step", type: "story", priority: "critical", status: "in_progress", sprint: "Sprint 2", estimate: "8", assignee: "Ada", milestone: "Beta", labels: ["frontend", "backend"], fields: { team: "payments", area: "api", risk: 8, signed_off: false } },
  { slug: "payment_card_form", title: "Card form validation", type: "task", priority: "high", status: "in_progress", sprint: "Sprint 2", estimate: "3", assignee: "Ada", labels: ["frontend"] },
  { slug: "payment_3ds", title: "3-D Secure challenge", type: "task", priority: "high", sprint: "Sprint 2", estimate: "5", assignee: "Cy", labels: ["backend"], due: "2026-09-15" },
  { slug: "checkout_confirm", title: "Order confirmation page", type: "story", priority: "medium", sprint: "Sprint 2", estimate: "3", milestone: "Beta", labels: ["frontend"] },
  // Web App — search epic.
  { slug: "epic_search", title: "Site search", type: "feature", priority: "medium", milestone: "GA", labels: ["backend"], fields: { team: "search", area: "api" } },
  { slug: "search_index", title: "Build search index", type: "task", priority: "medium", estimate: "8", assignee: "Bea", labels: ["backend", "infra"] },
  { slug: "search_ui", title: "Search results UI", type: "story", priority: "medium", estimate: "5", labels: ["frontend"] },
  { slug: "search_typo", title: "Typo tolerance", type: "spike", priority: "low", estimate: "3" },
  // Web App — bugs, blocks chain, related work.
  { slug: "login_crash", title: "Login crashes on empty password", type: "bug", priority: "critical", status: "in_progress", assignee: "Bea", reporter: "Ada", sprint: "Sprint 2", labels: ["urgent", "backend"], due: "2026-09-20", body: "Steps to reproduce:\n\n1. Open /login\n2. Leave the password empty\n3. Press Sign in\n", fields: { team: "identity", area: "api", risk: 9, signed_off: false, platforms: ["web"] } },
  { slug: "login_crash_dup", title: "App crashes when password is blank", type: "bug", priority: "high", status: "wont_do", labels: ["backend"] },
  { slug: "api_keys", title: "Issue API keys", type: "story", priority: "high", estimate: "5", milestone: "GA", labels: ["backend"] },
  { slug: "rate_limit", title: "Rate-limit the public API", type: "task", priority: "high", estimate: "3", milestone: "GA", labels: ["backend"] },
  { slug: "public_docs", title: "Publish API docs", type: "task", priority: "medium", estimate: "2", milestone: "GA", labels: ["docs"] },
  { slug: "dark_mode", title: "Dark mode", type: "feature", priority: "low", labels: ["frontend"], fields: { area: "ui", platforms: ["web"] } },
  { slug: "theme_tokens", title: "Extract theme tokens", type: "task", priority: "low", labels: ["frontend", "tech-debt"] },
  { slug: "perf_budget", title: "Set a performance budget", type: "spike", priority: "medium", start: "2026-10-05", due: "2026-10-09" },
  { slug: "flaky_checkout_test", title: "Flaky checkout end-to-end test", type: "bug", priority: "medium", labels: ["tech-debt"], assignee: "Ada" },
  { slug: "a11y_audit", title: "Accessibility audit", type: "task", priority: "high", status: "done", sprint: "Sprint 1", estimate: "3", fields: { signed_off: true } },
  { slug: "old_banner", title: "Remove holiday banner", type: "task", priority: "low", status: "done" },
  { slug: "legacy_ie", title: "Support Internet Explorer 11", type: "story", priority: "low", status: "wont_do", labels: ["legacy"] },
  { slug: "deep_links", title: "Deep links into the app", type: "story", priority: "medium", labels: ["frontend"], fields: { platforms: ["ios", "android"] } },
  // Mobile.
  { slug: "mob_offline", title: "Offline mode", project: MOB, type: "feature", priority: "high", milestone: "GA", assignee: "Bea", fields: { team: "mobile", platforms: ["ios", "android"] } },
  { slug: "mob_sync_queue", title: "Sync queue", project: MOB, type: "story", priority: "high", estimate: "8", assignee: "Bea" },
  { slug: "mob_conflicts", title: "Conflict resolution", project: MOB, type: "task", priority: "medium", estimate: "5" },
  { slug: "mob_cache", title: "Local cache", project: MOB, type: "task", priority: "medium", status: "in_progress", estimate: "3", assignee: "Cy" },
  { slug: "mob_push", title: "Push notifications", project: MOB, type: "story", priority: "medium", fields: { platforms: ["ios"] } },
  { slug: "mob_ios_crash", title: "Crash on iOS 18 launch", project: MOB, type: "bug", priority: "critical", labels: ["urgent"], fields: { platforms: ["ios"], risk: 7 } },
  { slug: "mob_dark", title: "Dark mode for mobile", project: MOB, type: "feature", priority: "low" },
  { slug: "mob_tablet", title: "Tablet layout", project: MOB, type: "story", priority: "low" },
  // Platform Ops.
  { slug: "ops_backups", title: "Nightly backups", project: OPS, type: "task", priority: "high", status: "done", labels: ["infra"], fields: { team: "ops", area: "infra" } },
  { slug: "ops_monitoring", title: "Uptime monitoring", project: OPS, type: "task", priority: "high", status: "in_progress", assignee: "Ada", labels: ["infra"] },
  { slug: "ops_oncall", title: "On-call rotation", project: OPS, type: "task", priority: "medium", labels: ["infra"] },
  { slug: "ops_certs", title: "Renew TLS certificates", project: OPS, type: "task", priority: "critical", due: "2026-10-01", labels: ["infra", "urgent"], fields: { review_on: "2026-09-25" } },
  { slug: "ops_costs", title: "Cloud cost review", project: OPS, type: "spike", priority: "low", start: "2026-11-02", due: "2026-11-06" },
  { slug: "ops_runbook", title: "Write the incident runbook", project: OPS, type: "task", priority: "medium", body: "## Paging\n\n- Primary: on-call\n- Secondary: team lead\n\n## First five minutes\n\nAcknowledge, open a channel, post status.\n" },
  { slug: "ops_postgres", title: "Migrate to Postgres 17", project: OPS, type: "story", priority: "high", estimate: "13", milestone: "GA", labels: ["infra", "backend"] },
];

/** [child, parent] — added in this order, which is each parent's child order. */
const PARENTS: ReadonlyArray<readonly [string, string]> = [
  ["checkout_cart", "epic_checkout"],
  ["checkout_payment", "epic_checkout"],
  ["checkout_confirm", "epic_checkout"],
  ["cart_totals", "checkout_cart"],
  ["cart_empty_state", "checkout_cart"],
  ["payment_card_form", "checkout_payment"],
  ["payment_3ds", "checkout_payment"],
  ["search_index", "epic_search"],
  ["search_ui", "epic_search"],
  ["search_typo", "epic_search"],
  ["mob_sync_queue", "mob_offline"],
  ["mob_cache", "mob_offline"],
  ["mob_conflicts", "mob_sync_queue"],
];

/** [source, type, target] */
const LINKS: ReadonlyArray<readonly [string, string, string]> = [
  ["ops_postgres", "blocks", "api_keys"],
  ["api_keys", "blocks", "rate_limit"],
  ["rate_limit", "blocks", "public_docs"],
  ["ops_monitoring", "blocks", "ops_oncall"],
  ["dark_mode", "relates_to", "theme_tokens"],
  ["mob_dark", "relates_to", "dark_mode"],
  ["login_crash_dup", "duplicates", "login_crash"],
  ["mob_cache", "causes", "mob_ios_crash"],
  ["flaky_checkout_test", "relates_to", "checkout_payment"],
];

const ARCHIVED_TASKS = ["old_banner", "legacy_ie"];

async function main(): Promise<void> {
  if (!existsSync(cliEntry)) throw new Error(`Build the CLI first (npm run build): ${cliEntry} is missing`);
  await mkdir(workspaceRoot, { recursive: true });
  const root = await mkdtemp(path.join(workspaceRoot, `${TEMP_PREFIX}seed-build-`));
  const log: string[] = [];

  const run = async (...argv: string[]): Promise<string> => {
    // USER/USERNAME name the user `init` creates.
    const res = await runCliArgv(argv, root, { USER: "ada", USERNAME: "ada" });
    log.push(`$ loctt ${argv.join(" ")}\n${res.stdout}${res.stderr ? `\n${res.stderr}` : ""}`);
    if (res.exitCode !== 0) {
      throw new Error(`loctt ${argv.join(" ")} exited ${res.exitCode}:\n${res.stdout}\n${res.stderr}`);
    }
    return res.stdout;
  };

  try {
    // ── Workspace, users, projects ────────────────────────────────────
    await run("init", "--prefix", "WEB", "--project-label", WEB, "--timezone", "UTC", "--quiet");
    await run("user", "edit", "ada", "--name", "Ada", "--email", "ada@example.com", "--timezone", "UTC");
    await run("user", "create", "Bea", "--email", "bea@example.com", "--timezone", "Europe/Berlin");
    await run("user", "create", "Cy", "--email", "cy@example.com", "--timezone", "America/New_York");
    await run("project", "create", MOB, "--prefix", "MOB");
    await run("project", "create", OPS, "--prefix", "OPS");

    // ── Labels, milestones, sprints ───────────────────────────────────
    await run("label", "create", "frontend", "--color", "#1E6FCB");
    await run("label", "create", "backend", "--color", "#356E1A");
    await run("label", "create", "infra", "--color", "light:#8C6E28,dark:#F2D264");
    await run("label", "create", "urgent", "--color", "#B02F17");
    await run("label", "create", "docs", "--color", "#6A704F");
    await run("label", "create", "tech-debt", "--color", "#BD5B00");
    await run("label", "create", "legacy");
    await run("milestone", "create", "Beta", "--target-date", "2026-11-02");
    await run("milestone", "create", "GA", "--target-date", "2027-01-18");
    await run("sprint", "create", "Sprint 1", "--start", "2026-08-03", "--end", "2026-08-16", "--state", "active", "--goal", "Ship the cart");
    await run("sprint", "create", "Sprint 2", "--start", "2026-08-17", "--end", "2026-08-30", "--state", "future", "--goal", "Payments end to end");

    // ── Custom fields, one of each type ───────────────────────────────
    await run("custom-field", "add", "team", "--label", "Team", "--type", "string", "--searchable");
    await run("custom-field", "add", "risk", "--label", "Risk", "--type", "number");
    await run("custom-field", "add", "signed_off", "--label", "Signed off", "--type", "boolean");
    await run("custom-field", "add", "review_on", "--label", "Review on", "--type", "date");
    await run("custom-field", "add", "area", "--label", "Area", "--type", "enum",
      "--enum-value", "ui=UI", "--enum-value", "api=API", "--enum-value", "infra=Infrastructure", "--enum-value", "docs=Docs");
    await run("custom-field", "add", "platforms", "--label", "Platforms", "--type", "enum", "--multi",
      "--enum-value", "ios=iOS", "--enum-value", "android=Android", "--enum-value", "web=Web");

    // ── Tasks ─────────────────────────────────────────────────────────
    const keys = new Map<string, string>();
    const typed: Array<{ slug: string; field: string; value: unknown }> = [];
    for (const t of TASKS) {
      const argv = ["create", t.title];
      if (t.project) argv.push("--project", t.project);
      if (t.priority) argv.push("--priority", t.priority);
      if (t.type) argv.push("--type", t.type);
      if (t.assignee) argv.push("--assignee", t.assignee);
      if (t.reporter) argv.push("--reporter", t.reporter);
      if (t.start) argv.push("--start", t.start);
      if (t.due) argv.push("--due", t.due);
      if (t.estimate) argv.push("--estimate", t.estimate);
      if (t.milestone) argv.push("--milestone", t.milestone);
      if (t.sprint) argv.push("--sprint", t.sprint);
      for (const l of t.labels ?? []) argv.push("--label", l);
      if (t.body) argv.push("--body", t.body);
      const out = await run(...argv);
      const m = /Created ([A-Z]+-\d+):/.exec(out);
      if (!m) throw new Error(`could not read the key from: ${out}`);
      keys.set(t.slug, m[1] as string);
      for (const [field, value] of Object.entries(t.fields ?? {})) {
        if (typeof value === "string") await run("set", m[1] as string, field, value);
        else typed.push({ slug: t.slug, field, value });
      }
    }
    const key = (slug: string): string => {
      const k = keys.get(slug);
      if (!k) throw new Error(`unknown slug ${slug}`);
      return k;
    };

    // Typed custom fields through `loctt mcp` (see the header).
    await withMcp(root, async mcp => {
      for (const { slug, field, value } of typed) {
        const res = await mcp.callTool("update_task", { ref: key(slug), field, value });
        const text = res.content.map(c => c.text ?? "").join("\n");
        log.push(`mcp update_task ${key(slug)} ${field}=${JSON.stringify(value)}\n${text}`);
        if (res.isError) throw new Error(`update_task ${key(slug)} ${field}: ${text}`);
      }
    });

    // Statuses after creation, so completed_date and status_updated_at
    // are written by the real transition.
    for (const t of TASKS) if (t.status) await run("set", key(t.slug), "status", t.status);

    // ── Relationships ─────────────────────────────────────────────────
    for (const [child, parent] of PARENTS) await run("link", key(child), "parent", key(parent));
    for (const [src, type, dst] of LINKS) await run("link", key(src), type, key(dst));
    // One explicit reorder, so a rerank is part of the seed's history.
    await run("rerank", key("epic_search"), "child", key("search_typo"), "--before", key("search_ui"));

    // ── Move (key history) ────────────────────────────────────────────
    const moved = await run("move", key("deep_links"), MOB);
    const mm = /→ ([A-Z]+-\d+)/.exec(moved);
    if (!mm) throw new Error(`could not read the new key from: ${moved}`);
    keys.set("deep_links", mm[1] as string);

    // ── Comments (with mentions) ──────────────────────────────────────
    const view0 = new TrackerView(root);
    const userId = (name: string): string => {
      const u = view0.users().find(p => p["name"] === name);
      if (!u) throw new Error(`no user ${name}`);
      return String(u["id"]);
    };
    const comments: Record<string, { id: string; task: string }> = {};
    const comment = async (slug: string, taskSlug: string, text: string): Promise<void> => {
      const out = await run("comment", key(taskSlug), text);
      const m = /Added comment (\S+) on/.exec(out);
      if (!m) throw new Error(`could not read the comment id from: ${out}`);
      comments[slug] = { id: m[1] as string, task: taskSlug };
    };
    await run("user", "switch", "Bea");
    await comment("login_repro", "login_crash", `Reproduced on staging. @user:${userId("Ada")} can you check the auth callback?`);
    await run("user", "switch", "Ada");
    await comment("login_reply", "login_crash", `Found it: the callback assumes a password. Fix in review, @user:${userId("Bea")}.`);
    await comment("checkout_kickoff", "epic_checkout", "Kickoff notes are in the body. Cart ships first.");
    await comment("ops_note", "ops_monitoring", "Pager integration is live; alerts route to on-call.");

    // ── Attachment ────────────────────────────────────────────────────
    const attachSrc = path.join(root, "repro-steps.txt");
    await writeFile(attachSrc, "1. Open /login\n2. Submit with an empty password\n3. Observe the 500\n", "utf-8");
    await run("attach", key("login_crash"), "repro-steps.txt");
    await rm(attachSrc);

    // ── Saved views ───────────────────────────────────────────────────
    await run("views", "create", "Open bugs", "--filter", "task_type = bug", "--filter", "status != done", "--sort", "priority:desc");
    await run("views", "create", "Hot list", "--filter", "priority = critical,high", "--filter", "status = backlog,in_progress");

    // ── Sprint history, archives ──────────────────────────────────────
    await run("sprint", "edit", "Sprint 1", "--state", "completed");
    await run("sprint", "edit", "Sprint 2", "--state", "active");
    for (const slug of ARCHIVED_TASKS) await run("archive", key(slug));
    await run("label", "archive", "legacy");
    await run("user", "archive", "Cy");

    // ── Health gate ───────────────────────────────────────────────────
    const findings = await doctorFindings(root);
    if (findings.length > 0) throw new Error(`the generated seed is not doctor-clean:\n${findings.join("\n")}`);

    // ── Index ─────────────────────────────────────────────────────────
    const view = new TrackerView(root);
    const byKey = new Map(view.tasks().map(t => [t.key, t]));
    const named = (file: string, list: string): Array<Record<string, unknown>> => {
      const doc = view.readYaml(file) as Record<string, unknown> | undefined;
      return Array.isArray(doc?.[list]) ? doc[list] as Array<Record<string, unknown>> : [];
    };
    const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const section = (entries: Array<Record<string, unknown>>, extra: string[] = []): Record<string, Record<string, string>> =>
      Object.fromEntries(entries.map(e => [slugify(String(e["name"])), Object.fromEntries(
        ["id", "name", ...extra].filter(k => e[k] !== undefined).map(k => [k, String(e[k])]),
      )]));

    const currentUser = readFileSync(path.join(root, ".loctt/.current-user"), "utf-8").trim();
    const index = {
      "//": "Generated by tests/runthrough/seed/build-seed.ts (npm run seed:build). Do not edit by hand.",
      format_version: readFileSync(path.join(root, ".loctt/.schema-version"), "utf-8").trim(),
      current_user: currentUser,
      task: Object.fromEntries(TASKS.map(t => {
        const rec = byKey.get(key(t.slug));
        if (!rec) throw new Error(`task ${t.slug} (${key(t.slug)}) not found on disk`);
        return [t.slug, { id: rec.id, key: rec.key, title: String(rec.frontmatter["title"]) }];
      })),
      user: section(view.users()),
      project: section(named("config/projects.yaml", "projects"), ["prefix"]),
      label: section(named("config/labels.yaml", "labels")),
      milestone: section(named("config/milestones.yaml", "milestones")),
      sprint: section(named("config/sprints.yaml", "sprints")),
      view: section(named("config/queries.yaml", "queries")),
      comment: Object.fromEntries(Object.entries(comments).map(([slug, c]) => [slug, { id: c.id, task: key(c.task) }])),
    };

    // ── Strip what a checkout cannot carry, then publish ──────────────
    // `.loctt/.gitignore` ignores `.current-user` and users/*/settings.yaml,
    // and the repo ignores `.loctt/local/`. Removing them here keeps the
    // local seed identical to a fresh checkout's; the runner restores
    // `.current-user` from the index.
    await rm(path.join(root, ".loctt/.current-user"), { force: true });
    await rm(path.join(root, ".loctt/local"), { recursive: true, force: true });
    for (const id of await readdir(path.join(root, ".loctt/users"))) {
      await rm(path.join(root, ".loctt/users", id, "settings.yaml"), { force: true });
    }

    await mkdir(seedRoot, { recursive: true });
    await rm(seedLoctt, { recursive: true, force: true });
    await cp(path.join(root, ".loctt"), seedLoctt, { recursive: true });
    await writeFile(seedIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
    console.log(`Seed written to ${path.relative(process.cwd(), seedRoot)}: ${TASKS.length} tasks, ${Object.keys(comments).length} comments.`);
  } catch (err) {
    console.error(log.slice(-5).join("\n\n"));
    throw err;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();

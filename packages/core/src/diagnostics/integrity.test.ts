import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { postComment } from "../task/comments.js";
import { blockingFindings, checkDataIntegrity } from "./integrity.js";

/**
 * The other half of P-11.
 *
 * Keeping a malformed entry without telling anyone means the bad entry
 * sits there forever and the ordering quietly stops meaning anything.
 * The same scan feeds `doctor` and sync pre-flight.
 *
 * The severity split is the load-bearing part:
 *
 *   unreadable — cannot vouch for the contents. Blocks a publish.
 *   malformed  — kept and merged, data intact. Reported, never blocks.
 *
 * Blocking on a malformed entry would make one hand-edit typo render a
 * tracker unpublishable, which is destruction by another route.
 */

const AUTHOR = "01J0000000000000000000USER";
const TASK_ID = "01J0000000000000000000TASK";
let dir: string;

function commentsPath(): string {
  return join(dir, "tasks", TASK_ID, "_comments.yaml");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-integrity-"));
  await mkdir(join(dir, "tasks", TASK_ID), { recursive: true });
});

afterEach(async () => {
  await chmod(commentsPath(), 0o644).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

async function seed(bodies: string[]): Promise<void> {
  for (const body of bodies) {
    await postComment({ locttDir: dir, taskId: TASK_ID, body, author: AUTHOR });
  }
}

async function insertMalformed(): Promise<void> {
  const raw = parseYaml(await readFile(commentsPath(), "utf-8")) as { comments: unknown[] };
  raw.comments.splice(1, 0, { note: "hand-edited, not a comment" });
  await writeFile(commentsPath(), stringifyYaml(raw), "utf-8");
}

describe("a clean tracker reports nothing", () => {
  it("finds nothing when every thread reads", async () => {
    await seed(["first", "second"]);
    expect(await checkDataIntegrity(dir)).toEqual([]);
  });

  it("finds nothing when a task has no comments at all", async () => {
    // An absent thread is a real state, not a finding — otherwise every
    // fresh task would be reported as damaged.
    expect(await checkDataIntegrity(dir)).toEqual([]);
  });
});

describe("a malformed entry is reported but does not block", () => {
  // @verifies DEG-18
  it("names the file and the entry position", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("malformed");
    expect(findings[0]?.path).toContain("_comments.yaml");
    expect(findings[0]?.message).toContain("entry 2");
  });

  it("says the entry is preserved, so the user is not told to panic", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    const findings = await checkDataIntegrity(dir);
    expect(findings[0]?.message).toMatch(/kept in place/i);
  });

  it("is not blocking", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    // The rule that matters: a hand-edit typo must not make the tracker
    // unpublishable. The data is intact and merges correctly.
    expect(blockingFindings(await checkDataIntegrity(dir))).toEqual([]);
  });
});

describe("history rows are reported too, not only comments", () => {
  it("reports a row with an unrecognised kind", async () => {
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    const rows = parseYaml(await readFile(historyPath, "utf-8")) as unknown[];
    rows.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath, stringifyYaml(rows), "utf-8");

    // History reporting was added after this file was written and was
    // never covered here: suppressing it entirely left all nine tests
    // green. Found by mutation 2026-08-17.
    const findings = await checkDataIntegrity(dir);
    const history = findings.filter(f => f.path.endsWith("_history.yaml"));
    expect(history).toHaveLength(1);
    expect(history[0]?.severity).toBe("malformed");
    expect(history[0]?.message).toContain("history entry 2");
  });

  it("does not block a publish on one", async () => {
    // Same rule as a malformed comment: the row is kept and merged, so
    // the data is intact and publishing it is safe.
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    const rows = parseYaml(await readFile(historyPath, "utf-8")) as unknown[];
    rows.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath, stringifyYaml(rows), "utf-8");

    expect(blockingFindings(await checkDataIntegrity(dir))).toEqual([]);
  });

  // @verifies DEG-18
  it("reports an unreadable history file as blocking", async () => {
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    await chmod(historyPath, 0o000);

    const findings = await checkDataIntegrity(dir);
    const history = findings.filter(f => f.path.endsWith("_history.yaml"));
    expect(history[0]?.severity).toBe("unreadable");
    expect(blockingFindings(findings)).toHaveLength(1);

    await chmod(historyPath, 0o644);
  });
});

describe("an unreadable file is reported and blocks", () => {
  it("reports the file it could not read", async () => {
    await seed(["first"]);
    await chmod(commentsPath(), 0o000);

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("unreadable");
    expect(findings[0]?.path).toContain("_comments.yaml");
  });

  it("blocks, because a publish would mirror content nobody read", async () => {
    await seed(["first"]);
    await chmod(commentsPath(), 0o000);

    // Publishing here turns one machine's damage into everyone's.
    expect(blockingFindings(await checkDataIntegrity(dir))).toHaveLength(1);
  });

  it("reports a file that will not parse as unreadable too", async () => {
    await writeFile(commentsPath(), "comments: [unclosed\n", "utf-8");

    const findings = await checkDataIntegrity(dir);
    expect(findings[0]?.severity).toBe("unreadable");
    expect(blockingFindings(findings)).toHaveLength(1);
  });
});

describe("task frontmatter field-health (Phase-7 § 10)", () => {
  function taskPath(id: string): string {
    return join(dir, "tasks", id, "task.md");
  }
  async function seedTaskFile(id: string, extraFm: string): Promise<void> {
    await mkdir(join(dir, "tasks", id), { recursive: true });
    const fm =
      `id: ${id}\nkey: T-9\ntitle: T\n`
      + `created_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n`
      + extraFm;
    await writeFile(taskPath(id), `---\n${fm}---\nBody.\n`, "utf-8");
  }

  // @verifies DEG-26
  it("reports a field-local corruption as non-blocking malformed", async () => {
    const id = "01J000000000000000000FLD1";
    await seedTaskFile(id, "due_date: 42\n");
    const findings = await checkDataIntegrity(dir);
    const fm = findings.find(f => f.path === taskPath(id));
    expect(fm?.severity).toBe("malformed");
    expect(fm?.message).toMatch(/due_date/);
    // Malformed never blocks a publish.
    expect(blockingFindings(findings)).toHaveLength(0);
  });

  // @verifies DEG-26
  it("reports an object-fatal task.md as unreadable (blocks publish)", async () => {
    const id = "01J000000000000000000FLD2";
    // Unparseable YAML — object-fatal.
    await mkdir(join(dir, "tasks", id), { recursive: true });
    await writeFile(taskPath(id), `---\nid: ${id}\nkey: T-8\ntitle: "unterminated\n---\nB\n`, "utf-8");
    const findings = await checkDataIntegrity(dir);
    const fm = findings.find(f => f.path === taskPath(id));
    expect(fm?.severity).toBe("unreadable");
    expect(blockingFindings(findings).length).toBeGreaterThan(0);
  });
});

describe("the two severities stay distinguishable", () => {
  it("reports both without collapsing them", async () => {
    // One task with a malformed entry, one unreadable.
    await seed(["first", "third"]);
    await insertMalformed();

    const otherTask = "01J000000000000000000TSK2";
    await mkdir(join(dir, "tasks", otherTask), { recursive: true });
    await postComment({ locttDir: dir, taskId: otherTask, body: "x", author: AUTHOR });
    await chmod(join(dir, "tasks", otherTask, "_comments.yaml"), 0o000);

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.severity).sort()).toEqual(["malformed", "unreadable"]);
    // Only the unreadable one stops a publish.
    expect(blockingFindings(findings)).toHaveLength(1);

    await chmod(join(dir, "tasks", otherTask, "_comments.yaml"), 0o644);
  });
});

describe("a degraded config entry is reported (A138 / K28)", () => {
  // A per-entry broken config marker is the config analogue of a
  // malformed comment: the entry is preserved and the rest of the file
  // loads, so nothing else surfaces it — doctor is where it must show up.
  // @verifies DEG-24
  it("names a broken sprint entry, malformed and non-blocking", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const root = await mkdtemp(join(tmpdir(), "loctt-cfg-broken-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      // One valid sprint + one hand-broken (name is a number, not a
      // string) — the loader degrades the bad one and keeps the good one.
      await writeFile(
        join(locttDir, "config/sprints.yaml"),
        "sprints:\n"
        + "  - id: s_ok\n    name: Sprint 1\n    start_date: 2026-01-01\n    end_date: 2026-01-14\n    state: active\n"
        + "  - id: s_bad\n    name: 5\n    start_date: 2026-01-15\n    end_date: 2026-01-28\n    state: future\n",
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const sprintFinding = findings.find(f => f.path.includes("sprints.yaml"));
      expect(sprintFinding).toBeDefined();
      expect(sprintFinding?.severity).toBe("malformed");
      expect(sprintFinding?.message).toContain("s_bad");
      expect(sprintFinding?.message).toMatch(/kept in place/i);
      // Preserved, so it never stops a publish.
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("calendar holidays and user profiles degrade and are reported too", () => {
  // @verifies DEG-24
  it("names a broken holiday, malformed and non-blocking", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const root = await mkdtemp(join(tmpdir(), "loctt-cal-broken-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      // Valid scalar fields + one good holiday + one broken (date is a
      // number). The loader degrades the bad holiday and keeps the rest.
      await writeFile(
        join(locttDir, "config/calendar.yaml"),
        "timezone: UTC\nfirst_day_of_week: 1\nworking_days: [1, 2, 3, 4, 5]\n"
        + "holidays:\n  - date: 2026-01-01\n    label: New Year\n  - date: 5\n    label: Bad\n",
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const cal = findings.find(f => f.path.includes("calendar.yaml"));
      expect(cal).toBeDefined();
      expect(cal?.severity).toBe("malformed");
      expect(cal?.message).toMatch(/holiday/i);
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // @verifies SET-24
  it("reports an unresolvable stored timezone as a malformed, non-blocking finding", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const root = await mkdtemp(join(tmpdir(), "loctt-cal-tz-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      // An unresolvable zone, hand-edited onto disk. The calendar loads
      // (SET-24: read tolerates it), but doctor must call it out. (Note a
      // *renamed* zone like America/Godthab still resolves via ICU
      // aliases, so it is not actually broken; a genuinely unknown string
      // is.)
      await writeFile(
        join(locttDir, "config/calendar.yaml"),
        "timezone: Mars/Olympus_Mons\nfirst_day_of_week: 1\nworking_days: [1, 2, 3, 4, 5]\nholidays: []\n",
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const tz = findings.find(
        f => f.path.includes("calendar.yaml") && /timezone/i.test(f.message),
      );
      expect(tz).toBeDefined();
      expect(tz?.severity).toBe("malformed");
      expect(tz?.message).toMatch(/Mars\/Olympus_Mons/);
      // A degraded config is not a publish blocker (it renders in UTC).
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // @verifies DEG-13
  it("names a corrupt user-profile field, malformed and non-blocking", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { mkdir: mkDir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "loctt-user-broken-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      const userId = "01HXXXXXXXXXXXXXXXXXXXXXXX";
      await mkDir(join(locttDir, "users", userId), { recursive: true });
      // Valid id + name, but an unknown timezone — degrades to health,
      // profile still loads (only id is object-fatal, K13).
      await writeFile(
        join(locttDir, "users", userId, "profile.yaml"),
        `id: ${userId}\nname: Ken\ntimezone: Mars/Olympus_Mons\n`,
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const user = findings.find(f => f.path.includes(userId));
      expect(user).toBeDefined();
      expect(user?.severity).toBe("malformed");
      expect(user?.message).toMatch(/timezone/i);
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // @verifies SHL-45 — a corrupt sidebar_groups is reported by doctor
  it("names a dropped sidebar_groups id, malformed and non-blocking", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { mkdir: mkDir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "loctt-sbgroups-doctor-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      const userId = "01HXXXXXXXXXXXXXXXXXXXXXXX";
      await mkDir(join(locttDir, "users", userId), { recursive: true });
      // A clean profile — the corruption under test is the setting, not
      // the profile (an absent profile.yaml would itself read unreadable).
      await writeFile(
        join(locttDir, "users", userId, "profile.yaml"),
        `id: ${userId}\nname: Ken\n`,
        "utf-8",
      );
      // A valid id kept, an unknown id dropped — salvaged on load, so the
      // sidebar still renders, but doctor must still name the drop.
      await writeFile(
        join(locttDir, "users", userId, "settings.yaml"),
        "theme: dark\nsidebar_groups:\n  order: [labels, bogus, projects]\n",
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const sg = findings.find(
        f => f.path.includes(userId) && /sidebar_groups/.test(f.message),
      );
      expect(sg).toBeDefined();
      expect(sg?.severity).toBe("malformed");
      expect(sg?.message).toMatch(/bogus/);
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // @verifies SHL-45 — a MALFORMED-shaped sidebar_groups is reported too
  // (fix-review finding 3: these used to salvage silently, doctor blind).
  it("names a scalar-instead-of-list sidebar_groups value, not silently dropped", async () => {
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { mkdir: mkDir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "loctt-sbgroups-malformed-"));
    try {
      await initLoctt(root, { docs: false });
      const locttDir = resolveLocttDir(root);
      const userId = "01HYYYYYYYYYYYYYYYYYYYYYYY";
      await mkDir(join(locttDir, "users", userId), { recursive: true });
      await writeFile(
        join(locttDir, "users", userId, "profile.yaml"),
        `id: ${userId}\nname: Ken\n`,
        "utf-8",
      );
      // The realistic typo: a single id written as a scalar, not a list.
      // The user thinks they hid Sprints; the value is unusable. Before the
      // fix this dropped silently and doctor called the file clean.
      await writeFile(
        join(locttDir, "users", userId, "settings.yaml"),
        "sidebar_groups:\n  order: [labels]\n  hidden: sprints\n",
        "utf-8",
      );

      const findings = await checkDataIntegrity(locttDir);
      const sg = findings.find(
        f => f.path.includes(userId) && /sidebar_groups\.hidden/.test(f.message),
      );
      expect(sg).toBeDefined();
      expect(sg?.severity).toBe("malformed");
      expect(blockingFindings(findings)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

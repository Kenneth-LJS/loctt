// Seed a demo LocTT tracker with a fixed, representative data set.
//
// The screenshots and GIFs in docs/assets are captured against this exact
// data, so re-running the capture reproduces the same images. Run it
// against a throwaway tracker directory (the capture script does this for
// you); it starts from `loctt init` and never touches a real tracker.
//
//   node tools/screenshots/seed.mjs <tracker-dir>

import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: node tools/screenshots/seed.mjs <tracker-dir>");
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = resolve(repo, "apps/cli/dist/index.js");

/** Run a loctt command against the demo tracker; return trimmed stdout. */
function loctt(...args) {
  return execFileSync("node", [CLI, ...args, "--root", root], {
    encoding: "utf8",
  }).trim();
}

// Start clean so the data set is deterministic.
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

loctt("init", "--prefix", "WEB", "--project-label", "Web App");

// People.
loctt("user", "create", "Jordan Lee", "--email", "jordan@example.com", "--switch");
loctt("user", "create", "Sam Okoro", "--email", "sam@example.com");
loctt("user", "create", "Alex Rivera", "--email", "alex@example.com");

// A second project.
loctt("project", "create", "Mobile App", "--prefix", "MOB");

// Labels (colors match the brand's semantic palette).
loctt("label", "create", "frontend", "--color", "#1868B0");
loctt("label", "create", "backend", "--color", "#356E1A");
loctt("label", "create", "urgent", "--color", "#B02F17");
loctt("label", "create", "design", "--color", "#7C3AED");

// A sprint and a milestone.
loctt("sprint", "create", "Sprint 12", "--start", "2026-09-21", "--end", "2026-10-04", "--state", "active", "--goal", "Ship auth + onboarding");
loctt("milestone", "create", "v1.0 Launch", "--target-date", "2026-11-15");

// Tasks — a spread of statuses, priorities, assignees, labels, and dates
// so the List, Board, and Timeline all look populated.
const tasks = [
  ["Fix login crash on empty password", ["--priority", "critical", "--type", "bug", "--status", "in_progress", "--assignee", "Jordan Lee", "--label", "frontend", "--label", "urgent", "--start", "2026-09-22", "--due", "2026-09-29"]],
  ["Add password reset email", ["--priority", "high", "--type", "story", "--status", "in_progress", "--assignee", "Sam Okoro", "--label", "backend", "--due", "2026-10-02"]],
  ["Rate-limit the API", ["--priority", "high", "--type", "story", "--status", "backlog", "--assignee", "Sam Okoro", "--label", "backend"]],
  ["Onboarding flow redesign", ["--priority", "medium", "--type", "story", "--status", "in_progress", "--assignee", "Alex Rivera", "--label", "design", "--label", "frontend", "--start", "2026-09-23", "--due", "2026-10-06"]],
  ["Dark mode toggle", ["--priority", "low", "--type", "feature", "--status", "done", "--assignee", "Alex Rivera", "--label", "frontend"]],
  ["Set up CI pipeline", ["--priority", "medium", "--type", "task", "--status", "done", "--label", "backend"]],
  ["Investigate slow dashboard", ["--priority", "medium", "--type", "task", "--status", "backlog", "--assignee", "Jordan Lee", "--label", "frontend"]],
  ["Keyboard shortcuts help dialog", ["--priority", "low", "--type", "feature", "--status", "backlog", "--label", "frontend"]],
];
for (const [title, args] of tasks) loctt("create", title, ...args);

const mobile = [
  ["Crash on Android 14 cold start", ["--priority", "critical", "--type", "bug", "--status", "in_progress", "--assignee", "Jordan Lee", "--label", "urgent", "--due", "2026-09-28"]],
  ["Push notification opt-in", ["--priority", "high", "--type", "story", "--status", "backlog", "--assignee", "Sam Okoro", "--label", "backend", "--due", "2026-10-08"]],
  ["Offline mode sync conflict", ["--priority", "high", "--type", "bug", "--status", "backlog", "--label", "backend"]],
  ["Biometric login", ["--priority", "medium", "--type", "feature", "--status", "backlog", "--start", "2026-09-30", "--due", "2026-10-10"]],
  ["App icon redesign", ["--priority", "low", "--type", "task", "--status", "done", "--assignee", "Alex Rivera", "--label", "design"]],
];
for (const [title, args] of mobile) loctt("create", title, "--project", "mobile-app", ...args);

// Sprint / milestone membership, a dependency, a subtask, a body, a comment.
loctt("set", "WEB-1,WEB-2,WEB-4", "sprint", "Sprint 12");
loctt("set", "WEB-1,WEB-2", "milestone", "v1.0 Launch");
loctt("link", "WEB-1", "is_blocked_by", "WEB-3");
loctt("link", "WEB-4", "parent", "WEB-8");
loctt("body", "WEB-1", "--set", "Steps to reproduce: submit the login form with an empty password. The auth callback throws on a null token.");
loctt("comment", "WEB-1", "Confirmed on staging. Root cause is the unhandled null in the auth callback.");

console.log(`Seeded demo tracker at ${root}`);

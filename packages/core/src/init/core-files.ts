import { readdir } from "node:fs/promises";

import { getProjectsConfigPath } from "../config/projects.js";
import { getStateFilePath, getTasksDir, getWorkflowConfigPath } from "../paths/index.js";
import { fileExists } from "../utils/fs.js";

/**
 * Files init writes that a healthy tracker must have. Only the ones
 * whose absence stops the tracker loading — an absent `queries.yaml`
 * costs saved views and nothing else, so it is not listed here.
 *
 * Shared by `initLoctt` (which decides between "already exists",
 * "needs repair", and "create fresh") and `getTrackerInfo` (which
 * decides whether a present `.loctt/` is an empty shell or a real
 * tracker). One definition rather than two, because those two
 * questions disagreeing is exactly the ONB-16 / SET-30 conflict: a
 * directory the info read calls "damaged" and init calls "empty"
 * leaves the user with a screen that offers no action that works.
 */
export async function missingCoreFiles(locttDir: string): Promise<string[]> {
  const required: [string, string][] = [
    ["config/workflow.yaml", getWorkflowConfigPath(locttDir)],
    ["config/projects.yaml", getProjectsConfigPath(locttDir)],
    ["state.yaml", getStateFilePath(locttDir)],
  ];
  const missing: string[] = [];
  for (const [label, path] of required) {
    if (!(await fileExists(path))) missing.push(label);
  }
  return missing;
}

/**
 * Whether a `.loctt/` directory holds nothing worth preserving.
 *
 * The cheap half of `initState`. `getTrackerInfo` can afford a full
 * task scan and three config parses; the web server's per-request
 * schema guard cannot — putting `getTrackerInfo` in that path made a
 * drag-and-drop assertion (SPR-6) fail outright, because every read
 * and every write paid for a directory walk it did not need.
 *
 * This answers the same question from `access` calls alone, and
 * short-circuits on the first sign of content:
 *
 *  - any core file present → not empty (there is configuration here)
 *  - any entry under `tasks/` → not empty (there is data here)
 *
 * What it deliberately does **not** do is distinguish `empty` from
 * `damaged`. That distinction decides what a *user* is offered, so it
 * is drawn in `getTrackerInfo`, once, where it is rendered.
 */
export async function isEmptyTracker(locttDir: string): Promise<boolean> {
  if ((await missingCoreFiles(locttDir)).length < 3) return false;
  try {
    const entries = await readdir(getTasksDir(locttDir));
    return entries.length === 0;
  } catch {
    // No `tasks/` directory at all: nothing there either.
    return true;
  }
}

import { getTrackerInfo, loadProjectsConfig, resolveLocttDir } from "@loctt/core";

/**
 * `loctt info` — prose summary of tracker state. Safe to run before
 * `loctt init`; prints a hint instead.
 *
 * The per-project counters block at the end is a best-effort
 * read of `projects.yaml`; missing-file is a no-op (fresh
 * tracker), but parse / permission errors surface.
 */
export async function run(_args: string[], root: string): Promise<void> {
  const info = await getTrackerInfo(root);
  if (!info.exists) {
    console.log("No .loctt directory found. Run 'loctt init' to get started.");
    return;
  }
  console.log(`LocTT directory: ${info.locttDir}`);
  console.log(`Tasks: ${info.taskCount}`);
  if (info.workflowConfig) {
    console.log(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
  }
  // Print per-project counters. Each line: "<key> [*]  <prefix><next_number>"
  // The asterisk marks the workspace default.
  try {
    const projects = await loadProjectsConfig(resolveLocttDir(root));
    if (projects.projects.length > 0) {
      console.log(``);
      console.log(`Projects:`);
      for (const p of projects.projects) {
        const counter = info.state?.keys[p.key];
        const star = projects.default === p.key ? " *" : "";
        const next = counter ? `${counter.prefix}${counter.next_number}` : `(no counter)`;
        console.log(`  ${p.key}${star}  ${p.label}  next: ${next}`);
      }
    }
  } catch (err) {
    // Missing projects.yaml is normal on a fresh tracker — skip
    // the per-project block silently. Parse / permission errors
    // are real and should surface.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

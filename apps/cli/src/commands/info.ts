import type { TrackerInfo } from "@loctt/core";
import { getTrackerInfo, loadProjectsConfig, resolveLocttDir } from "@loctt/core";

/**
 * `loctt info` — prose summary of tracker state. Safe to run before
 * `loctt init`; prints a hint instead.
 *
 * The per-project counters block at the end is a best-effort
 * read of `projects.yaml`; missing-file is a no-op (fresh
 * tracker), but parse / permission errors surface.
 */
/**
 * One line for each schema state, in the wording the UI banner uses so
 * a user who sees both is not left comparing two descriptions of one
 * condition.
 */
function describeSchema(status: TrackerInfo["schemaStatus"]): string {
  switch (status.kind) {
    case "current":
      return `${String(status.version)} (current)`;
    case "outdated":
      return `${String(status.on_disk)}, this build expects ${String(status.current)}`
        + ` — run 'loctt migrate'`;
    case "future":
      return `${String(status.on_disk)}, this build supports ${String(status.current)}`
        + ` — update LocTT`;
    case "missing":
      return `not recorded — this tracker predates schema versioning`;
    case "unknown":
      return `unreadable: ${status.message}`;
  }
}

export async function run(_args: string[], root: string): Promise<void> {
  const info = await getTrackerInfo(root);
  if (!info.exists) {
    console.log("No .loctt directory found. Run 'loctt init' to get started.");
    return;
  }
  console.log(`LocTT directory: ${info.locttDir}`);
  console.log(`Tasks: ${info.taskCount}`);
  // getTrackerInfo has always computed this and no surface printed it,
  // so the one command whose job is "what is this tracker" omitted the
  // fact that decides whether any other command will run (ONB-C5).
  console.log(`Schema: ${describeSchema(info.schemaStatus)}`);
  if (info.workflowConfig) {
    console.log(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
  }
  // Print per-project counters. Each line: "<name> [*]  <prefix><next_number>"
  // The asterisk marks the workspace default. Internal ids are not shown.
  try {
    const projects = await loadProjectsConfig(resolveLocttDir(root));
    if (projects.projects.length > 0) {
      console.log(``);
      console.log(`Projects:`);
      for (const p of projects.projects) {
        const counter = info.state?.keys[p.id];
        const star = projects.default === p.id ? " *" : "";
        const next = counter ? `${counter.prefix}${counter.next_number}` : `(no counter)`;
        console.log(`  ${p.name}${star}  next: ${next}`);
      }
    }
  } catch (err) {
    // Missing projects.yaml is normal on a fresh tracker — skip
    // the per-project block silently. Parse / permission errors
    // are real and should surface.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

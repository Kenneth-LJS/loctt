import { loadCalendarConfig, resolveLocttDir } from "@loctt/core";

import { EXIT } from "../runtime/errors.js";

/**
 * `loctt calendar <subcommand>` — read-only calendar view. Today
 * the only subcommand is `show`; the dispatcher matches the
 * structure of the other entity commands so adding edit/set in
 * the future doesn't require restructuring.
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  if (sub === "show") {
    const cfg = await loadCalendarConfig(locttDir);
    console.log(`Timezone:          ${cfg.timezone}`);
    console.log(`First day of week: ${cfg.first_day_of_week} (0=Sun)`);
    console.log(`Working days:      ${cfg.working_days.join(", ")}`);
    if (cfg.holidays.length === 0) {
      console.log(`Holidays:          (none)`);
    } else {
      console.log(`Holidays:`);
      for (const h of cfg.holidays) {
        console.log(`  ${h.date}  ${h.label}`);
      }
    }
  } else {
    console.error(`Usage: loctt calendar show`);
    process.exitCode = EXIT.USAGE;
  }
}

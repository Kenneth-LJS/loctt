import { loadCalendarConfig, resolveLocttDir } from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt calendar <subcommand>` — read-only calendar view. Today
 * the only subcommand is `show`; the dispatcher matches the
 * structure of the other entity commands so adding edit/set in
 * the future doesn't require restructuring.
 */
const ACCEPTED_FLAGS: readonly string[] = [];

export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0 — `loctt git publish --frce` reported success
  // while pushing nothing the user asked for.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
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
    // A bare "Usage:" line tells someone who just typed
    // `calendar set timezone UTC` that they got the syntax wrong, and
    // sends them looking for the right flags — there aren't any. The
    // calendar is read-only here, and the message has to say so and
    // name the surface that can edit it, or the next attempt is the
    // same one. The wording tracks the MCP `get_calendar` description
    // (CFG-C5: the two must agree on *where* it is editable).
    console.error(`Usage: loctt calendar show`);
    console.error(
      `The calendar is read-only from the CLI — it is configured in the web UI (run 'loctt ui').`,
    );
    process.exitCode = EXIT.USAGE;
  }
}

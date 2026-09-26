import type { ShortcutId, SidebarGroups, SidebarItemId } from "@loctt/contracts";
import {
  applyArchivedScope,
  applyShortcutChanges,
  archiveUser,
  countUserReferences,
  createUser,
  deleteUser,
  filterByName,
  getCurrentUser,
  loadAllUsers,
  loadOptionalConfigs,
  loadUserSettings,
  readKeyboardShortcuts,
  readSidebarGroups,
  readSidebarPins,
  resolveKeyboardShortcuts,
  resolveLocttDir,
  resolveRenderedSidebarItems,
  resolveUserRef,
  saveUserSettings,
  SHORTCUT_VALID_IDS,
  SIDEBAR_VALID_IDS,
  sweepSidebarPins,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  UserError,
  validateShortcutIds,
  validateSidebarIds,
  withKeyboardShortcuts,
} from "@loctt/core";

import { getArg, getArgAll, hasFlag, parseArchivedScope, positional, rejectUnknownFlags } from "../runtime/args.js";
import { getConfigPagination, getFilterArg, pageConfigList, truncationNotice } from "../runtime/config-list.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt user <subcommand>` — user lifecycle + switch-current.
 *
 * `delete` is the only entity whose body has two confirm-style
 * pre-checks (--remap-to / --unassign mutex AND the destructive
 * prompt). Both stay outside runCommand because their outcomes
 * carry their own exit-code semantics.
 */
/**
 * Flags this command family accepts. A union across its
 * subcommands: they share one argv, so splitting per subcommand
 * would reject a sibling's valid flag.
 *
 * Without this an unrecognised flag was silently dropped — the
 * reference documented `--label` on project create for a flag the
 * CLI never read, so the worked example created a project named
 * `web` and discarded the label (PRU-C9).
 */
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--archived", "--avatar", "--email", "--filter", "--hidden", "--limit", "--name", "--off", "--offset", "--on", "--order", "--remap-to", "--remove-avatar", "--reset", "--single-key", "--sweep-pins", "--switch", "--timezone", "--unassign", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const scope = parseArchivedScope(args);
      const users = await loadAllUsers(locttDir);
      const current = await getCurrentUser(locttDir);
      // K90/K107 order (matching the web `handleListUsers`): archived
      // scope, then name filter, then page. Default scope `active` hides
      // archived; `--archived archived|all` (and the deprecated `--all`
      // alias) widen it.
      const visible = applyArchivedScope(users, scope);
      const matched = filterByName(visible, getFilterArg(args));
      const page = pageConfigList(matched, getConfigPagination(args));
      for (const u of page.items) {
        const star = current?.id === u.id ? " *" : "";
        const arch = u.archived === true ? " (archived)" : "";
        const email = u.email ? `  <${u.email}>` : "";
        console.log(`${u.id}${star}\t${u.name}${arch}${email}\t${u.timezone}`);
      }
      const notice = truncationNotice(page);
      if (notice !== undefined) console.log(notice);
      break;
    }
    case "current": {
      const current = await getCurrentUser(locttDir);
      if (!current) {
        // stderr, not stdout: this exits non-zero, so it is a failure,
        // and a script doing `loctt user current | cut -f2` would
        // otherwise read "(no users registered)" as if it were a name.
        console.error("Error: no users registered. Run 'loctt user create <name>'.");
        process.exitCode = EXIT.RUNTIME;
        break;
      }
      console.log(`${current.id}\t${current.name}`);
      break;
    }
    case "switch": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing user ref", "loctt user switch <id-or-name>");
        }
        const target = await resolveUserRef(locttDir, ref);
        await switchCurrentUser(locttDir, target.id);
        console.log(`Switched to ${target.name} (${target.id})`);
      });
      break;
    }
    case "create": {
      await runCommand(async () => {
        // A flag here is a mistyped name, not a name. See
        // `positional`: `--name "X"` used to create an entity
        // literally called `--name`, silently, exit 0.
        const name = positional(args, 2, "loctt user create <name> [--email <e>] [--timezone <tz>] [--avatar <path>] [--switch]");
        if (!name) {
          throw new UsageError(
            "missing name",
            "loctt user create <name> [--email <e>] [--timezone <tz>] [--avatar <path>] [--switch]",
          );
        }
        const email = getArg(args, "--email");
        const timezone = getArg(args, "--timezone");
        const avatarSourcePath = getArg(args, "--avatar");
        const switchToOnCreate = hasFlag(args, "--switch");
        const created = await createUser(locttDir, {
          name,
          ...(email !== undefined ? { email } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(avatarSourcePath !== undefined ? { avatarSourcePath } : {}),
          switchToOnCreate,
        });
        console.log(`Created user ${created.name} (${created.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing user ref",
            "loctt user edit <id-or-name> [--name <n>] [--email <e>] [--timezone <tz>] [--avatar <path>]",
          );
        }
        const target = await resolveUserRef(locttDir, ref);
        const name = getArg(args, "--name");
        const email = getArg(args, "--email");
        const timezone = getArg(args, "--timezone");
        const avatarSourcePath = getArg(args, "--avatar");
        const removeAvatar = hasFlag(args, "--remove-avatar");
        if (removeAvatar && avatarSourcePath !== undefined) {
          throw new UsageError(
            "--avatar and --remove-avatar are mutually exclusive",
            "loctt user edit <id-or-name> [--avatar <path> | --remove-avatar]",
          );
        }
        // An edit that names nothing to change reported "Updated" and
        // exited 0, which reads as confirmation that a rename landed.
        if (name === undefined && email === undefined
            && timezone === undefined && avatarSourcePath === undefined
            && !removeAvatar) {
          throw new UsageError(
            "nothing to change",
            "loctt user edit <id-or-name> [--name <n>] [--email <e>] [--timezone <tz>] [--avatar <path> | --remove-avatar]",
          );
        }
        await updateUser(locttDir, target.id, {
          ...(name !== undefined ? { name } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(avatarSourcePath !== undefined ? { avatarSourcePath } : {}),
          ...(removeAvatar ? { removeAvatar: true } : {}),
        });
        console.log(`Updated user ${target.id}`);
      });
      break;
    }
    /**
     * `loctt user settings [--sweep-pins]` — the per-user settings
     * file the web UI's Personal panels write (SET-11, SET-12,
     * SET-13).
     *
     * Core gained `readSidebarPins` / `sweepSidebarPins` for those
     * panels, and Ken's layer rule is that a core capability reaches
     * CLI and MCP too. Without this the sweep would exist only where
     * the web app could reach it.
     *
     * `--sweep-pins` performs SET-27's write: it drops pins whose
     * views are gone from `queries.yaml` and **names them** rather
     * than emptying quietly — the README's P7 amendment resolves
     * SET-13's "silently" in favour of the explaining cases.
     */
    case "settings": {
      await runCommand(async () => {
        const current = await getCurrentUser(locttDir);
        if (!current) {
          throw new UserError("no users registered. Run 'loctt user create <name>'.");
        }
        const settings = await loadUserSettings(locttDir, current.id);
        if (hasFlag(args, "--sweep-pins")) {
          const { queriesConfig } = await loadOptionalConfigs(locttDir);
          const existing = (queriesConfig?.queries ?? []).map(q => q.id);
          const sweep = sweepSidebarPins(readSidebarPins(settings), existing);
          if (!sweep.changed) {
            console.log("No stale sidebar pins.");
            return;
          }
          await saveUserSettings(locttDir, current.id, {
            ...settings,
            sidebar_pins: sweep.kept,
          });
          // Named, not counted: "removed 2 pins" tells the user
          // nothing they can act on.
          for (const id of sweep.removed) {
            console.log(`Removed pin ${id}: no such view in queries.yaml`);
          }
          return;
        }
        const entries = Object.entries(settings);
        if (entries.length === 0) {
          console.log("No personal settings.");
          return;
        }
        for (const [k, v] of entries) {
          // Nested UI-only keys (e.g. `list_view.filter_chips`) are
          // objects. `String(v)` renders them "[object Object]",
          // which tells the user nothing and is worse than the raw
          // value — JSON at least shows what is stored.
          const rendered =
            Array.isArray(v)
              ? v.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(",")
              : typeof v === "object" && v !== null
                ? JSON.stringify(v)
                : String(v);
          console.log(`${k}\t${rendered}`);
        }
      });
      break;
    }
    /**
     * `loctt user sidebar-groups [--order <ids>] [--hidden <ids>] [--reset]`
     * — read or set the per-user `sidebar_groups` setting (SHL-45).
     *
     * Ken's layer rule: the web sidebar-groups editor is a core
     * capability (`readSidebarGroups` / `resolveRenderedSidebarItems`), so it
     * reaches CLI and MCP too — an agent may configure the UI.
     *
     * With no flags it prints the resolved order (one id per line) with
     * a `hidden` marker, so a script sees exactly what the sidebar will
     * render. `--order` / `--hidden` take comma-separated ids; `--reset`
     * clears the setting back to the default (all groups, default order,
     * all visible). Unknown/duplicate ids are dropped (degrade) rather
     * than rejected, matching the reader.
     */
    case "sidebar-groups": {
      await runCommand(async () => {
        const current = await getCurrentUser(locttDir);
        if (!current) {
          throw new UserError("no users registered. Run 'loctt user create <name>'.");
        }
        const settings = await loadUserSettings(locttDir, current.id);
        const orderArg = getArg(args, "--order");
        const hiddenArg = getArg(args, "--hidden");
        const reset = hasFlag(args, "--reset");

        if (reset && (orderArg !== undefined || hiddenArg !== undefined)) {
          throw new UsageError(
            "--reset cannot be combined with --order/--hidden",
            "loctt user sidebar-groups [--order <ids> | --hidden <ids> | --reset]",
          );
        }

        // A mutation? Reset, or either list given.
        if (reset || orderArg !== undefined || hiddenArg !== undefined) {
          if (reset) {
            // Drop the key entirely — absent means default.
            const { sidebar_groups: _drop, ...rest } = settings;
            await saveUserSettings(locttDir, current.id, rest);
            console.log("Reset sidebar groups to the default order.");
            return;
          }
          // Start from the stored (tolerant) value so setting only one
          // list preserves the other.
          const stored = readSidebarGroups(settings);
          const next: SidebarGroups = { ...stored };
          if (orderArg !== undefined) {
            const order = parseIdList(orderArg, "--order");
            if (order.length > 0) next.order = order;
            else delete next.order;
          }
          if (hiddenArg !== undefined) {
            const hidden = parseIdList(hiddenArg, "--hidden");
            if (hidden.length > 0) next.hidden = hidden;
            else delete next.hidden;
          }
          await saveUserSettings(locttDir, current.id, {
            ...settings,
            sidebar_groups: next,
          });
        }

        // Always print the resolved state (after any write): every item
        // id (groups + built-in filters, so a hidden filter reads back,
        // SHL-45 B2 bug 3), resolved through the same grouped resolver
        // the web sidebar uses (A346) — the K125 migration of an older
        // stored order, the built-ins listed after the `filters` row,
        // and all of them hidden while that group is hidden.
        const after = readSidebarGroups(await loadUserSettings(locttDir, current.id));
        const resolved = resolveRenderedSidebarItems(after);
        for (const item of resolved) {
          console.log(`${item.id}\t${item.hidden ? "hidden" : "visible"}`);
        }
      });
      break;
    }
    /**
     * `loctt user shortcuts [--single-key on|off] [--off <id>...] [--on <id>...] [--reset]`
     * — read or set the single-key shortcut switches (K133, A11Y-43).
     *
     * The web Keyboard settings are a core capability
     * (`resolveKeyboardShortcuts` / `applyShortcutChanges`), so they reach
     * the CLI too. With no flags it prints the state: the master switch,
     * then one line per shortcut with its keys, `on`/`off` and what it
     * does. `--off`/`--on` repeat, or take comma-separated ids. An
     * unknown id is refused, naming it. `--reset` turns everything back
     * on (the web "Reset to default").
     */
    case "shortcuts": {
      await runCommand(async () => {
        const current = await getCurrentUser(locttDir);
        if (!current) {
          throw new UserError("no users registered. Run 'loctt user create <name>'.");
        }
        const usage = "loctt user shortcuts [--single-key on|off] [--off <id>...] [--on <id>...] [--reset]";
        const settings = await loadUserSettings(locttDir, current.id);
        const singleKeyArg = getArg(args, "--single-key");
        const offArg = getArgAll(args, "--off");
        const onArg = getArgAll(args, "--on");
        const reset = hasFlag(args, "--reset");

        if (reset && (singleKeyArg !== undefined || offArg.length > 0 || onArg.length > 0)) {
          throw new UsageError("--reset cannot be combined with --single-key/--off/--on", usage);
        }
        let singleKey: boolean | undefined;
        if (singleKeyArg !== undefined) {
          const v = singleKeyArg.toLowerCase();
          if (v === "on" || v === "true") singleKey = true;
          else if (v === "off" || v === "false") singleKey = false;
          else throw new UsageError(`invalid value for --single-key: ${JSON.stringify(singleKeyArg)}. Expected on or off.`, usage);
        }

        if (reset) {
          await saveUserSettings(locttDir, current.id, withKeyboardShortcuts(settings, {}));
        } else if (singleKey !== undefined || offArg.length > 0 || onArg.length > 0) {
          const off = parseShortcutIds(offArg, "--off", usage);
          const on = parseShortcutIds(onArg, "--on", usage);
          const next = applyShortcutChanges(readKeyboardShortcuts(settings), {
            ...(singleKey !== undefined ? { singleKey } : {}),
            off,
            on,
          });
          await saveUserSettings(locttDir, current.id, withKeyboardShortcuts(settings, next));
        }

        // Always print the state read back from disk, after any write.
        const state = resolveKeyboardShortcuts(
          readKeyboardShortcuts(await loadUserSettings(locttDir, current.id)),
        );
        console.log(`single-key\t${state.singleKey ? "on" : "off"}`);
        for (const s of state.shortcuts) {
          const keys = s.bindings.map(b => b.keys.join(" ")).join(", ");
          console.log(`${s.id}\t${keys}\t${s.on ? "on" : "off"}\t${s.action}`);
        }
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing user ref", `loctt user ${sub} <id-or-name>`);
        }
        const target = await resolveUserRef(locttDir, ref);
        if (sub === "archive") await archiveUser(locttDir, target.id);
        else await unarchiveUser(locttDir, target.id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} user ${target.name}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing user ref`);
        console.error(`Usage: loctt user delete <id-or-name> [--remap-to <id-or-name> | --unassign] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapToRef = getArg(args, "--remap-to");
      const unassign = hasFlag(args, "--unassign");
      if (remapToRef !== undefined && unassign) {
        console.error("Error: --remap-to and --unassign are mutually exclusive");
        process.exitCode = EXIT.USAGE;
        break;
      }
      // Confirm prompt has its own exit-code semantics (refused
      // = usage, no = success), so it stays outside runCommand.
      // Resolve the user ref outside the wrapper too so we can
      // include the human-readable name in the prompt.
      let target;
      try {
        target = await resolveUserRef(locttDir, ref);
      } catch (err) {
        if (err instanceof UserError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        throw err;
      }
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete user ${target.name} (${target.id})? ` +
        `This will rewrite affected tasks. ` +
        `(use 'loctt user archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const remapTo = remapToRef !== undefined
          ? (await resolveUserRef(locttDir, remapToRef)).id
          : undefined;
        const result = await deleteUser(locttDir, target.id, {
          ...(remapTo !== undefined ? { remapTo } : {}),
          ...(unassign ? { unassign: true } : {}),
        });
        if (result.remappedAssigneeCount + result.remappedReporterCount > 0) {
          console.log(
            `Updated ${result.remappedAssigneeCount} assignee(s) and ` +
            `${result.remappedReporterCount} reporter(s)`,
          );
        }
        console.log(`Deleted user ${target.name}`);
      });
      break;
    }
    case "references": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing user ref`);
        console.error(`Usage: loctt user references <id-or-name>`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      await runCommand(async () => {
        // Read-only parity for the web delete confirmation (PRU-42):
        // the reference count split by role, before any delete.
        const target = await resolveUserRef(locttDir, ref);
        const counts = await countUserReferences(locttDir, target.id);
        console.log(
          `${target.name}\tassignee ${String(counts.assignee)}\treporter ${String(counts.reporter)}`,
        );
      });
      break;
    }
    default:
      console.error(`Usage: loctt user <list|current|switch|create|edit|settings|sidebar-groups|shortcuts|archive|unarchive|references|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}

/**
 * Parses a comma-separated id list for `--order` / `--hidden` on the
 * WRITE path, **rejecting** an unknown id rather than silently dropping
 * it (SHL-45, B2 bug 4). A typo used to write nothing and exit 0 — the
 * user thought they hid a group and nothing happened. The error names
 * the bad id(s) and lists the valid ones. Duplicates are folded silently
 * (they carry no typo signal and the schema de-dups anyway).
 */
function parseIdList(raw: string, flag: string): SidebarItemId[] {
  const parts = raw.split(",").map(s => s.trim()).filter(s => s !== "");
  const { known, unknown } = validateSidebarIds(parts);
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown sidebar id${unknown.length > 1 ? "s" : ""} for ${flag}: `
      + `${unknown.join(", ")}. Valid ids: ${SIDEBAR_VALID_IDS.join(", ")}`,
      "loctt user sidebar-groups [--order <ids> | --hidden <ids> | --reset]",
    );
  }
  return known;
}

/**
 * Parses `--off` / `--on` values (repeatable, each may be
 * comma-separated) on the WRITE path, refusing an unknown id. A typo
 * must not exit 0 having switched nothing off.
 */
function parseShortcutIds(values: readonly string[], flag: string, usage: string): ShortcutId[] {
  const parts = values.flatMap(v => v.split(",")).map(s => s.trim()).filter(s => s !== "");
  const { known, unknown } = validateShortcutIds(parts);
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown shortcut${unknown.length > 1 ? "s" : ""} for ${flag}: `
      + `${unknown.join(", ")}. Valid ids: ${SHORTCUT_VALID_IDS.join(", ")}`,
      usage,
    );
  }
  return known;
}

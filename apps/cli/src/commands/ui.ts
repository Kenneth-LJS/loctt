import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";
import { resolveClientDir } from "../runtime/schema-guard.js";

/**
 * `loctt ui` — start the web UI server (foreground). Prints the URL
 * and tries to auto-open the browser (suppressible with --no-open);
 * runs until SIGINT/SIGTERM.
 *
 * Loads @loctt/web lazily so the dep cost only applies when this
 * command is invoked. Browser-open failures are silenced by
 * default (the URL is already printed); LOCTT_DEBUG=1 surfaces the
 * spawn error for debugging.
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
const ACCEPTED_FLAGS: readonly string[] = ["--no-open", "--port"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const { createWebApp } = await import("@loctt/web");
  // `Number(x) || undefined` maps every unparseable value — "abc", "0",
  // "" — to "pick any free port", so a typo'd `--port` silently started
  // the server somewhere else and the user's bookmark did not work.
  // A port they named and did not get is a failure, not a default.
  const portArg = getArg(args, "--port");
  // `--port -1` arrives here as undefined: getArg reads a leading `-` as
  // the next flag, so a negative value looks identical to no flag at
  // all. Catch present-but-unread explicitly rather than starting on a
  // random port.
  if (portArg === undefined && args.includes("--port")) {
    throw new UsageError("--port needs an integer between 1 and 65535");
  }
  let port: number | undefined;
  if (portArg !== undefined) {
    port = Number(portArg);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UsageError(`--port must be an integer between 1 and 65535 (got '${portArg}')`);
    }
  }
  const noOpen = hasFlag(args, "--no-open");
  const clientDir = await resolveClientDir();
  // RR-B4 (A352): an install without the web client used to start
  // anyway and answer `/` with a 404, which reads as "LocTT is broken"
  // with no hint why. The client ships inside @loctt/cli, so its
  // absence means a damaged install; say so and stop.
  if (clientDir === undefined) {
    throw new Error("The web UI files are missing from this install. Reinstall @loctt/cli.");
  }
  const app = createWebApp({
    root,
    ...(port !== undefined ? { port } : {}),
    clientDir,
  });
  await app.start();
  const url = `http://localhost:${app.port}`;
  console.log(`LocTT UI running at ${url}`);
  console.log(`Press Ctrl-C to stop.`);

  if (!noOpen) {
    const opener =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "start" :
      "xdg-open";
    const { spawn } = await import("node:child_process");
    try {
      spawn(opener, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
    } catch (err) {
      // The browser-open is a nice-to-have, not the operation;
      // the URL is already printed above. Silent failure is
      // intentional for end users — but surface the cause
      // under LOCTT_DEBUG so it's debuggable when needed.
      if (process.env["LOCTT_DEBUG"] === "1") {
        console.error(`[loctt ui] failed to auto-open browser:`, err);
      }
    }
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => { resolve(); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  await app.stop();
}

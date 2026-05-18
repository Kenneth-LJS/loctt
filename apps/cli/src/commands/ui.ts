import { getArg, hasFlag } from "../runtime/args.js";
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
export async function run(args: string[], root: string): Promise<void> {
  const { createWebApp } = await import("@loctt/web");
  const port = Number(getArg(args, "--port")) || undefined;
  const noOpen = hasFlag(args, "--no-open");
  const clientDir = await resolveClientDir();
  const app = createWebApp({
    root,
    ...(port !== undefined ? { port } : {}),
    ...(clientDir !== undefined ? { clientDir } : {}),
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

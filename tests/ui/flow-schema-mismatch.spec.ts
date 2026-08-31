/**
 * A tracker whose schema this build cannot read must degrade to the
 * schema banner *inside* the shell — not hang on a spinner.
 *
 * This cannot be caught in vitest/jsdom. The loop it guards against is
 * a mount/unmount cycle driven by real fetch timing: an errored
 * `["info"]`, a second observer mounting on it from `ListView`, and
 * query-core's default `retryOnMount` resetting the query to "pending".
 * Under jsdom with a mocked fetch the round trip resolves inside the
 * same microtask batch, so the cycle either never forms or completes
 * faster than the test can sample it. Only a real browser against the
 * real server reproduces it, which is why this lives here.
 *
 * The fixture in `fixtures/tracker.ts` is deliberately not used: its
 * readiness probe waits for a 200 from `/api/info`, and every route on
 * this tracker answers 409 by design.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { execa } from "execa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close(() => { reject(new Error("could not determine a free port")); });
        return;
      }
      const { port } = addr;
      srv.close(() => { resolve(port); });
    });
  });
}

/** Waits for the server to answer at all — here that means a 409. */
async function waitForSchemaGuard(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "never answered";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/info`);
      if (res.status === 409) return;
      last = `status ${String(res.status)}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`schema guard never answered within ${String(timeoutMs)}ms: ${last}`);
}

// @verifies NEW-41
test("a future-schema tracker shows the banner in the shell, without looping", async ({ page }) => {
  const root = await mkdtemp(path.join(workspaceRoot, "loctt-schema-"));
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${String(port)}`;

  const cli = async (args: readonly string[]): Promise<void> => {
    const r = await execa(process.execPath, [cliEntry, ...args], { cwd: root, reject: false });
    if (r.exitCode !== 0) throw new Error(`loctt ${args.join(" ")} failed: ${r.stderr}`);
  };

  await cli(["init"]);
  // Claim a schema far newer than this build supports, so every `/api/`
  // route refuses with a 409 carrying `schema_status`.
  await writeFile(path.join(root, ".loctt", ".schema-version"), "9\n", "utf8");

  const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
    cwd: root,
    reject: false,
  });

  try {
    await waitForSchemaGuard(baseURL, 15_000);

    // Count `/api/info` requests for the whole page lifetime. Under the
    // loop this ran ~64 times a second; settled it is a small handful.
    let infoRequests = 0;
    page.on("request", req => {
      if (new URL(req.url()).pathname === "/api/info") infoRequests += 1;
    });

    await page.goto(`${baseURL}/list`);

    // 1. The banner is reachable at all, and names both versions.
    const banner = page.locator('[data-kind="future"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("9");
    await expect(banner).toContainText("1");

    // 2. It is inside the shell, not instead of it.
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();

    // 3. The spinner is gone and stays gone.
    await expect(page.getByText("Loading…")).toHaveCount(0);

    // 4. NEW-41: the create action does not offer a write that cannot
    // land. Every `/api/` route 409s in this state, so an enabled
    // button submits into nothing — measured before this assertion
    // existed: the button was enabled, `n` opened the modal, submit
    // enabled once a title was typed, and clicking it produced no
    // error and no POST.
    //
    // A45 recorded that "the shell never mounts and the modal cannot
    // open" and wrote no test on that basis. Assertion 2 above, in
    // this same test, disproves the premise — and SHL-13, XS-34 and
    // XS-35 all *require* the shell to stay up.
    const create = page.getByLabel("New task");
    await expect(create).toBeVisible();
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("title", /schema does not match/i);

    // 4. The page is *settled*. This is the assertion the bug fails:
    //    with the mount-refetch loop the shell never reaches a commit,
    //    so step 1 already times out — and if it somehow flickered
    //    into view, the request count would be in the hundreds.
    const settled = infoRequests;
    await page.waitForTimeout(3_000);
    const afterIdle = infoRequests - settled;
    expect(
      afterIdle,
      `/api/info was requested ${String(afterIdle)} more times while idle`,
    ).toBeLessThanOrEqual(1);

    // 5. And the DOM is not churning underneath it.
    const mutations = await page.evaluate(async () => {
      let n = 0;
      const target = document.getElementById("root");
      if (target === null) throw new Error("missing #root");
      const mo = new MutationObserver(records => { n += records.length; });
      mo.observe(target, { childList: true, subtree: true, characterData: true });
      await new Promise(r => setTimeout(r, 2_000));
      mo.disconnect();
      return n;
    });
    expect(mutations, `#root saw ${String(mutations)} mutations while idle`).toBeLessThan(20);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      child.catch(() => undefined),
      new Promise(r => setTimeout(r, 2_000)),
    ]);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

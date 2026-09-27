// Capture the docs screenshots and GIFs against a fixed demo tracker.
//
//   node tools/screenshots/capture.mjs
//
// It seeds a throwaway tracker (tools/screenshots/seed.mjs), starts the
// built web UI against it, then for both light and dark themes visits each
// documented view and writes a PNG to docs/assets/screenshots/<theme>/.
// It also records a couple of GIF walkthroughs with a simulated cursor.
//
// Prerequisites: `npm run build` (so apps/cli/dist exists) and ffmpeg on
// PATH (for GIF encoding). Re-running reproduces the same images.

import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installCursor, moveTo, click } from "./cursor.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = resolve(repo, "apps/cli/dist/index.js");
const TRACKER = resolve(repo, "tools/screenshots/.demo-tracker");
const OUT = resolve(repo, "docs/assets/screenshots");
const PORT = 7799;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };

const THEMES = ["light", "dark"];

// Each shot: an id (filename), the path to open, and an optional setup step
// run before the capture (open a menu, select rows, …).
const SHOTS = [
  { id: "list", path: "/list" },
  { id: "board", path: "/board" },
  { id: "timeline", path: "/timeline" },
  { id: "task-detail", path: "/tasks/WEB-1" },
  { id: "create", path: "/list", setup: async (page) => { await page.getByRole("button", { name: "New task" }).first().click(); await sleep(600); } },
  { id: "settings", path: "/settings/board-columns" },
];

function seed() {
  execFileSync("node", [resolve(repo, "tools/screenshots/seed.mjs"), TRACKER], { stdio: "inherit" });
}

function startUi() {
  const proc = spawn("node", [CLI, "ui", "--root", TRACKER, "--port", String(PORT), "--no-open"], {
    stdio: "ignore",
  });
  return proc;
}

async function waitForUi() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("UI did not come up on " + BASE);
}

/** Open a page in a given theme, with the theme pinned before first paint. */
async function openPage(context, theme) {
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("tt-theme", t);
    } catch {
      /* private mode */
    }
  }, theme);
  return page;
}

async function shoot(page, id, theme) {
  const dir = resolve(OUT, theme);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${id}.png`) });
}

/** Record a GIF walkthrough with the simulated cursor. */
async function recordWalkthrough(browser, theme) {
  const videoDir = resolve(OUT, ".video", theme);
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(videoDir, { recursive: true });

  // recordVideo is a CONTEXT option, so the recording gets its own context.
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: theme,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("tt-theme", t); } catch { /* */ } }, theme);

  await page.goto(`${BASE}/list`, { waitUntil: "networkidle" });
  await installCursor(page);
  await sleep(600);

  // A short tour: List → Board → Timeline → a task.
  await moveTo(page, 'a[href="/board"]');
  await sleep(300);
  await click(page, 'a[href="/board"]');
  await sleep(900);

  await click(page, 'a[href="/timeline"]');
  await sleep(900);

  await click(page, 'a[href="/list"]');
  await sleep(500);
  await click(page, 'text=Fix login crash on empty password');
  await sleep(1200);

  await context.close(); // finalizes the video
  const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no video recorded for " + theme);
  const src = resolve(videoDir, webm);
  const gif = resolve(OUT, `tour-${theme}.gif`);
  // ffmpeg webm → gif with a shared palette for clean colors.
  const palette = resolve(videoDir, "palette.png");
  // 10fps / 800px keeps the tour smooth while staying repo-friendly (~3 MB).
  const filters = "fps=10,scale=800:-1:flags=lanczos";
  execFileSync("ffmpeg", ["-y", "-i", src, "-vf", `${filters},palettegen=max_colors=128`, palette], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-i", src, "-i", palette, "-lavfi", `${filters}[x];[x][1:v]paletteuse`, gif], { stdio: "ignore" });
  console.log("wrote", gif);
}

async function main() {
  seed();
  const ui = startUi();
  try {
    await waitForUi();
    const browser = await chromium.launch();
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: theme,
        deviceScaleFactor: 2,
      });
      for (const shot of SHOTS) {
        const page = await openPage(context, theme);
        await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
        await sleep(700);
        if (shot.setup) await shot.setup(page);
        await shoot(page, shot.id, theme);
        await page.close();
        console.log(`shot ${theme}/${shot.id}.png`);
      }
      await context.close();
      await recordWalkthrough(browser, theme);
    }
    await browser.close();
  } finally {
    ui.kill();
    rmSync(resolve(OUT, ".video"), { recursive: true, force: true });
  }
  // Clean the throwaway tracker; the seed makes it reproducible anyway.
  rmSync(TRACKER, { recursive: true, force: true });
  console.log("done → docs/assets/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });

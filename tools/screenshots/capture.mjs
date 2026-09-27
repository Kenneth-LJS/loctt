// Capture the docs screenshots and GIFs against a fixed demo tracker.
//
//   node tools/screenshots/capture.mjs
//
// It seeds a throwaway tracker (tools/screenshots/seed.mjs), starts the
// built web UI against it, then for both light and dark themes visits each
// documented view and writes a PNG to docs/assets/screenshots/<theme>/.
// The hero GIF is then assembled from those stills (no screen recording),
// so it's a clean slideshow with no loading flashes.
//
// Prerequisites: `npm run build` (so apps/cli/dist exists) and ffmpeg on
// PATH (for GIF encoding). Re-running reproduces the same images.

import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
// cursor.mjs (a simulated pointer) is kept for interaction demos; the hero
// tour below is a plain pan across screens and doesn't need it.

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

// The views the hero GIF cycles through, in order.
const TOUR = ["list", "board", "timeline", "task-detail"];
const TOUR_SECONDS = 2.2; // how long each screen holds

/**
 * Build the hero GIF from the already-captured stills.
 *
 * No screen recording: each frame is a clean screenshot taken after the
 * page fully loaded, so the GIF is a crossfade-free slideshow with none of
 * the loading flashes a recording would catch. ffmpeg holds each still for
 * TOUR_SECONDS and loops.
 */
function buildTourGif(theme) {
  const dir = resolve(OUT, theme);
  const workDir = resolve(OUT, ".gifwork", theme);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // An ffconcat playlist: each still, held for TOUR_SECONDS. The last entry
  // is repeated without a duration so the final frame isn't dropped.
  const lines = ["ffconcat version 1.0"];
  for (const id of TOUR) {
    lines.push(`file '${resolve(dir, `${id}.png`)}'`, `duration ${TOUR_SECONDS}`);
  }
  lines.push(`file '${resolve(dir, `${TOUR[TOUR.length - 1]}.png`)}'`);
  const playlist = resolve(workDir, "playlist.ffconcat");
  writeFileSync(playlist, lines.join("\n"));

  const gif = resolve(OUT, `tour-${theme}.gif`);
  const palette = resolve(workDir, "palette.png");
  // 800px wide, ~15 colors-safe palette; the stills are static so a low fps
  // is fine and keeps the file small.
  const filters = "scale=800:-1:flags=lanczos,fps=10";
  execFileSync("ffmpeg", ["-y", "-safe", "0", "-i", playlist, "-vf", `${filters},palettegen=max_colors=128`, palette], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-safe", "0", "-i", playlist, "-i", palette, "-lavfi", `${filters}[x];[x][1:v]paletteuse`, "-loop", "0", gif], { stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
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
      // Assemble the hero GIF from the stills just captured — no recording.
      buildTourGif(theme);
    }
    await browser.close();
  } finally {
    ui.kill();
  }
  // Clean the throwaway tracker; the seed makes it reproducible anyway.
  rmSync(TRACKER, { recursive: true, force: true });
  console.log("done → docs/assets/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });

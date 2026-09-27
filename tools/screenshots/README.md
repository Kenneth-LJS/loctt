# Documentation screenshots

The images in `docs/assets/screenshots/` are generated, not hand-captured.
Regenerate them with:

```bash
npm run build          # so apps/cli/dist exists
node tools/screenshots/capture.mjs
```

Requires `ffmpeg` on `PATH` (for the GIF encoding) and Playwright's
Chromium (`npx playwright install chromium`).

## What it does

- **`seed.mjs`** seeds a throwaway tracker with a fixed, representative
  data set (two projects, three users, labels, a sprint, a milestone, and
  a spread of tasks). The screenshots depend on this exact data, so the
  output is reproducible.
- **`capture.mjs`** starts the built web UI against that tracker, then for
  both the light and dark themes visits each documented view and writes a
  2× PNG to `docs/assets/screenshots/<theme>/`. It also records a short
  tour (List → Board → Timeline → a task) as a GIF per theme, with a
  simulated cursor.
- **`cursor.mjs`** is the simulated cursor: a fake pointer element animated
  to each target, with the real Playwright click underneath, so the GIF
  shows the pointer gliding to a control and clicking it.

Output:

```
docs/assets/screenshots/
  light/  list.png board.png timeline.png task-detail.png create.png settings.png
  dark/   (same)
  tour-light.gif  tour-dark.gif
```

The docs reference light and dark variants through a `<picture>` element,
so GitHub serves the theme-matched image automatically.

## Adding a shot

Add an entry to the `SHOTS` array in `capture.mjs` (an `id`, a `path`, and
an optional `setup` step to open a menu or select rows before capturing),
then reference `docs/assets/screenshots/{light,dark}/<id>.png` from a doc.

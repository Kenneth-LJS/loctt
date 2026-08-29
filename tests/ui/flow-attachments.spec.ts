/**
 * Transcribed from docs/dev/ui-test-cases/flow-relationships.md —
 * M2.5b, the Attachments panel (REL-35..41).
 *
 * ## Files go in through the input, not through a synthetic drop
 *
 * The panel's drop handler and its file input both call the same
 * `send`, and `setInputFiles` gives a real `File` with a real byte
 * count — which is what REL-35's size check reads. A synthesised
 * `DataTransfer` built in `page.evaluate` would exercise the drop
 * *listener* and then hand `send` a file the page invented, which
 * is a weaker fixture for every case here except the dragover
 * styling, which no case asks about.
 *
 * ## Every write assertion reads the far end
 *
 * P1, and the README's rule. An attachment is a file in
 * `tasks/<id>/attachments/`, so "it uploaded" is a claim about that
 * directory and nothing else. Every case that claims a write reads
 * the directory — and REL-39's cancel path compares the **bytes**,
 * because "untouched" is not the same as "still present".
 */

import { mkdtemp, readdir, readFile, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Page } from "@playwright/test";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

/* ------------------------------------------------------------------ *
 * Reading the far end
 * ------------------------------------------------------------------ */

async function taskDir(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) {
      return path.join(tasksDir, id);
    }
  }
  throw new Error(`no task on disk with key ${key}`);
}

/** The names in `tasks/<id>/attachments/`, sorted. Empty when absent. */
async function stored(root: string, key: string): Promise<string[]> {
  const dir = path.join(await taskDir(root, key), "attachments");
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/** The bytes of one stored attachment. */
async function storedBytes(
  root: string,
  key: string,
  name: string,
): Promise<Buffer> {
  return readFile(path.join(await taskDir(root, key), "attachments", name));
}

/** History entry kinds recorded for a task, in file order. */
async function historyKinds(root: string, key: string): Promise<string[]> {
  const historyFile = path.join(await taskDir(root, key), "_history.yaml");
  let text: string;
  try {
    text = await readFile(historyFile, "utf8");
  } catch {
    return [];
  }
  return [...text.matchAll(/^\s*-?\s*kind:\s*(\S+)\s*$/gm)].flatMap(m =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/* ------------------------------------------------------------------ *
 * Driving the panel
 * ------------------------------------------------------------------ */

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("attachments-panel")).toBeVisible();
}

/**
 * A file to hand the input, as a path on disk.
 *
 * **Every fixture is a real file, not an in-memory buffer.**
 * Playwright refuses a buffer over 50 MB ("Cannot set buffer larger
 * than 50Mb") — which is exactly the size REL-35 needs — and it
 * refuses to mix paths and buffers in one `setInputFiles`, so a drop
 * containing an oversized file could not use buffers for its
 * neighbours either. Paths throughout, and the browser then reads a
 * real `File` whose `size` is the filesystem's number, which is what
 * the panel's cap check reads.
 *
 * The name is carried separately because a name like `../../etc/passwd`
 * (REL-36) cannot be a path component — it is written under a safe
 * basename and renamed in the `File` the browser sees.
 */
interface Upload {
  /** The path handed to `setInputFiles`. */
  readonly path: string;
  /** The name the browser should report, when it differs from the file's. */
  readonly as?: string;
}

/** A temp directory per call, cleaned up with the OS rather than by us. */
async function fixtureDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loctt-attach-fixture-"));
}

async function file(name: string, contents: string): Promise<Upload> {
  const dir = await fixtureDir();
  // A name with separators cannot be a path component; write it under
  // a flat stand-in and let the browser report the real one.
  const safe = name.replace(/[/\\]/g, "_");
  const target = path.join(dir, safe);
  await writeFile(target, contents, "utf8");
  return safe === name ? { path: target } : { path: target, as: name };
}

/**
 * A file of exactly `bytes` length. Sparse: `truncate` allocates no
 * blocks, so a 60 MB fixture costs nothing on disk while still
 * reporting 60 MB to `stat` and to the browser's `File.size`.
 */
async function sized(name: string, bytes: number): Promise<Upload> {
  const dir = await fixtureDir();
  const target = path.join(dir, name);
  await writeFile(target, "");
  await truncate(target, bytes);
  return { path: target };
}

/**
 * Hands files to the panel's input, which is what a drop reaches too.
 *
 * Returns immediately. Callers assert on the queue rows, which is
 * where every per-file outcome lands — waiting on a response here
 * would be wrong for the cases whose files never leave the browser.
 *
 * A fixture that needs a different reported name (REL-36's
 * `../../etc/passwd`) never reaches `setInputFiles`: a name with
 * separators is not a legal path component, and loading it under a
 * stand-in name first would fire a real upload of the stand-in before
 * the rename could land. Those files are built in the page from their
 * bytes instead, and the change event is dispatched once, with the
 * name the case is about.
 */
async function drop(page: Page, files: readonly Upload[]): Promise<void> {
  const input = page.getByTestId("attachment-input");
  if (files.every(f => f.as === undefined)) {
    await input.setInputFiles(files.map(f => f.path));
    return;
  }
  const payload = await Promise.all(
    files.map(async f => ({
      name: f.as ?? path.basename(f.path),
      bytes: [...(await readFile(f.path))],
    })),
  );
  await input.evaluate((el, items) => {
    const node = el as HTMLInputElement;
    const dt = new DataTransfer();
    for (const item of items as { name: string; bytes: number[] }[]) {
      dt.items.add(new File([new Uint8Array(item.bytes)], item.name));
    }
    node.files = dt.files;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, payload);
}

/** The queue row for a file, by the name it was sent under. */
function queueRow(page: Page, name: string) {
  return page.locator(`[data-testid="attachment-queue-item"][data-name="${name}"]`);
}

/** The grid tile for a stored attachment. */
function tile(page: Page, name: string) {
  return page.locator(`[data-testid="attachment-tile"][data-name="${name}"]`);
}

/**
 * Waits for every queue row to have left `pending`.
 *
 * The uploads are sequential, so the last row settles last — but
 * asserting on that row alone would pass while an earlier one was
 * still in flight, and the far-end read would then race it.
 *
 * **It does not assert.** A helper that failed the test on a timeout
 * would make every mutation red for the same reason — "the queue
 * never drained" — regardless of which behaviour was broken, which is
 * a red the assertions under test never got to produce. So it polls,
 * gives up quietly after the deadline, and lets the case's own
 * expectations decide. A genuine stall then surfaces as the specific
 * thing the case is about (a file missing from disk, a count that is
 * wrong) rather than as a timeout in shared plumbing.
 *
 * The deadline sits well below Playwright's own per-test timeout for
 * the same reason: overrunning it would put the failure back in this
 * helper. Twenty small uploads against a local server settle in about
 * a second, so ten is generous by an order of magnitude.
 */
async function settled(page: Page, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pending = page.locator('[data-testid="attachment-queue-item"][data-state="pending"]');
  while (Date.now() < deadline) {
    if (await pending.count() === 0) return;
    await page.waitForTimeout(100);
  }
}

/* ------------------------------------------------------------------ *
 * A. Happy path and the empty state
 * ------------------------------------------------------------------ */

// @verifies REL-41
test("REL-41: a task with no attachments shows a designed empty state naming both ways to add", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Nothing attached" }]);
  await openTask(page, tracker, t1 ?? "");

  // Nothing on disk, so this is the empty case and not a stale render.
  expect(await stored(tracker.root, t1 ?? "")).toEqual([]);

  const empty = page.getByTestId("attachments-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/no attachments/i);

  // "Not a blank rectangle and not an empty grid with no affordance":
  // both routes in are named, and the Upload control is real.
  const zone = page.getByTestId("attachment-dropzone");
  await expect(zone).toContainText(/drag files here/i);
  await expect(page.getByTestId("attachment-upload")).toBeVisible();
  await expect(page.getByTestId("attachment-upload")).toBeEnabled();
  // No grid at all rather than an empty one.
  await expect(page.getByTestId("attachment-grid")).toHaveCount(0);

  // And the state is a *state*: one upload replaces it with the grid.
  await drop(page, [await file("notes.txt", "hello")]);
  await settled(page);
  await expect(page.getByTestId("attachments-empty")).toHaveCount(0);
  await expect(tile(page, "notes.txt")).toBeVisible();
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["notes.txt"]);
});

/* ------------------------------------------------------------------ *
 * B. Edge cases
 * ------------------------------------------------------------------ */

// @verifies REL-35
test("REL-35: an oversized file is refused before any bytes are sent, naming the file, its size and the cap", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Big drop" }]);
  await openTask(page, tracker, t1 ?? "");

  // Every POST that leaves the page, so "before any bytes are
  // written" can be asserted rather than assumed.
  const posts: string[] = [];
  page.on("request", r => {
    if (r.method() === "POST" && r.url().includes("/attachments")) {
      posts.push(r.url());
    }
  });

  // 60 MB, past the 50 MB cap; and two ordinary files around it, so
  // the last bullet ("the rest of a multi-file drop still uploads")
  // is tested with the failure in the *middle*.
  await drop(page, [
    await file("before.txt", "a"),
    await sized("video.mp4", 60 * 1024 * 1024),
    await file("after.txt", "b"),
  ]);
  await settled(page);

  const refused = queueRow(page, "video.mp4");
  await expect(refused).toHaveAttribute("data-state", "failed");
  const message = await refused.getByTestId("attachment-queue-error").textContent();
  // The three things the case names, in the user's units — not
  // "52428800 bytes", which is what the server would have said.
  expect(message).toContain("video.mp4");
  expect(message).toContain("60 MB");
  expect(message).toContain("50 MB");
  expect(message).not.toContain("52428800");

  // Refused at the size check, not after a long upload: the oversized
  // file produced no request at all. Two files were legal, so two
  // POSTs — the count is what makes this a positive assertion rather
  // than a bare absence.
  expect(posts).toHaveLength(2);

  // Nothing partial or `.tmp` under attachments/, and the neighbours
  // both landed.
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["after.txt", "before.txt"]);

  // Named individually: its own row, its own failure line, and the
  // summary counts it apart from the two that worked.
  await expect(page.getByTestId("attachment-summary")).toHaveAttribute("data-uploaded", "2");
  await expect(page.getByTestId("attachment-summary")).toHaveAttribute("data-failed", "1");
});

// @verifies REL-36
test("REL-36: a filename with path separators is stored as a plain basename, inside the task's own directory", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Traversal" }]);
  const dir = await taskDir(tracker.root, t1 ?? "");
  await openTask(page, tracker, t1 ?? "");

  await drop(page, [await file("../../etc/passwd", "not really passwd")]);
  await settled(page);

  // Sanitised to a basename — the case allows refusal *or*
  // sanitisation, and this is the branch the server takes.
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["passwd"]);
  await expect(tile(page, "passwd")).toBeVisible();
  // No separators survived into the rendered name either.
  await expect(tile(page, "passwd").getByTestId("attachment-name")).toHaveText("passwd");

  // Nothing was written outside `tasks/<id>/attachments/`. Checking
  // the task directory's own contents and its grandparent covers both
  // the one-level and two-level escapes the name asked for.
  const inTask = (await readdir(dir)).sort();
  expect(inTask).not.toContain("passwd");
  expect(inTask).not.toContain("etc");
  const tasksParent = path.dirname(path.dirname(dir));
  expect(await readdir(tasksParent)).not.toContain("etc");

  // A dotfile is refused with a stated reason rather than stored.
  await drop(page, [await file(".bashrc", "export PATH=/tmp")]);
  await settled(page);
  const dotRow = queueRow(page, ".bashrc");
  await expect(dotRow).toHaveAttribute("data-state", "failed");
  await expect(dotRow.getByTestId("attachment-queue-error")).toContainText(/dotfile/i);
  // Still only the one legal attachment on disk.
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["passwd"]);
});

// @verifies REL-37
test("REL-37: a 255-character filename truncates without reflowing the grid or scrolling the page sideways", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Long name" }]);
  await openTask(page, tracker, t1 ?? "");

  // 255 characters exactly, extension included.
  const longName = `${"n".repeat(251)}.txt`;
  expect(longName).toHaveLength(255);

  // Two ordinary neighbours, so "neighbouring tiles do not reflow"
  // has something to be measured against.
  await drop(page, [await file("aaa.txt", "a"), await file("zzz.txt", "z")]);
  await settled(page);
  await expect(page.getByTestId("attachment-tile")).toHaveCount(2);

  const boxOf = async (name: string) => {
    const box = await tile(page, name).boundingBox();
    if (box === null) throw new Error(`no box for ${name}`);
    return box;
  };
  const beforeA = await boxOf("aaa.txt");
  const beforeZ = await boxOf("zzz.txt");
  const gridBefore = await page.getByTestId("attachment-grid").boundingBox();

  await drop(page, [await file(longName, "long")]);
  await settled(page);
  expect(await stored(tracker.root, t1 ?? "")).toContain(longName);
  const long = tile(page, longName);
  await expect(long).toBeVisible();

  // The tile keeps its grid dimensions: the long-named tile is the
  // same width as its neighbours, not a column of its own making.
  const longBox = await boxOf(longName);
  expect(Math.round(longBox.width)).toBe(Math.round(beforeA.width));

  // Neighbours did not reflow. `aaa.txt` sorts first so it keeps its
  // slot exactly; `zzz.txt` keeps its width and its row position.
  const afterA = await boxOf("aaa.txt");
  const afterZ = await boxOf("zzz.txt");
  expect(Math.round(afterA.width)).toBe(Math.round(beforeA.width));
  expect(Math.round(afterA.x)).toBe(Math.round(beforeA.x));
  expect(Math.round(afterA.y)).toBe(Math.round(beforeA.y));
  expect(Math.round(afterZ.width)).toBe(Math.round(beforeZ.width));
  expect(Math.round(afterZ.y)).toBe(Math.round(beforeZ.y));

  // The grid itself did not widen, and the page gained no horizontal
  // scrollbar — the failure a 255-character unbroken string causes.
  const gridAfter = await page.getByTestId("attachment-grid").boundingBox();
  expect(Math.round(gridAfter?.width ?? 0)).toBe(Math.round(gridBefore?.width ?? -1));
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // The full name is available on hover and to assistive tech even
  // though the visible text is clipped.
  const link = long.getByTestId("attachment-name");
  await expect(link).toHaveAttribute("title", longName);
  await expect(link).toHaveAttribute("aria-label", `Download ${longName}`);
  // Clipped rather than wrapped: the rendered box is narrower than
  // the text would need. (`truncate` is what keeps the height fixed.)
  const clipped = await link.evaluate(el => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);

  // Download still serves the full original name.
  const res = await page.request.get(
    `${tracker.baseURL}/api/tasks/${t1 ?? ""}/attachments/${encodeURIComponent(longName)}`,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain(encodeURIComponent(longName));
});

// @verifies REL-38
test("REL-38: a file with no extension gets a generic icon, no thumbnail, and downloads as octet-stream", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "No extension" }]);
  await openTask(page, tracker, t1 ?? "");

  // One extensionless file and one PNG, so "generic" is shown to be a
  // branch rather than the only thing this panel can render.
  await drop(page, [
    await file("Makefile", "all:\n\techo hi\n"),
    await file("shot.png", "\x89PNG\r\n\x1a\n"),
  ]);
  await settled(page);
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["Makefile", "shot.png"]);

  const plain = tile(page, "Makefile");
  await expect(plain).toHaveAttribute("data-family", "generic");
  await expect(tile(page, "shot.png")).toHaveAttribute("data-family", "image");

  // No image thumbnail is attempted — not for the extensionless file,
  // and the icon is a glyph rather than an <img> either way.
  await expect(plain.locator("img")).toHaveCount(0);
  await expect(plain.getByTestId("attachment-icon")).toBeVisible();

  // No MIME guess: the tile says octet-stream, which is what the
  // response contract says an absent `mime` means.
  await expect(plain).toHaveAttribute("data-mime", "application/octet-stream");
  await expect(plain).toContainText("application/octet-stream");

  // The filename displays exactly as uploaded — no extension appended,
  // no case folded.
  await expect(plain.getByTestId("attachment-name")).toHaveText("Makefile");

  // And the download serves it as application/octet-stream.
  const res = await page.request.get(
    `${tracker.baseURL}/api/tasks/${t1 ?? ""}/attachments/Makefile`,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/octet-stream");
});

// @verifies REL-39
test("REL-39: a colliding name asks first, and replace and cancel each do exactly what they say", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Collision" }]);
  await openTask(page, tracker, t1 ?? "");

  await drop(page, [await file("report.txt", "ORIGINAL")]);
  await settled(page);
  const original = await storedBytes(tracker.root, t1 ?? "", "report.txt");
  expect(original.toString()).toBe("ORIGINAL");
  const historyBefore = await historyKinds(tracker.root, t1 ?? "");

  /* --- cancel leaves the original byte-identical --- */

  await drop(page, [await file("report.txt", "CANCELLED-REPLACEMENT")]);
  await settled(page);

  // The user is told the name is taken, on this file's own row.
  const conflicted = queueRow(page, "report.txt").last();
  await expect(conflicted).toHaveAttribute("data-state", "conflict");
  await expect(conflicted.getByTestId("attachment-conflict")).toContainText(
    /report\.txt is already attached/i,
  );
  // The two choices are explicit, both offered, neither taken yet.
  await expect(conflicted.getByTestId("attachment-replace")).toBeVisible();
  await expect(conflicted.getByTestId("attachment-cancel")).toBeVisible();

  // Nothing overwrote silently while the question stood.
  expect(await storedBytes(tracker.root, t1 ?? "", "report.txt")).toEqual(original);

  // Two rows named report.txt stand at this point: the first upload's
  // `done` row and this conflicted one. Cancel removes exactly the
  // conflicted one, so the assertion is on the count and on the state
  // — `.last()` re-resolves after the removal and would happily find
  // the surviving `done` row.
  await expect(queueRow(page, "report.txt")).toHaveCount(2);
  await conflicted.getByTestId("attachment-cancel").click();
  await expect(queueRow(page, "report.txt")).toHaveCount(1);
  await expect(
    page.locator('[data-testid="attachment-queue-item"][data-state="conflict"]'),
  ).toHaveCount(0);

  // Byte-identical, not merely present.
  const afterCancel = await storedBytes(tracker.root, t1 ?? "", "report.txt");
  expect(afterCancel).toEqual(original);
  expect(afterCancel.toString()).toBe("ORIGINAL");
  // And no history was written for a write that did not happen.
  expect(await historyKinds(tracker.root, t1 ?? "")).toEqual(historyBefore);

  /* --- replace overwrites and records the change --- */

  await drop(page, [await file("report.txt", "REPLACEMENT")]);
  await settled(page);
  const second = queueRow(page, "report.txt").last();
  await expect(second).toHaveAttribute("data-state", "conflict");
  await second.getByTestId("attachment-replace").click();
  await settled(page);
  await expect(second).toHaveAttribute("data-state", "done");

  const afterReplace = await storedBytes(tracker.root, t1 ?? "", "report.txt");
  expect(afterReplace.toString()).toBe("REPLACEMENT");
  // One file, not two — the replace did not land beside the original.
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["report.txt"]);

  // The change is recorded in history: one more `attachment_added`
  // than before the replace, from the replace itself.
  const historyAfter = await historyKinds(tracker.root, t1 ?? "");
  expect(historyAfter.filter(k => k === "attachment_added")).toHaveLength(
    historyBefore.filter(k => k === "attachment_added").length + 1,
  );
});

// @verifies REL-40
test("REL-40: twenty files report per-file outcome, and a failure in the middle does not abort the rest", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Twenty" }]);
  await openTask(page, tracker, t1 ?? "");

  // One file already attached, so file 10 of the drop collides — the
  // failure is in the *middle*, which is the only arrangement that
  // can tell "kept going" from "happened to be last".
  await drop(page, [await file("f10.txt", "PRE-EXISTING")]);
  await settled(page);
  const preExisting = await storedBytes(tracker.root, t1 ?? "", "f10.txt");
  await page.getByTestId("attachment-queue-clear").click();

  // Twenty: eighteen ordinary, one that collides (f10), and one the
  // client refuses outright for size (f15) — two different failure
  // kinds, both mid-drop.
  const drop20: Upload[] = [];
  for (let n = 1; n <= 20; n += 1) {
    drop20.push(
      n === 15
        ? await sized("f15.mp4", 60 * 1024 * 1024)
        : await file(`f${String(n)}.txt`, `contents of ${String(n)}`),
    );
  }
  await drop(page, drop20);
  await settled(page);

  // Each file got its own row.
  await expect(page.getByTestId("attachment-queue-item")).toHaveCount(20);

  // The two mid-drop failures are named on their own rows.
  await expect(queueRow(page, "f10.txt")).toHaveAttribute("data-state", "conflict");
  await expect(queueRow(page, "f15.mp4")).toHaveAttribute("data-state", "failed");

  // Everything after them still landed — on disk, not on screen.
  // f10 is the collision (untouched, still the pre-existing bytes) and
  // f15 never left the browser, so eighteen new files plus f10.
  const onDisk = await stored(tracker.root, t1 ?? "");
  expect(onDisk).toHaveLength(19);
  for (let n = 1; n <= 20; n += 1) {
    if (n === 15) continue;
    expect(onDisk).toContain(`f${String(n)}.txt`);
  }
  expect(onDisk).not.toContain("f15.mp4");
  // Specifically: the ones *after* the middle failures are there with
  // their own contents, which is what "did not abort" means.
  expect((await storedBytes(tracker.root, t1 ?? "", "f16.txt")).toString())
    .toBe("contents of 16");
  expect((await storedBytes(tracker.root, t1 ?? "", "f20.txt")).toString())
    .toBe("contents of 20");
  // And the collision left its file alone.
  expect(await storedBytes(tracker.root, t1 ?? "", "f10.txt")).toEqual(preExisting);

  // The summary counts succeeded and failed separately, and does not
  // blend the unresolved collision into either.
  const summary = page.getByTestId("attachment-summary");
  await expect(summary).toHaveAttribute("data-uploaded", "18");
  await expect(summary).toHaveAttribute("data-failed", "1");
  await expect(summary).toContainText("18 uploaded, 1 failed");
  await expect(summary).toContainText("1 needing a decision");

  // Each success is a tile as well as a row: 19 attachments, 19 tiles.
  await expect(page.getByTestId("attachment-tile")).toHaveCount(19);
});

/* ------------------------------------------------------------------ *
 * C. Removal — not a numbered case, but the panel's other write
 * ------------------------------------------------------------------ */

test("removing an attachment deletes the file and records it, leaving its neighbours alone", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Remove one" }]);
  await openTask(page, tracker, t1 ?? "");
  await drop(page, [await file("keep.txt", "KEEP"), await file("drop.txt", "DROP")]);
  await settled(page);
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["drop.txt", "keep.txt"]);

  // The tile going is the settle signal, not a `waitForResponse` on a
  // specific URL: a mutation that sends the *wrong* name would then
  // fail on a wait timeout rather than on the file that is still there,
  // which is a red for the wrong reason.
  await tile(page, "drop.txt").getByTestId("attachment-remove").click();
  await expect(tile(page, "drop.txt")).toHaveCount(0, { timeout: 15_000 });
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["keep.txt"]);
  expect((await storedBytes(tracker.root, t1 ?? "", "keep.txt")).toString()).toBe("KEEP");
  expect(await historyKinds(tracker.root, t1 ?? "")).toContain("attachment_removed");
});

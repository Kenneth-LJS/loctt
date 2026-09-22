/**
 * Transcribed from tests/cases/ui-test-cases/flow-relationships.md —
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

import { chmod, mkdtemp, readdir, readFile, truncate, unlink, writeFile } from "node:fs/promises";
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

// @verifies REL-19
//
// Covers REL-19's second and third bullets: removal deletes the file
// and writes an `attachment_removed` history entry, and the tile goes
// without a reload. Its first bullet — the control appearing on hover
// AND on keyboard focus — is not asserted here; the control is always
// in the DOM, so a hover assertion would pass without proving the
// focus half. Left unclaimed rather than half-claimed.
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

// @verifies REL-20
test("REL-20: a download serves the original bytes, as an attachment, with nosniff", async ({
  page,
  tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Download me" }]);
  await openTask(page, tracker, t1 ?? "");

  // An `.svg` deliberately: it is the shape that makes this a security
  // case rather than a convenience one. Served inline with a sniffable
  // type, an uploaded SVG executes script in the app's own origin.
  await drop(page, [await file("payload.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>")]);
  await settled(page);

  const res = await page.request.get(
    `${tracker.baseURL}/api/tasks/${t1 ?? ""}/attachments/payload.svg`,
  );
  expect(res.status()).toBe(200);

  // The bytes are the ones uploaded — asserted first, so the header
  // checks below cannot pass over an empty or wrong response.
  expect(await res.text()).toContain("<svg");

  // Downloads rather than renders. Both halves matter: a disposition
  // without nosniff still lets a browser sniff its way to text/html.
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

// @verifies REL-48
test("REL-48: a delete the server refuses keeps the tile and names the reason", async ({
  page,
  tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Refused delete" }]);
  await openTask(page, tracker, t1 ?? "");
  await drop(page, [await file("locked.txt", "LOCKED")]);
  await settled(page);
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["locked.txt"]);

  // The server refuses. Intercepted rather than chmod'd: the point is
  // what the panel does with a refusal, and a real permission error
  // would make this test about the filesystem instead.
  await page.route(/\/attachments\//, route =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "io_failed",
            message: "locked.txt could not be removed: permission denied",
          }),
        })
      : route.continue());

  await tile(page, "locked.txt").getByTestId("attachment-remove").click();

  // The tile stays — bullet 1. Asserted with a real wait rather than
  // an immediate check, so a tile that vanishes and returns would
  // still fail.
  await expect(page.getByTestId("attachment-remove-error")).toContainText(/locked\.txt/);
  await expect(page.getByTestId("attachment-remove-error")).toContainText(/permission denied/i);
  await expect(tile(page, "locked.txt")).toHaveCount(1);

  // And the far end: the file is still on disk. A panel that removed
  // the tile optimistically and showed an error would pass the
  // message assertions and fail this one.
  expect(await stored(tracker.root, t1 ?? "")).toEqual(["locked.txt"]);
});

// @verifies REL-50
test("REL-50: downloading a since-deleted attachment names the file rather than serving nothing", async ({
  page,
  tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Vanished file" }]);
  await openTask(page, tracker, t1 ?? "");
  await drop(page, [await file("gone.txt", "GONE")]);
  await settled(page);

  // Removed underneath the open page — the case's own setup. The tile
  // is still rendered from the list the page already has.
  const dir = path.join(await taskDir(tracker.root, t1 ?? ""), "attachments");
  await unlink(path.join(dir, "gone.txt"));

  const res = await page.request.get(
    `${tracker.baseURL}/api/tasks/${t1 ?? ""}/attachments/gone.txt`,
  );

  // Not a zero-byte 200: the browser must not silently "download"
  // nothing, which is bullet 2 and the only part a user would notice
  // as data loss.
  expect(res.status()).not.toBe(200);
  const body = await res.text();
  expect(body).toContain("gone.txt");
});

// @verifies REL-49
test("REL-49: an unreadable attachments directory degrades only that section", async ({
  page,
  tracker,
}) => {
  const [key] = await tracker.seed([{ title: "Task with attachments" }]);
  if (key === undefined) throw new Error("seed returned no key");
  // A real attachment, so the directory is non-empty. The failure must
  // come from the read, not from there being nothing to read: an empty
  // directory and an unreadable one are exactly what this case is
  // about telling apart.
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await drop(page, [await file("drop.txt", "hello")]);
  await expect.poll(() => stored(tracker.root, key)).toEqual(["drop.txt"]);

  const dir = path.join(await taskDir(tracker.root, key), "attachments");
  await chmod(dir, 0o000);
  try {
    // Reload so the page re-reads the now-unreadable directory.
    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // The section names the failure. Asserting the error is present is
    // not enough on its own — the bug this covers rendered the *empty*
    // state, which is a specific false claim about the disk, so the
    // absence of that exact string is the load-bearing half.
    await expect(page.getByTestId("attachments-error")).toBeVisible();
    await expect(page.getByTestId("attachments-empty")).toHaveCount(0);

    // Degraded *only*: the rest of the task still renders. Without
    // this the case is satisfied by a page that error-states wholesale.
    await expect(page.getByRole("heading", { name: "Task with attachments", level: 1 }))
      .toBeVisible();
  } finally {
    // Restore, or the fixture cleanup cannot remove the directory.
    await chmod(dir, 0o755);
  }
});

/* ------------------------------------------------------------------ *
 * F. M2 gate, round 4 — tiles, drag-drop, and raw bytes (REL-16..18)
 *
 * REL-18 is the reason `sharp` appears in a test file. The case is
 * about bytes surviving a round trip unchanged, so the fixtures have
 * to be *real encoded images* with real pixel dimensions — a buffer
 * of random bytes named `.jpg` would satisfy a checksum comparison
 * while proving nothing about an image path that might re-encode.
 * ------------------------------------------------------------------ */

/**
 * A deterministic, poorly-compressible image of an exact size.
 *
 * Flat colour was the first attempt and was wrong: a 4000x3000 solid
 * fill encodes to 71 KB, so the "4.2 MB" the case names could not be
 * reached and the fixture would not have exercised a large upload at
 * all. Seeded pseudo-noise with a mild periodic component gives a file
 * in the right size class while staying byte-identical between runs,
 * which matters because the checksum assertions compare *this* file
 * against what landed on disk.
 */
async function imageFixture(
  name: string,
  format: "jpeg" | "png" | "gif" | "webp",
  width = 4000,
  height = 3000,
): Promise<Upload> {
  const { default: sharp } = await import("sharp");
  const px = Buffer.allocUnsafe(width * height * 3);
  let seed = 12_345;
  for (let i = 0; i < px.length; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    px[i] = ((seed >>> 16) & 0x3f) | ((i % 977) & 0xc0);
  }
  const img = sharp(px, { raw: { width, height, channels: 3 } });
  const buf = await (
    format === "jpeg" ? img.jpeg({ quality: 68 })
    : format === "png" ? img.png({ compressionLevel: 1 })
    : format === "gif" ? img.gif()
    : img.webp({ quality: 80 })
  ).toBuffer();
  const dir = await fixtureDir();
  const target = path.join(dir, name);
  await writeFile(target, buf);
  return { path: target };
}

/** SHA-256 of a file on disk. */
async function sha256(file: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

// @verifies REL-16
test("REL-16: the grid renders MIME-aware tiles with name, human size, and core's MIME", async ({
  page, tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Four kinds" }]);
  await openTask(page, tracker, t1 ?? "");

  /**
   * One of each family the case names, plus the unknown extension.
   *
   * The PNG is a *real* PNG rather than text named `.png`: the case is
   * about a type-aware tile, and a fixture whose bytes contradict its
   * extension would leave "the tile believed the extension" and "the
   * tile read the file" indistinguishable.
   */
  const png = await imageFixture("shot.png", "png", 120, 90);
  await drop(page, [
    png,
    await file("manual.pdf", "%PDF-1.4 not really a pdf, but named one"),
    await file("clip.mp4", "not really an mp4"),
    await file("mystery.xyz", "an extension core has never heard of"),
  ]);
  await settled(page);

  // The far end first: all four are actually attached, so the tiles
  // below are rendering stored files rather than optimistic rows.
  expect(await stored(tracker.root, t1 ?? ""))
    .toEqual(["clip.mp4", "manual.pdf", "mystery.xyz", "shot.png"]);

  /**
   * Bullet 4: the MIME shown matches **core's extension table**, and
   * an unknown extension is treated as `application/octet-stream`.
   *
   * Asserted against `mimeForFilename` itself rather than against
   * literals, so a tile that hard-coded "image/png" would still be
   * checked against the table that is supposed to be the source of
   * truth — and a table entry that changed would move both sides
   * together instead of failing here for the wrong reason.
   */
  const { mimeForFilename } = await import("@loctt/core");
  for (const name of ["shot.png", "manual.pdf", "clip.mp4", "mystery.xyz"]) {
    const expected = mimeForFilename(name) ?? "application/octet-stream";
    await expect(tile(page, name)).toHaveAttribute("data-mime", expected);
  }
  // The unknown extension resolves to octet-stream by that route, and
  // this pins the *value* so a table that grew an `.xyz` entry would
  // fail the case rather than silently change its meaning.
  expect(mimeForFilename("mystery.xyz")).toBeUndefined();
  await expect(tile(page, "mystery.xyz"))
    .toHaveAttribute("data-mime", "application/octet-stream");

  /**
   * Bullets 1 and 2, as the build actually renders them: the tile
   * dispatches on family, and the three non-image files get a type
   * icon rather than a broken image.
   *
   * The PNG's tile is `data-family="image"` — the image branch — but
   * it renders that family's *glyph*, not an inline thumbnail. The
   * case's first bullet ("shows an inline image thumbnail") is not
   * satisfied by this build; see known-gaps. What is asserted here is
   * the part that holds: each file reaches its own family, and
   * nothing renders a broken image.
   */
  await expect(tile(page, "shot.png")).toHaveAttribute("data-family", "image");
  await expect(tile(page, "manual.pdf")).toHaveAttribute("data-family", "pdf");
  await expect(tile(page, "clip.mp4")).toHaveAttribute("data-family", "video");
  await expect(tile(page, "mystery.xyz")).toHaveAttribute("data-family", "generic");

  // "a type icon, not a broken image" — the non-image tiles carry a
  // glyph and no img element at all. An img whose src 404s is exactly
  // the broken image the bullet forbids, so its absence is the check.
  for (const name of ["manual.pdf", "clip.mp4", "mystery.xyz"]) {
    await expect(tile(page, name).getByTestId("attachment-icon")).toHaveCount(1);
    await expect(tile(page, name).locator("img")).toHaveCount(0);
    await expect(tile(page, name).getByTestId("attachment-icon")).not.toBeEmpty();
  }

  /* --- Bullet 3: filename and a human-readable size on every tile --- */

  const { statSync } = await import("node:fs");
  for (const name of ["shot.png", "manual.pdf", "clip.mp4", "mystery.xyz"]) {
    await expect(tile(page, name).getByTestId("attachment-name")).toHaveText(name);
  }

  /**
   * "human-readable size" — a unit-bearing string, not a raw byte
   * count.
   *
   * The expected string is computed here rather than imported from
   * the client's `formatBytes`: `tests/ui` is its own TS project and
   * cannot reach across into `apps/web/src` (TS6059). Re-deriving it
   * is also the stronger check — importing the very function under
   * test would agree with any formatter, including a broken one, and
   * this way a tile that printed raw bytes fails.
   */
  const humanSize = (bytes: number): string => {
    if (bytes < 1024) return `${String(bytes)} B`;
    const units = ["KB", "MB", "GB", "TB"] as const;
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return `${String(rounded)} ${units[unit] ?? "B"}`;
  };
  const dir = path.join(await taskDir(tracker.root, t1 ?? ""), "attachments");
  for (const name of ["shot.png", "manual.pdf", "clip.mp4", "mystery.xyz"]) {
    const bytes = statSync(path.join(dir, name)).size;
    await expect(tile(page, name)).toContainText(humanSize(bytes));
  }
  // A megabyte-scale file reads in KB/MB rather than bytes — the
  // bullet's own example. Real noise, so the unit is not a rounding
  // accident of a tiny file.
  const big = await imageFixture("big.jpg", "jpeg", 1400, 1050);
  await drop(page, [big]);
  await settled(page);
  await expect(tile(page, "big.jpg")).toContainText(/\d+(\.\d)? (KB|MB)\b/);
  await expect(tile(page, "big.jpg")).not.toContainText(/\d{6,} B/);
});

// @verifies REL-17
test("REL-17: a real drag-drop attaches the file, and the browse control does the same", async ({
  page, tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Dropped in" }]);
  await openTask(page, tracker, t1 ?? "");

  const jpeg = await imageFixture("holiday.jpg", "jpeg", 2200, 1400);
  const jpegBytes = await readFile(jpeg.path);
  const zone = page.getByTestId("attachment-dropzone");

  /**
   * A genuine drag sequence, not `setInputFiles`.
   *
   * The rest of this file deliberately routes through the input, and
   * says why. REL-17 is the one case that cannot: "drag-drop upload
   * attaches the file" and "a drop target is indicated while dragging
   * over the panel" are claims about the dragover/drop listeners
   * specifically, and the input path never fires either. So the
   * DataTransfer is built in the page and the real events are
   * dispatched at the dropzone.
   */
  await page.evaluate(([name, bytes]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, {
      type: "image/jpeg",
    }));
    (window as unknown as { __dt: DataTransfer }).__dt = dt;
  }, ["holiday.jpg", [...jpegBytes]] as [string, number[]]);

  // Bullet 1: the drop target is indicated *while dragging over*.
  // Asserted between the dragover and the drop, which is the only
  // window in which it is true — checking after the drop would pass
  // against a panel that never highlighted at all.
  await expect(zone).toHaveAttribute("data-dragover", "false");
  await zone.dispatchEvent("dragover", {
    dataTransfer: await page.evaluateHandle(
      () => (window as unknown as { __dt: DataTransfer }).__dt),
  });
  await expect(zone).toHaveAttribute("data-dragover", "true");

  await zone.dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(
      () => (window as unknown as { __dt: DataTransfer }).__dt),
  });
  await settled(page);
  // The indication clears once the drag is over.
  await expect(zone).toHaveAttribute("data-dragover", "false");

  // Bullet 2: it appears in the grid with its original filename and size.
  await expect(tile(page, "holiday.jpg")).toHaveCount(1);
  await expect(tile(page, "holiday.jpg").getByTestId("attachment-name"))
    .toHaveText("holiday.jpg");

  /**
   * Bullet 3: the file lands at
   * `.loctt/tasks/<id>/attachments/<name>` — and the *bytes* are the
   * ones that were dragged.
   *
   * Reading the directory alone would pass for a file of the right
   * name and the wrong content, which is precisely the failure a drag
   * path can have: the DataTransfer carries the bytes, and a handler
   * that sent the wrong entry of a multi-file transfer would still
   * produce a plausibly-named file.
   */
  const dropped = path.join(
    await taskDir(tracker.root, t1 ?? ""), "attachments", "holiday.jpg");
  expect(await stored(tracker.root, t1 ?? "")).toContain("holiday.jpg");
  expect(await storedBytes(tracker.root, t1 ?? "", "holiday.jpg"))
    .toEqual(jpegBytes);
  const { statSync } = await import("node:fs");
  expect(statSync(dropped).size).toBe(jpegBytes.length);

  // …and an `attachment_added` history entry with the name and size.
  expect(await historyKinds(tracker.root, t1 ?? "")).toContain("attachment_added");
  const historyText = await readFile(
    path.join(await taskDir(tracker.root, t1 ?? ""), "_history.yaml"), "utf8");
  expect(historyText).toContain("holiday.jpg");
  expect(historyText).toContain(String(jpegBytes.length));

  /* --- Bullet 4: the Upload control produces the identical result --- */

  const [t2] = await tracker.seed([{ title: "Browsed in" }]);
  await openTask(page, tracker, t2 ?? "");
  await drop(page, [jpeg]);
  await settled(page);

  // "identical" compared as bytes and as history, not merely as a
  // filename that also showed up.
  expect(await stored(tracker.root, t2 ?? "")).toEqual(["holiday.jpg"]);
  expect(await storedBytes(tracker.root, t2 ?? "", "holiday.jpg"))
    .toEqual(jpegBytes);
  expect(await historyKinds(tracker.root, t2 ?? "")).toContain("attachment_added");
  await expect(tile(page, "holiday.jpg").getByTestId("attachment-name"))
    .toHaveText("holiday.jpg");
});

// @verifies REL-18
test("REL-18: attachments are stored raw — byte-identical, undimmed, across formats", async ({
  page, tracker,
}) => {
  const [t1] = await tracker.seed([{ title: "Raw bytes" }]);
  await openTask(page, tracker, t1 ?? "");

  /**
   * The case's own fixture: a ~4 MB JPEG at 4000x3000.
   *
   * Its size is an *outcome* of the encode rather than a target, so
   * the assertions below compare source to stored and never to a
   * literal byte count — a fixture that came out at 4.1 MB would
   * still be a valid test of "unchanged", and pinning the number
   * would make the case fail for a reason it is not about.
   */
  const jpeg = await imageFixture("beach.jpg", "jpeg", 4000, 3000);
  const sourceBytes = await readFile(jpeg.path);
  const sourceSum = await sha256(jpeg.path);
  // The premise: this really is a multi-megabyte 4000x3000 image, so
  // a recompression path would have had something to do.
  expect(sourceBytes.length).toBeGreaterThan(3 * 1024 * 1024);

  /**
   * **The request is asserted, not only the disk.**
   *
   * A correct file on disk does not prove the client uploaded
   * correctly — a server that re-derived the bytes, or a client that
   * sent a resized copy the server happened to store faithfully,
   * would both leave a plausible file. So the outgoing request's own
   * payload size is captured and compared to the source.
   */
  /**
   * The bytes the *client* put on the wire, read in the page.
   *
   * Two cheaper routes were tried and measured to be unavailable for
   * a multipart upload of this size: `request.postDataBuffer()`
   * returns `null`, and the pre-flight `content-length` header is not
   * populated either — the first version of this assertion read `-1`
   * and failed for a reason that had nothing to do with the case.
   *
   * So `fetch` is wrapped in the page and the encoded FormData is
   * measured directly. This is the only vantage point that sees what
   * the client sent *before* the server can repair it — which is the
   * whole reason the bullet needs more than a disk check: a correct
   * file on disk does not prove a correct upload.
   */
  await page.addInitScript(() => {
    const w = window as unknown as { __sentBytes?: number };
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      if (body instanceof FormData) {
        // Encode exactly as the browser will, and measure that.
        const blob = await new Response(body).blob();
        w.__sentBytes = blob.size;
      }
      return real(input, init);
    };
  });
  // The wrapper installs on the next navigation, so the page is
  // reloaded once before the upload rather than after it.
  await page.reload();
  await expect(page.getByTestId("attachments-panel")).toBeVisible();

  await drop(page, [jpeg]);
  await settled(page);

  // Bullet 1: the stored size equals the source size exactly.
  const storedJpeg = await storedBytes(tracker.root, t1 ?? "", "beach.jpg");
  expect(storedJpeg.length).toBe(sourceBytes.length);

  // Bullet 3: a byte-for-byte comparison (checksum) matches. Both the
  // digest and the buffer, because a checksum alone is the kind of
  // assertion that quietly passes on two empty files.
  const storedPath = path.join(
    await taskDir(tracker.root, t1 ?? ""), "attachments", "beach.jpg");
  expect(await sha256(storedPath)).toBe(sourceSum);
  expect(Buffer.compare(storedJpeg, sourceBytes)).toBe(0);

  // The client sent at least the whole file. A multipart body carries
  // headers too, so this is a lower bound — but a client that
  // recompressed to 1.4 MB before sending would fall under it, which
  // is the mistake the bullet is guarding.
  const sentBytes = await page.evaluate(
    () => (window as unknown as { __sentBytes?: number }).__sentBytes ?? -1);
  expect(sentBytes).toBeGreaterThanOrEqual(sourceBytes.length);

  /**
   * Bullet 2: the stored image's pixel dimensions are unchanged.
   *
   * Decoded from the stored file rather than inferred from its size —
   * "same bytes" already covers size, and a dimension check that read
   * the byte count would be the same assertion twice.
   */
  const { default: sharp } = await import("sharp");
  const meta = await sharp(storedPath).metadata();
  expect({ width: meta.width, height: meta.height }).toEqual({ width: 4000, height: 3000 });

  /* --- Bullet 4: PNG, GIF and WebP too — and bullet 5, a non-image --- */

  const [t2] = await tracker.seed([{ title: "Every format" }]);
  await openTask(page, tracker, t2 ?? "");

  // Smaller than the JPEG: the claim is format coverage, and four
  // more 12-megapixel encodes would cost minutes to prove the same
  // thing the dimensions check above already proved once.
  const others: readonly Upload[] = [
    await imageFixture("pic.png", "png", 800, 600),
    await imageFixture("anim.gif", "gif", 800, 600),
    await imageFixture("shot.webp", "webp", 800, 600),
    // The non-image, stored byte-identical too.
    await file("bundle.zip", "PK not a real archive body"),
  ];
  await drop(page, [...others]);
  await settled(page);

  expect(await stored(tracker.root, t2 ?? ""))
    .toEqual(["anim.gif", "bundle.zip", "pic.png", "shot.webp"]);

  for (const up of others) {
    const name = path.basename(up.path);
    const source = await readFile(up.path);
    const landed = await storedBytes(tracker.root, t2 ?? "", name);
    // Byte-identical, asserted per file so a failure names the format
    // that broke rather than "one of four".
    expect({ name, bytes: landed.length }).toEqual({ name, bytes: source.length });
    expect({ name, sum: await sha256(
      path.join(await taskDir(tracker.root, t2 ?? ""), "attachments", name)) })
      .toEqual({ name, sum: await sha256(up.path) });
  }

  // And the three images still decode at their original dimensions —
  // the compression path being absent, not merely lossless.
  for (const name of ["pic.png", "anim.gif", "shot.webp"]) {
    const m = await sharp(
      path.join(await taskDir(tracker.root, t2 ?? ""), "attachments", name)).metadata();
    expect({ name, w: m.width, h: m.height }).toEqual({ name, w: 800, h: 600 });
  }
});

// @verifies REL-47
test("REL-47: a connection killed mid-upload leaves no partial file, names the file, says it did not complete, and offers retry", async ({
  page,
  tracker,
}) => {
  const pageErrors: string[] = [];
  // A failure-path panel that threw on the error state would read as a
  // missing queue row, not a crash — separate them.
  page.on("pageerror", e => pageErrors.push(e.message));

  const [key] = await tracker.seed([{ title: "Upload target" }]);
  const k = key ?? "";
  await openTask(page, tracker, k);

  // Nothing attached yet, and nothing on disk. The positive control for
  // the absence assertions below is the successful retry at the end: it
  // proves this directory does take uploads, so an empty listing after
  // the abort is the abort's doing, not a broken fixture.
  expect(await stored(tracker.root, k)).toEqual([]);

  // "Kill the connection mid-upload of a 30 MB file." A route that
  // aborts the POST is the browser-side of a dropped connection: `fetch`
  // rejects with the bare TypeError REL-47's framing turns into an
  // incomplete-upload failure. 30 MB is a real file so the size is not
  // the thing under test — the abort is.
  let aborted = false;
  await page.route(`**/api/tasks/${k}/attachments`, async route => {
    if (!aborted && route.request().method() === "POST") {
      aborted = true;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  const big = await sized("dropped.bin", 30 * 1024 * 1024);
  await drop(page, [big]);

  const row = queueRow(page, "dropped.bin");
  await expect(row).toHaveAttribute("data-state", "failed");

  // No partial tile: the failed upload is a queue row, never a grid tile.
  await expect(tile(page, "dropped.bin")).toHaveCount(0);

  // The message names the file and says the upload did not complete.
  const err = row.getByTestId("attachment-queue-error");
  await expect(err).toContainText("dropped.bin");
  await expect(err).toContainText(/did not (finish|complete)/i);

  // Retry is offered.
  const retry = row.getByTestId("attachment-retry-upload");
  await expect(retry).toBeVisible();

  // No stray file under attachments/ — the far end, off disk. The upload
  // route is atomic (parse to an OS temp dir, rename on success), so a
  // dropped connection attaches nothing.
  expect(await stored(tracker.root, k)).toEqual([]);

  // Positive control: let the retry through. It must land exactly once,
  // proving the directory takes uploads and that "retrying does not
  // create a duplicate".
  await retry.click();
  await expect(row).toHaveAttribute("data-state", "done");
  await expect(tile(page, "dropped.bin")).toBeVisible();
  expect(await stored(tracker.root, k)).toEqual(["dropped.bin"]);

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackupPanel } from "./BackupPanel.tsx";

/**
 * Settings → Tracker → Backup & restore (F3 / K30).
 *
 * The panel is the web parity for `loctt backup`/`restore`. The
 * assertions that matter, and that a green-by-default test would miss:
 *
 *  - export is a real download link to the export endpoint, not a
 *    fetch (a GET the browser handles natively);
 *  - the destructive **overwrite** mode is gated behind a typed
 *    confirmation and only then sends `confirm=true` on the request —
 *    asserted on the URL that leaves the client, because a layer in
 *    between could otherwise repair a missing flag (K30's confirm).
 */

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pickFile() {
  const input = screen.getByTestId("backup-restore-file");
  const file = new File(["{}\n"], "backup.jsonl", { type: "application/x-ndjson" });
  fireEvent.change(input, { target: { files: [file] } });
}

function restoreRequests(): { url: string; init: RequestInit | undefined }[] {
  return fetchMock.mock.calls
    .map(c => ({ url: String(c[0]), init: c[1] as RequestInit | undefined }))
    .filter(c => c.url.includes("/api/backup/restore"));
}

describe("BackupPanel", () => {
  it("offers export as a download link to the backup endpoint", () => {
    render(<BackupPanel />);
    const link = screen.getByTestId("backup-export-link");
    // A GET download, not a fetch: the href points at the endpoint and
    // the element is a download link.
    expect(link.getAttribute("href")).toBe("/api/backup/export");
    expect(link.hasAttribute("download")).toBe(true);
  });

  /** @verifies K30 */
  it("gates overwrite behind a typed confirmation and cannot submit until confirmed", () => {
    render(<BackupPanel />);
    pickFile();
    fireEvent.click(screen.getByTestId("backup-mode-overwrite"));

    // The submit is blocked until the exact word is typed. `.disabled`
    // needs the button type — getByTestId returns the base HTMLElement.
    // The cast is required: getByTestId is typed HTMLElement under
    // tsc --build, so `.disabled` needs the button type. (eslint's own TS
    // program resolves it differently and flags the cast — hence the
    // scoped disable directly on the assertion line.)
    const submit = (): HTMLButtonElement =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      screen.getByTestId("backup-restore-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("backup-overwrite-input"), {
      target: { value: "overwrite" }, // wrong case
    });
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("backup-overwrite-input"), {
      target: { value: "OVERWRITE" },
    });
    expect(submit().disabled).toBe(false);
  });

  /** @verifies A307 */
  it("shows the spinner while restoring instead of swapping the label to \"Restoring…\"", async () => {
    // A307: the button used to render `{busy ? "Restoring…" : "Restore"}`,
    // which changed its WIDTH mid-restore — the resize Ken's `loading`
    // prop exists to prevent. Both halves are asserted, because a test
    // that only checked for the spinner would stay green if the label
    // swap came back alongside it.
    let release: (v: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/api/backup/restore")
        ? new Promise<Response>(resolve => { release = resolve; })
        : Promise.resolve(jsonResponse({})));

    render(<BackupPanel />);
    pickFile();
    fireEvent.click(screen.getByTestId("backup-restore-submit"));

    const submit = screen.getByTestId("backup-restore-submit");
    await waitFor(() => { expect(submit.getAttribute("aria-busy")).toBe("true"); });

    // The label never becomes "Restoring…" — the text stays put and is
    // merely hidden, so the button keeps its width.
    expect(submit.textContent).toContain("Restore");
    expect(submit.textContent).not.toContain("Restoring…");
    // Hidden content would leave the button nameless without the
    // aria-label, so a screen reader must still be able to find it.
    expect(submit.getAttribute("aria-label")).toBe("Restore");
    expect(submit.querySelector("svg")).not.toBeNull();

    release(jsonResponse({
      mode: "merge", dryRun: false, created: 0, skipped: 0, overwritten: 0,
      reallocatedKeys: [], renamedEntities: [], displacedBodies: [], badLines: [],
    }));
    await waitFor(() => { expect(submit.getAttribute("aria-busy")).toBeNull(); });
  });

  /** @verifies K30 */
  it("sends confirm=true on a confirmed overwrite restore", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      mode: "overwrite", dryRun: false, created: 0, skipped: 0, overwritten: 2,
      reallocatedKeys: [], renamedEntities: [], displacedBodies: [], badLines: [],
    }));
    render(<BackupPanel />);
    pickFile();
    fireEvent.click(screen.getByTestId("backup-mode-overwrite"));
    fireEvent.change(screen.getByTestId("backup-overwrite-input"), {
      target: { value: "OVERWRITE" },
    });
    fireEvent.click(screen.getByTestId("backup-restore-submit"));

    await waitFor(() => {
      const req = restoreRequests().find(r => String(r.init?.method).toUpperCase() === "POST");
      expect(req).toBeDefined();
      expect(req?.url).toContain("mode=overwrite");
      // The confirm flag is the whole point of K30: it must reach the
      // server on the URL, or the endpoint refuses.
      expect(req?.url).toContain("confirm=true");
    });
  });

  it("a dry run never sends confirm and writes nothing to gate", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      mode: "overwrite", dryRun: true, created: 0, skipped: 0, overwritten: 2,
      reallocatedKeys: [], renamedEntities: [], displacedBodies: [], badLines: [],
    }));
    render(<BackupPanel />);
    pickFile();
    fireEvent.click(screen.getByTestId("backup-mode-overwrite"));
    // No confirmation typed — the dry-run button is still enabled.
    fireEvent.click(screen.getByTestId("backup-restore-dryrun"));

    await waitFor(() => {
      const req = restoreRequests()[0];
      expect(req).toBeDefined();
      expect(req?.url).toContain("dry_run=true");
      expect(req?.url).not.toContain("confirm=true");
    });
  });

  it("shows the server's attributed error rather than a generic failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { code: "conflict", message: "this tracker already holds 3 tasks." },
      409,
    ));
    render(<BackupPanel />);
    pickFile();
    // bare (default) into a non-empty tracker -> 409.
    fireEvent.click(screen.getByTestId("backup-mode-bare"));
    fireEvent.click(screen.getByTestId("backup-restore-submit"));

    const err = await screen.findByTestId("backup-restore-error");
    expect(err.textContent).toContain("already holds 3 tasks");
  });
});

/**
 * Selecting every part of a split backup (Ken, 2026-09-23).
 *
 * The panel used to accept one file and point the user at the CLI.
 * These assert the two things that could regress silently: that ALL
 * selected files leave the client (a form body carrying one part would
 * still restore *something* and look fine), and that the panel labels
 * the set from the parts' own headers rather than just counting files.
 *
 * @verifies K30 · BAK-C8
 */
describe("BackupPanel — split backup (several parts)", () => {
  /** A file whose first line is a real backup header. */
  function partFile(part: number, parts: number, backupId = "abc123"): File {
    const header = JSON.stringify({
      kind: "loctt-backup", format: 1, schema_version: 1,
      created_at: "2026-09-23T00:00:00.000Z",
      part, parts, backup_id: backupId,
      includes_history: true, excluded: [],
    });
    return new File([`${header}\n`], `backup.jsonl.part${String(part)}`, {
      type: "application/x-ndjson",
    });
  }

  function pickFiles(files: readonly File[]) {
    const input = screen.getByTestId("backup-restore-file");
    fireEvent.change(input, { target: { files } });
  }

  it("sends EVERY selected part as its own `file` part", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      mode: "merge", dryRun: false, created: 3, skipped: 0, overwritten: 0,
      reallocatedKeys: [], renamedEntities: [], displacedBodies: [], badLines: [],
    }));
    render(<BackupPanel />);
    pickFiles([partFile(1, 3), partFile(2, 3), partFile(3, 3)]);
    await waitFor(() => {
      expect(screen.getAllByTestId("backup-restore-selected-part").length).toBe(3);
    });
    fireEvent.click(screen.getByTestId("backup-restore-submit"));

    await waitFor(() => { expect(restoreRequests().length).toBe(1); });
    const body = restoreRequests()[0]?.init?.body as FormData;
    // All three, under the one field name the endpoint reads. One file
    // here would still have produced a plausible-looking restore.
    expect(body.getAll("file").length).toBe(3);
    expect((body.getAll("file") as File[]).map(f => f.name)).toEqual([
      "backup.jsonl.part1", "backup.jsonl.part2", "backup.jsonl.part3",
    ]);
  });

  it("reads the parts' headers and says how many the set expects", async () => {
    render(<BackupPanel />);
    // Two of a three-part set: the panel knows the shortfall from the
    // headers, before any upload.
    pickFiles([partFile(1, 3), partFile(2, 3)]);
    await waitFor(() => {
      expect(screen.getByTestId("backup-restore-selection").textContent)
        .toMatch(/2 of 3 parts selected/);
    });
    // Wording trimmed under K116 (row 45): "— every part is needed." became
    // "Select every part of the backup." — same instruction, same testid.
    expect(screen.getByTestId("backup-restore-selection").textContent)
      .toMatch(/select every part of the backup/i);
    expect(screen.getByTestId("backup-restore-selection").textContent)
      .toMatch(/part 1 of 3/);
  });

  it("marks a selected file that is not a backup at all", async () => {
    render(<BackupPanel />);
    const junk = new File(["hello, not json\n"], "notes.txt", { type: "text/plain" });
    pickFiles([partFile(1, 2), junk]);
    await waitFor(() => {
      expect(screen.getByTestId("backup-restore-selection").textContent)
        .toMatch(/not recognised as a backup/);
    });
  });

  it("no longer tells the user to go and run the CLI", () => {
    render(<BackupPanel />);
    // Ken's ruling: remove the limitation, not explain it. The panel must
    // not name `loctt restore` as the way to handle a split backup.
    expect(screen.getByTestId("backup-restore").textContent)
      .not.toMatch(/loctt restore/);
  });
});

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

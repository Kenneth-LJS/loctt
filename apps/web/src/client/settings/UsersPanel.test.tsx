// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsersPanel } from "./UsersPanel.tsx";

/**
 * @verifies PRU-47
 *
 * The Edit dialog that lets an existing user's name, email and timezone
 * be edited from the UI (`PUT /api/users/:id`). Before this, those
 * fields were shown read-only and settable only in the create form, so a
 * blank email could not be fixed in-app. These assert the request the
 * panel issues and the SET-51 save-failure behaviour — not the server
 * round-trip (server.test.ts covers that against a real tracker).
 *
 * Red-first proof: the key assertion — that editing the email and
 * clicking Save fires a PUT to /api/users/:id — fails before the dialog
 * is wired (no Edit button, no dialog, no `useUpdateUser`), because no
 * such request is ever made.
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALICE = { id: "u-alice", name: "Alice", email: "alice@example.com", timezone: "UTC" };
const BOB = { id: "u-bob", name: "Bob", email: "bob@example.com", timezone: "UTC" };

const USERS = { items: [ALICE, BOB], total: 2, offset: 0, limit: 100 };

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

/** The bodies of every PUT to /api/users/:id, parsed. */
function userPutBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(c => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return /\/api\/users\/[^/]+$/.test(url)
        && String(init?.method).toUpperCase() === "PUT";
    })
    .map(c => {
      const init = c[1] as RequestInit | undefined;
      const body = typeof init?.body === "string" ? init.body : undefined;
      return body !== undefined ? (JSON.parse(body) as unknown) : undefined;
    });
}

/** Users list + current user resolve; the user PUT succeeds by default. */
function stubHappyPath(): void {
  fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
    const urlStr = String(url);
    const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    if (/\/api\/users\/[^/]+$/.test(urlStr) && method === "PUT") {
      return Promise.resolve(jsonResponse({ ...ALICE, email: "new@example.com" }));
    }
    if (urlStr.includes("/api/users")) {
      return Promise.resolve(jsonResponse(USERS));
    }
    if (urlStr.includes("/api/user/current")) {
      return Promise.resolve(jsonResponse(BOB));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

async function openAliceEditDialog(): Promise<void> {
  const edit = await screen.findByTestId("user-edit-u-alice");
  fireEvent.click(edit);
  await screen.findByTestId("user-edit-dialog-u-alice");
}

describe("UsersPanel Edit dialog (PRU-47)", () => {
  it("shows the row's identity fields as read-only until Edit is opened", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    // The row exists and shows the email as text, with no inline input.
    const row = await screen.findByTestId("user-row-u-alice");
    expect(row.textContent).toContain("alice@example.com");
    // No edit fields are present before the dialog opens.
    expect(screen.queryByTestId("user-edit-email-u-alice")).toBeNull();
    expect(screen.queryByTestId("user-edit-dialog-u-alice")).toBeNull();
  });

  it("edits name, email and timezone and Save PUTs them to /api/users/:id", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();

    fireEvent.change(screen.getByTestId("user-edit-name-u-alice"), {
      target: { value: "Alice Cooper" },
    });
    fireEvent.change(screen.getByTestId("user-edit-email-u-alice"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByTestId("user-edit-timezone-u-alice"), {
      target: { value: "America/New_York" },
    });

    fireEvent.click(screen.getByTestId("user-edit-save-u-alice"));

    // The load-bearing assertion (red before wiring): a PUT is issued
    // with the edited values.
    await waitFor(() => {
      expect(userPutBodies()).toContainEqual({
        name: "Alice Cooper",
        email: "new@example.com",
        timezone: "America/New_York",
      });
    });

    // On success the dialog closes.
    await waitFor(() => {
      expect(screen.queryByTestId("user-edit-dialog-u-alice")).toBeNull();
    });
  });

  it("keeps the dialog open with an anchored error when Save fails (SET-51)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/users\/[^/]+$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            { code: "rejected_write", message: "Email is already in use." },
            400,
          ),
        );
      }
      if (urlStr.includes("/api/users")) return Promise.resolve(jsonResponse(USERS));
      if (urlStr.includes("/api/user/current")) return Promise.resolve(jsonResponse(BOB));
      return Promise.resolve(jsonResponse({}));
    });

    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    fireEvent.change(screen.getByTestId("user-edit-email-u-alice"), {
      target: { value: "taken@example.com" },
    });
    fireEvent.click(screen.getByTestId("user-edit-save-u-alice"));

    // The dialog stays open and shows the anchored Callout error.
    const err = await screen.findByTestId("user-edit-error-u-alice");
    expect(err.textContent).toContain("Email is already in use.");
    expect(screen.getByTestId("user-edit-dialog-u-alice")).toBeTruthy();
  });

  it("discards the edit on Cancel without issuing a PUT", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    fireEvent.change(screen.getByTestId("user-edit-email-u-alice"), {
      target: { value: "throwaway@example.com" },
    });
    fireEvent.click(screen.getByTestId("user-edit-cancel-u-alice"));

    await waitFor(() => {
      expect(screen.queryByTestId("user-edit-dialog-u-alice")).toBeNull();
    });
    expect(userPutBodies()).toHaveLength(0);
  });

  /** @verifies PRU-47 */
  it("blocks Save and shows a field problem on an obviously-invalid email, issuing no PUT (B2 bug 1)", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    fireEvent.change(screen.getByTestId("user-edit-email-u-alice"), {
      target: { value: "bob" },
    });

    // The named reason renders and Save is disabled — the bad value
    // never reaches the server, and it certainly does not save as a 200
    // then clear the field (the B2 data-loss shape).
    expect(screen.getByTestId("user-edit-email-problem-u-alice")).toBeTruthy();
    expect(screen.getByTestId("user-edit-save-u-alice")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByTestId("user-edit-save-u-alice"));
    expect(userPutBodies()).toHaveLength(0);
  });

  /** @verifies PRU-47 */
  it("renders the server's field:email 400 as the anchored Callout (B2 bug 1)", async () => {
    // A value the light client check passes but the server rejects (e.g.
    // a shape the client waves through). The 400 must still surface.
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/users\/[^/]+$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            { code: "rejected_write", field: "email", message: "Enter a valid email address, or leave it blank." },
            400,
          ),
        );
      }
      if (urlStr.includes("/api/users")) return Promise.resolve(jsonResponse(USERS));
      if (urlStr.includes("/api/user/current")) return Promise.resolve(jsonResponse(BOB));
      return Promise.resolve(jsonResponse({}));
    });

    render(<UsersPanel />, { wrapper: wrapper() });
    await openAliceEditDialog();
    // Passes the client gate (well-formed) so the request is issued.
    fireEvent.change(screen.getByTestId("user-edit-email-u-alice"), {
      target: { value: "server@rejects.example" },
    });
    fireEvent.click(screen.getByTestId("user-edit-save-u-alice"));

    const err = await screen.findByTestId("user-edit-error-u-alice");
    expect(err.textContent).toContain("Enter a valid email address");
    // The dialog stays open — the field was not silently cleared.
    expect(screen.getByTestId("user-edit-dialog-u-alice")).toBeTruthy();
  });

  /** @verifies PRU-47 */
  it("no longer offers a '(none)' timezone option that cannot clear the zone (B2 bug 2)", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    const select = screen.getByTestId<HTMLSelectElement>("user-edit-timezone-u-alice");
    const optionValues = [...select.options].map(o => o.value);
    const optionLabels = [...select.options].map(o => o.textContent ?? "");
    // The lying "(none)" clear option is gone.
    expect(optionLabels).not.toContain("(none)");
    // Alice has a real zone, so there is no empty-value option at all.
    expect(optionValues).not.toContain("");
  });

  /** @verifies PRU-47 */
  it("blocks Save when a user's timezone is blank, offering a disabled placeholder (B2 bug 2)", async () => {
    const NO_TZ = { id: "u-notz", name: "Zed", email: "zed@example.com" };
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/users\/[^/]+$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(jsonResponse(NO_TZ));
      }
      if (urlStr.includes("/api/users")) {
        return Promise.resolve(jsonResponse({ items: [NO_TZ], total: 1, offset: 0, limit: 100 }));
      }
      if (urlStr.includes("/api/user/current")) return Promise.resolve(jsonResponse(BOB));
      return Promise.resolve(jsonResponse({}));
    });

    render(<UsersPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("user-edit-u-notz"));
    await screen.findByTestId("user-edit-dialog-u-notz");

    // A blank zone shows the disabled placeholder and blocks Save — it is
    // not silently sent as a no-op.
    expect(screen.getByTestId("user-edit-timezone-problem-u-notz")).toBeTruthy();
    expect(screen.getByTestId("user-edit-save-u-notz")).toHaveProperty("disabled", true);
  });

  it("sets the avatar through a Button, not a raw visible file input (PRU-47)", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    // The proper control exists…
    await screen.findByTestId("user-avatar-change-u-alice");
    // …and the underlying file input is visually hidden (sr-only), not a
    // bare inline `<input type=file>`.
    const input = screen.getByTestId<HTMLInputElement>("user-avatar-input-u-alice");
    expect(input.className).toContain("sr-only");
  });
});

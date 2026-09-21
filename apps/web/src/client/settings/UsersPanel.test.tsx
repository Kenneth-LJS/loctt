// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsersPanel } from "./UsersPanel.tsx";

/**
 * Part C3 relies on the decode → crop → prepared-file flow. Decoding uses
 * canvas/ImageBitmap (not in jsdom) and the cropper is a heavy interactive
 * surface, so both are mocked to the shape the create form consumes: a
 * decode that yields a trivial DecodedImage, and a cropper that
 * immediately confirms with a prepared File. The create-then-set wiring
 * under test — attach the prepared file to the new user's id after create
 * — is exercised directly.
 */
vi.mock("./prepareAvatar.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prepareAvatar.ts")>();
  return {
    ...actual,
    decodeImageFile: vi.fn(() => Promise.resolve({
      animated: false,
      revoke: () => {},
    })),
  };
});

vi.mock("./AvatarCropper.tsx", () => ({
  AvatarCropper: ({ onConfirm }: { onConfirm: (r: { file: File }) => void }) => (
    <button
      type="button"
      data-testid="mock-cropper-confirm"
      onClick={() => { onConfirm({ file: new File(["x"], "cropped.png", { type: "image/png" }) }); }}
    >
      confirm crop
    </button>
  ),
}));

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
    // The timezone picker is now a searchable Combobox (A211), not a
    // native <select>: open the trigger, filter, and click the option.
    fireEvent.click(screen.getByTestId("user-edit-timezone-u-alice"));
    fireEvent.change(await screen.findByTestId("user-edit-timezone-search-u-alice"), {
      target: { value: "New_York" },
    });
    fireEvent.click(
      await screen.findByTestId("user-edit-timezone-option-u-alice-America/New_York"),
    );

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
    // The picker is now a Combobox (A211); this once read `select.options`
    // off the native <select> — the pre-migration control. It now opens
    // the list and asserts the same thing: no "(none)"/clear row exists,
    // because the Combobox is built without a `clear` prop (a clear would
    // report a zone-clear that core does not perform).
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    // The trigger shows the stored zone.
    expect(
      screen.getByTestId("user-edit-timezone-u-alice").getAttribute("data-value"),
    ).toBe("UTC");
    fireEvent.click(screen.getByTestId("user-edit-timezone-u-alice"));
    const list = await screen.findByTestId("user-edit-timezone-list-u-alice");
    // No lying "(none)"/clear row: every rendered option is a real zone.
    const optionLabels = [...list.querySelectorAll('[role="option"]')].map(
      o => o.textContent ?? "",
    );
    expect(optionLabels.some(l => /\(none\)/i.test(l))).toBe(false);
    expect(optionLabels.length).toBeGreaterThan(0);
  });

  /**
   * @verifies PRU-47
   *
   * A211: the ~400-zone list is unusable without search, so the whole
   * point of the migration is that typing narrows it. Red proof: with the
   * pre-migration native <select> there was no search box (no
   * `user-edit-timezone-search-*` testid) and no filtering, so the query
   * and the "London gone" assertion both fail.
   */
  it("filters the timezone list as the search box is typed into (A211)", async () => {
    stubHappyPath();
    render(<UsersPanel />, { wrapper: wrapper() });

    await openAliceEditDialog();
    fireEvent.click(screen.getByTestId("user-edit-timezone-u-alice"));

    // The full list is long enough that the search box is shown at all.
    const list = await screen.findByTestId("user-edit-timezone-list-u-alice");
    const countBefore = list.querySelectorAll('[role="option"]').length;
    expect(countBefore).toBeGreaterThan(50);

    fireEvent.change(await screen.findByTestId("user-edit-timezone-search-u-alice"), {
      target: { value: "New_York" },
    });

    await waitFor(() => {
      const labels = [
        ...list.querySelectorAll('[role="option"]'),
      ].map(o => o.textContent ?? "");
      // The list collapses to the matches (plus the pinned current value,
      // "UTC", which the Combobox keeps present so a selection never
      // vanishes) — far fewer than the full list.
      expect(labels.length).toBeLessThan(countBefore);
      // The matching zone is present…
      expect(labels.some(l => /america\/new_york/i.test(l))).toBe(true);
      // …and an unrelated, unselected zone is filtered out.
      expect(labels.some(l => /london/i.test(l))).toBe(false);
    });
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

describe("CreateUserForm avatar (Part C3)", () => {
  /**
   * Records POSTs so the test can assert BOTH the create and the
   * follow-on avatar upload to the new user's id (create-then-set).
   */
  function stubCreateFlow(): { posts: { url: string; isFile: boolean }[] } {
    const posts: { url: string; isFile: boolean }[] = [];
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (urlStr.includes("/avatar") && method === "POST") {
        posts.push({ url: urlStr, isFile: true });
        return Promise.resolve(jsonResponse({ id: "u-new", name: "Carol", avatar: "carol.png" }));
      }
      if (/\/api\/users$/.test(urlStr) && method === "POST") {
        posts.push({ url: urlStr, isFile: false });
        return Promise.resolve(jsonResponse({ id: "u-new", name: "Carol", timezone: "UTC" }, 201));
      }
      if (urlStr.includes("/api/user/current")) return Promise.resolve(jsonResponse(BOB));
      if (urlStr.includes("/api/users")) return Promise.resolve(jsonResponse(USERS));
      return Promise.resolve(jsonResponse({}));
    });
    return { posts };
  }

  it("attaches the chosen avatar to the new user after create (create-then-set)", async () => {
    const { posts } = stubCreateFlow();
    render(<UsersPanel />, { wrapper: wrapper() });

    fireEvent.click(await screen.findByTestId("user-create-open"));
    fireEvent.change(await screen.findByTestId("user-create-name"), { target: { value: "Carol" } });

    // Choose a file → mocked decode → mocked cropper → confirm prepares it.
    const fileInput = screen.getByTestId<HTMLInputElement>("user-create-avatar-input");
    fireEvent.change(fileInput, {
      target: { files: [new File(["y"], "raw.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByTestId("mock-cropper-confirm"));
    await screen.findByTestId("user-create-avatar-preview");

    fireEvent.click(screen.getByTestId("user-create-submit"));

    // Both the create and the avatar upload to the NEW id fire.
    await waitFor(() => {
      expect(posts.some(p => p.url.endsWith("/api/users") && !p.isFile)).toBe(true);
      expect(posts.some(p => p.url.includes("/api/users/u-new/avatar") && p.isFile)).toBe(true);
    });
  });

  it("creates the user with no avatar upload when none is chosen", async () => {
    const { posts } = stubCreateFlow();
    render(<UsersPanel />, { wrapper: wrapper() });

    fireEvent.click(await screen.findByTestId("user-create-open"));
    fireEvent.change(await screen.findByTestId("user-create-name"), { target: { value: "Carol" } });
    fireEvent.click(screen.getByTestId("user-create-submit"));

    await waitFor(() => {
      expect(posts.some(p => p.url.endsWith("/api/users") && !p.isFile)).toBe(true);
    });
    // No avatar upload fired.
    expect(posts.some(p => p.isFile)).toBe(false);
  });
});

describe("UsersPanel — archived separation + self-user note (U24/U25)", () => {
  const CAROL_ARCHIVED = {
    id: "u-carol", name: "Carol", email: "carol@example.com", timezone: "UTC", archived: true,
  };
  function stubWithArchived(): void {
    fetchMock.mockImplementation((url: unknown): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("/api/user/current")) return Promise.resolve(jsonResponse(BOB));
      if (urlStr.includes("/api/users")) {
        return Promise.resolve(jsonResponse({
          items: [ALICE, BOB, CAROL_ARCHIVED], total: 3, offset: 0, limit: 100,
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
  }

  it("hides archived users until the toggle is on (U25)", async () => {
    stubWithArchived();
    render(<UsersPanel />, { wrapper: wrapper() });
    // Active users show; the archived one does not, by default.
    await screen.findByTestId("user-row-u-alice");
    expect(screen.queryByTestId("user-row-u-carol")).toBeNull();
    // Toggling reveals it.
    fireEvent.click(screen.getByTestId("users-show-archived"));
    expect(await screen.findByTestId("user-row-u-carol")).toBeTruthy();
  });

  it("does not render an inline self-user note that reflows the row (U24)", async () => {
    stubWithArchived();
    render(<UsersPanel />, { wrapper: wrapper() });
    // BOB is the current user (self). The reason lives as the disabled
    // Archive button's tooltip + an sr-only note — NOT a visible inline
    // paragraph that changes the row height.
    const note = await screen.findByTestId("user-archive-blocked-u-bob");
    expect(note.className).toContain("sr-only");
    // The disabled Archive button carries the reason as its tooltip.
    const archiveBtn = screen.getByTestId("user-archive-u-bob");
    expect(archiveBtn.hasAttribute("disabled")).toBe(true);
    expect(archiveBtn.getAttribute("title")).toMatch(/cannot archive/i);
  });
});

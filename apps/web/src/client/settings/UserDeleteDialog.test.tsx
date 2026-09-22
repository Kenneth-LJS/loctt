// @vitest-environment jsdom
import type { UserProfile } from "@loctt/contracts";
import type { UseMutationResult } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeleteUserResult, DeleteUserVars } from "../api/hooks/useUserMutations.ts";
import { DELETE_CONFIRM_WORD } from "../list/DeleteConfirmDialog.tsx";
import { UserDeleteDialog } from "./UserDeleteDialog.tsx";

/**
 * @verifies A211 (UserDeleteDialog remap picker → Combobox)
 *
 * The remap target used to be a radio WALL — one Radio per other user,
 * which does not search and grows unbounded with the workspace. It is now
 * the shared searchable `Combobox`, matching how DeleteProjectDialog
 * remaps. These tests pin:
 *   - the picker is reachable and picking a user enables the delete;
 *   - the delete request carries the chosen `remapTo`;
 *   - the per-option testids stay `user-delete-remap-<id>`.
 *
 * Red-proof: revert the Combobox back to radios and the "combobox trigger
 * present" + "remapTo carried" assertions go red (no `user-delete-remap`
 * trigger, and picking a radio would need a different path).
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

const ALICE = { id: "u_alice", name: "Alice" } as unknown as UserProfile;
const BOB = { id: "u_bob", name: "Bob" } as unknown as UserProfile;
const CARA = { id: "u_cara", name: "Cara" } as unknown as UserProfile;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url) => {
    const u = String(url);
    // The delete dialog reads the reference counts on mount.
    if (u.includes("/usage")) {
      return Promise.resolve(jsonResponse({ assignee: 2, reporter: 1 }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** A minimal idle mutation stub that records mutate() calls. */
function fakeMutation(calls: DeleteUserVars[]): UseMutationResult<DeleteUserResult, Error, DeleteUserVars> {
  return {
    mutate: (vars: DeleteUserVars) => { calls.push(vars); },
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: () => {},
  } as unknown as UseMutationResult<DeleteUserResult, Error, DeleteUserVars>;
}

function renderDialog(calls: DeleteUserVars[]) {
  render(
    <UserDeleteDialog
      user={ALICE}
      others={[BOB, CARA]}
      mutation={fakeMutation(calls)}
      onArchive={() => {}}
      onClose={() => {}}
    />,
    { wrapper: wrapper() },
  );
}

describe("UserDeleteDialog — remap target is a searchable Combobox (A211)", () => {
  it("picks a remap target through the combobox and carries remapTo on delete", async () => {
    const calls: DeleteUserVars[] = [];
    renderDialog(calls);

    // Reference count has loaded (referenced user), so a resolution is required.
    await waitFor(() => {
      expect(screen.getByTestId("user-delete-refcount").textContent).toContain("assignee");
    });

    // Choose "reassign", which reveals the combobox trigger (not a radio wall).
    fireEvent.click(screen.getByTestId("user-delete-reassign"));
    const trigger = screen.getByTestId("user-delete-remap");
    expect(trigger).toBeTruthy();

    // Open it and pick Bob by the preserved per-option testid.
    fireEvent.click(trigger);
    const option = await screen.findByTestId("user-delete-remap-u_bob");
    fireEvent.click(option);

    // Type the confirm word, then delete.
    fireEvent.change(screen.getByTestId("user-delete-confirm-input"), {
      target: { value: DELETE_CONFIRM_WORD },
    });
    fireEvent.click(screen.getByTestId("user-delete-confirm"));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "u_alice", remapTo: "u_bob" });
  });

  it("keeps delete blocked while reassign is chosen but no target is picked", async () => {
    const calls: DeleteUserVars[] = [];
    renderDialog(calls);
    await waitFor(() => {
      expect(screen.getByTestId("user-delete-refcount").textContent).toContain("assignee");
    });

    fireEvent.click(screen.getByTestId("user-delete-reassign"));
    // Type the confirm word — but no target picked yet.
    fireEvent.change(screen.getByTestId("user-delete-confirm-input"), {
      target: { value: DELETE_CONFIRM_WORD },
    });
    const confirm = screen.getByTestId<HTMLButtonElement>("user-delete-confirm");
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(calls).toHaveLength(0);
  });

  it("does not render a radio-per-user wall", async () => {
    const calls: DeleteUserVars[] = [];
    renderDialog(calls);
    await waitFor(() => {
      expect(screen.getByTestId("user-delete-refcount").textContent).toContain("assignee");
    });
    fireEvent.click(screen.getByTestId("user-delete-reassign"));
    // The old radios were `user-delete-remap-<id>` <input type=radio>. Now
    // the per-option targets live inside the combobox popover, and only the
    // "unassign"/"reassign" radios remain in the fieldset.
    const fieldset = screen.getByTestId("user-delete-resolution");
    const radios = within(fieldset).getAllByRole("radio");
    // Exactly two: "reassign" and "unassign" — not one per other user.
    expect(radios).toHaveLength(2);
  });
});

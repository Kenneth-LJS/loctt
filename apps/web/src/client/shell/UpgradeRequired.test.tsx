// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpgradeRequired } from "./UpgradeRequired.tsx";

/**
 * The Upgrade screen (K154): an older tracker is upgraded only on
 * purpose, from this screen's one button. It carries over what the
 * schema banner's in-app migration was tested for (XS-36, SET-15,
 * SET-37, A333's double-click guard, A307's spinner) and adds K154's
 * content: the message, the consequence, the steps in plain words, the
 * reload on success and the backup path on failure.
 *
 * @verifies ONB-C17
 * @verifies SHL-36
 * @verifies XS-36
 * @verifies SET-15
 */

const PLAN = {
  from: "0.1.0",
  to: "0.3.0",
  taskCount: 12,
  steps: [{
    from: "0.1.0",
    to: "0.3.0",
    description: "Save the order of every task's links",
    changes: "Each task's links keep the order they are shown in today.",
  }],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Routes the plan GET to `PLAN` and the migrate POST to `migrate`. */
function stubFetch(migrate: () => Promise<Response>, plan: unknown = PLAN) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes("/api/migrate/plan")) return Promise.resolve(json(plan));
    if (url.includes("/api/migrate")) return migrate();
    return Promise.resolve(json({ code: "unknown", message: "unexpected" }, 500));
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    posts: () => fetchMock.mock.calls.filter(([i]) => {
      const u = urlOf(i);
      return u.includes("/api/migrate") && !u.includes("/plan");
    }).length,
  };
}

function render(onUpgraded = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  rtlRender(
    <QueryClientProvider client={client}>
      <UpgradeRequired from="0.1.0" to="0.3.0" onUpgraded={onUpgraded} />
    </QueryClientProvider>,
  );
  return onUpgraded;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("what the Upgrade screen says", () => {
  it("states the versions and the backup, names no command, and puts focus on Upgrade", () => {
    stubFetch(() => new Promise(() => {}));
    render();
    const panel = screen.getByRole("alert");
    expect(panel.getAttribute("data-kind")).toBe("outdated");
    expect(screen.getByTestId("upgrade-required-message").textContent).toBe(
      "This tracker needs upgrading from 0.1.0 to 0.3.0.",
    );
    expect(panel.textContent).toContain("A backup is made first.");
    // The button replaces the CLI command on the web (K154).
    expect(panel.textContent).not.toContain("loctt migrate");
    expect(panel.textContent).not.toMatch(/[—;]/);
    const button = screen.getByRole("button", { name: "Upgrade" });
    expect(document.activeElement).toBe(button);
  });

  it("lists the steps in plain words, collapsed, and flags a risky one", async () => {
    stubFetch(() => new Promise(() => {}), {
      ...PLAN,
      steps: [...PLAN.steps, { from: "0.3.0", to: "0.4.0", description: "Rewrite dates", risky: true }],
    });
    render();
    const steps = await screen.findByTestId("upgrade-required-steps");
    expect(steps.tagName).toBe("DETAILS");
    expect(steps.hasAttribute("open")).toBe(false);
    expect(steps.textContent).toContain("What changes (2 steps)");
    expect(steps.textContent).toContain("Save the order of every task's links");
    expect(steps.textContent).toContain("Each task's links keep the order they are shown in today.");
    expect(screen.getAllByTestId("upgrade-step-risky")).toHaveLength(1);
  });
});

describe("the Upgrade button", () => {
  it("posts once, shows the spinner while it runs, keeps its name, and reloads the app on success", async () => {
    let resolve!: (r: Response) => void;
    const { posts } = stubFetch(() => new Promise<Response>(r => { resolve = r; }));
    const onUpgraded = render();
    const button = screen.getByRole("button", { name: "Upgrade" });
    fireEvent.click(button);
    await waitFor(() => { expect(button.getAttribute("aria-busy")).toBe("true"); });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector("[data-testid='logo-spinner']")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBe(button);
    expect(onUpgraded).not.toHaveBeenCalled();
    resolve(json({ from: "0.1.0", to: "0.3.0", steps: [], backupPath: "/tmp/b" }));
    await waitFor(() => { expect(onUpgraded).toHaveBeenCalledTimes(1); });
    expect(posts()).toBe(1);
  });

  // A333: `isPending` turns true only after React commits, so without the
  // synchronous ref two clicks in one tick both POST.
  it("two clicks in the same tick still POST once", async () => {
    const { posts } = stubFetch(() => new Promise(() => {}));
    render();
    const button = screen.getByRole("button", { name: "Upgrade" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => { expect(button.getAttribute("aria-busy")).toBe("true"); });
    expect(posts()).toBe(1);
  });

  // SET-37: a part-way failure is not offered a bare retry. The backup
  // the sentinel names is the fix, so its path is shown.
  it("on a part-way failure: says it didn't finish, shows the backup path, and offers Reload, not Upgrade", async () => {
    stubFetch(() => Promise.resolve(json({
      code: "schema_mismatch",
      message: "disk went away",
      data_state: "unknown",
      recovery: { kind: "command", command: "loctt migrate" },
      schema_status: {
        kind: "interrupted", from: "0.1.0", to: "0.3.0",
        backup: "/work/.loctt.backup-v0.1.0-2026", sentinel_path: "/work/.loctt/.schema-migration-in-progress",
      },
    }, 409)));
    const onUpgraded = render();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    const failed = await screen.findByTestId("upgrade-required-failed");
    expect(failed.getAttribute("role")).toBe("alert");
    expect(failed.textContent).toContain("The upgrade didn't finish. disk went away");
    expect(failed.textContent).toContain("The tracker may be partly upgraded. Restore .loctt/ from this backup, then reload:");
    expect(failed.textContent).toContain("/work/.loctt.backup-v0.1.0-2026");
    expect(failed.textContent).not.toMatch(/[—;]/);
    expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(onUpgraded).not.toHaveBeenCalled();
  });

  it("refused before anything ran: the reason, nothing changed, and Upgrade stays", async () => {
    stubFetch(() => Promise.resolve(json({
      code: "conflict",
      message: "A schema migration is already running in another process.",
      data_state: "not_saved",
      recovery: { kind: "reload" },
    }, 409)));
    render();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    const failed = await screen.findByTestId("upgrade-required-failed");
    expect(failed.textContent).toContain("A schema migration is already running in another process.");
    expect(failed.textContent).toContain("Nothing was changed.");
    expect(screen.getByRole("button", { name: "Upgrade" }).hasAttribute("disabled")).toBe(false);
  });
});

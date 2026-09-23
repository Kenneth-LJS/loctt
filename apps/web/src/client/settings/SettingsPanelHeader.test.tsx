// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";

afterEach(cleanup);

/**
 * N-4 / UI-10: the shared header for the six settings config-list
 * panels. These pin the two things `PageHeader`'s own tests do not
 * cover, because they are specific to this wrapper:
 *
 *  - `settings-panel-title` lands on the `<h1>` itself, matching every
 *    existing consumer of that testid across the wider settings family
 *    (Backup/Diagnostics/GitSync/WorkflowPanelFrame/SidebarGroups) —
 *    not on `PageHeader`'s wrapping `<header>`.
 *  - the title renders at the settings family's own size (`text-lg`,
 *    15.75px), not `PageHeader`'s main-view size (`text-[1.0714rem]`,
 *    15.0px) — the whole reason this wrapper exists instead of a direct
 *    `PageHeader` call.
 */
describe("SettingsPanelHeader", () => {
  it("puts settings-panel-title on the <h1>, with the settings family's text-lg size", () => {
    render(<SettingsPanelHeader title="Labels" />);

    const title = screen.getByTestId("settings-panel-title");
    expect(title.tagName).toBe("H1");
    expect(title.textContent).toBe("Labels");
    expect(title.className).toContain("text-lg");
    expect(title.className).toContain("text-text-primary");
    // Not the main-view PageHeader size — that would silently re-open
    // the two-sizes-within-settings split this component exists to avoid.
    expect(title.className).not.toContain("text-[1.0714rem]");
  });

  it("does not put the testid on the wrapping <header> instead", () => {
    const { container } = render(<SettingsPanelHeader title="Labels" />);
    const header = container.querySelector("header");
    expect(header?.getAttribute("data-testid")).toBeNull();
  });

  it("renders the actions slot and keeps its controls reachable", () => {
    const onClick = vi.fn();
    render(
      <SettingsPanelHeader
        title="Sprints"
        actions={<button type="button" onClick={onClick}>New sprint</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("places the title and its actions in the same header row", () => {
    render(
      <SettingsPanelHeader
        title="Sprints"
        actions={<button type="button">New sprint</button>}
      />,
    );
    const title = screen.getByTestId("settings-panel-title");
    const action = screen.getByRole("button", { name: "New sprint" });
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(header?.contains(action)).toBe(true);
  });
});

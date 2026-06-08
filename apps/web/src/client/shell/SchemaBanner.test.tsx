// @vitest-environment jsdom
import type { SchemaStatusResponse } from "@loctt/contracts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SchemaBanner } from "./SchemaBanner.tsx";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SchemaBanner", () => {
  it("renders nothing for the current schema", () => {
    const { container } = render(
      <SchemaBanner status={{ kind: "current", version: 3 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a missing (uninitialized) tracker", () => {
    const { container } = render(<SchemaBanner status={{ kind: "missing" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("warns and points at `loctt migrate` for an outdated schema", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("outdated");
    expect(alert.textContent).toContain("loctt migrate");
    expect(alert.textContent).toContain("v2");
    expect(alert.textContent).toContain("v3");
    // No in-app migrate button in M1.1 — that lands in M4.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells the user to upgrade for a future schema", () => {
    render(<SchemaBanner status={{ kind: "future", on_disk: 5, current: 3 }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("future");
    expect(alert.textContent?.toLowerCase()).toContain("update loctt");
  });

  it("surfaces the message for an unknown schema", () => {
    const status: SchemaStatusResponse = { kind: "unknown", message: "could not parse version" };
    render(<SchemaBanner status={status} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("unknown");
    expect(alert.textContent).toContain("could not parse version");
  });
});

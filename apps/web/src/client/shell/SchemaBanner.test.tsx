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

  it("banners a missing .schema-version and points at `loctt migrate`", () => {
    // Previously rendered nothing, on the theory that the bootstrap
    // routed this to the init wizard — which is a stub, so nothing
    // routed anywhere and the user saw an unexplained broken app.
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("missing");
    expect(alert.textContent).toContain("loctt migrate");
  });

  it("does not offer to reinitialize a tracker with a missing version", () => {
    // A .loctt/ holding tasks but no version file is a DAMAGED tracker,
    // not an empty one. Offering init/reinitialize here is the one path
    // that can destroy real data, so the copy must not suggest it.
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).not.toMatch(/loctt init/);
    expect(text).toMatch(/not reinitialize|Do not\s+reinitialize/i);
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

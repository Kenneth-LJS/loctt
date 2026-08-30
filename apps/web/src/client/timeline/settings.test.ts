import type { SavedQuery, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  dependencyKey,
  dependencyRelationshipStatus,
  resolveArrows,
  resolveGrouping,
  resolveZoom,
} from "./settings.ts";

/**
 * The precedence chain (TML-1, TML-2, TML-8, TML-15) and the
 * dependency-key resolution (TML-14, and the reporting half of TML-34).
 */

function wf(timeline?: WorkflowConfig["timeline"], relationships: { key: string }[] = []): WorkflowConfig {
  return { relationships, ...(timeline !== undefined ? { timeline } : {}) } as unknown as WorkflowConfig;
}

function view(display: SavedQuery["display"]): SavedQuery {
  return { id: "v1", name: "V", query: "true", display } as SavedQuery;
}

describe("resolveZoom", () => {
  // @verifies TML-1
  it("uses workflow.timeline.default_zoom over the built-in week", () => {
    const r = resolveZoom({ workflow: wf({ default_zoom: "month" }) });
    expect(r.value).toBe("month");
    expect(r.source).toBe("workspace");
  });

  // @verifies TML-1
  it("falls back to week — not day — when default_zoom is absent", () => {
    // TML-1's third bullet names `week` and rules out `day` explicitly.
    expect(resolveZoom({ workflow: wf({}) }).value).toBe("week");
    expect(resolveZoom({}).value).toBe("week");
  });

  // @verifies TML-2
  it("lets a saved view's display.zoom beat the workspace default", () => {
    const r = resolveZoom({
      view: view({ mode: "timeline", zoom: "day" }),
      workflow: wf({ default_zoom: "month" }),
    });
    expect(r.value).toBe("day");
    expect(r.source).toBe("view");
  });

  // @verifies TML-1
  it("lets the URL beat both config layers, so a pasted URL is faithful", () => {
    // TML-1: the URL opens the same zoom "regardless of the workspace
    // default".
    const r = resolveZoom({
      urlZoom: "day",
      view: view({ mode: "timeline", zoom: "week" }),
      workflow: wf({ default_zoom: "month" }),
    });
    expect(r.value).toBe("day");
    expect(r.source).toBe("url");
  });
});

describe("resolveGrouping", () => {
  // @verifies TML-8
  it("uses default_grouping from config", () => {
    expect(resolveGrouping({ workflow: wf({ default_grouping: "assignee" }) }).value).toBe("assignee");
  });

  // @verifies TML-8
  it("opens at none when default_grouping is absent", () => {
    expect(resolveGrouping({ workflow: wf({}) }).value).toBe("none");
  });

  // @verifies TML-8
  it("lets a URL grouping of none override a workspace default of assignee", () => {
    // TML-8: "pasting the `none` URL opens ungrouped even though the
    // workspace default is assignee". `none` is a real value, not an
    // absence — a truthiness check here would silently fall through.
    const r = resolveGrouping({
      urlGrouping: "none",
      workflow: wf({ default_grouping: "assignee" }),
    });
    expect(r.value).toBe("none");
    expect(r.source).toBe("url");
  });
});

describe("resolveArrows", () => {
  // @verifies TML-15
  it("defaults from workflow.timeline.show_arrows", () => {
    expect(resolveArrows({ workflow: wf({ show_arrows: false }) }).value).toBe(false);
  });

  // @verifies TML-15
  it("defaults to on when show_arrows is absent", () => {
    expect(resolveArrows({ workflow: wf({}) }).value).toBe(true);
  });

  // @verifies TML-15
  it("honours an explicit false from the URL over a config true", () => {
    // `false` must survive the chain: a truthiness test would treat it
    // as "unset" and re-enable arrows the user turned off.
    const r = resolveArrows({ urlArrows: false, workflow: wf({ show_arrows: true }) });
    expect(r.value).toBe(false);
    expect(r.source).toBe("url");
  });
});

describe("dependencyKey / dependencyRelationshipStatus", () => {
  // @verifies TML-14
  it("returns the configured key when it resolves", () => {
    const config = wf({ dependency_relationship: "blocks" }, [{ key: "blocks" }]);
    expect(dependencyKey(config)).toBe("blocks");
    expect(dependencyRelationshipStatus(config)).toEqual({ kind: "ok", key: "blocks" });
  });

  // @verifies TML-14
  it("draws nothing when the field is absent or explicitly null", () => {
    // TML-14's last bullet treats both the same.
    expect(dependencyKey(wf({}))).toBeUndefined();
    expect(dependencyKey(wf({ dependency_relationship: null }))).toBeUndefined();
    expect(dependencyRelationshipStatus(wf({})).kind).toBe("none");
    expect(dependencyRelationshipStatus(wf({ dependency_relationship: null })).kind).toBe("none");
  });

  /**
   * The reporting half of TML-34's third bullet. Core used to delete a
   * dangling value from workflow.yaml, so this state was unreachable
   * and the missing key could not be named. It is reachable now.
   *
   * M3.3b renders the notice; this proves the fact and the name are
   * available to it.
   */
  // @verifies TML-14
  it("reports a dangling reference as missing, by name, rather than as absent", () => {
    const config = wf({ dependency_relationship: "dpends_on" }, [{ key: "blocks" }]);
    const status = dependencyRelationshipStatus(config);
    expect(status).toEqual({ kind: "missing", key: "dpends_on" });
    // Distinguishable from "not configured" — the two must not
    // collapse, or the notice cannot tell the user which happened.
    expect(status.kind).not.toBe("none");
  });
});

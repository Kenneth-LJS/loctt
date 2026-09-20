import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECTION,
  findSection,
  sectionsInGroup,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsGroup,
} from "./sections.ts";

/**
 * The settings information architecture (SET-2, A64).
 *
 * The nav, the route's section resolution, and the not-found state all
 * read from this one data module, so a structural mistake here — a
 * section in no group, a default that does not resolve, a group out of
 * order — is a whole-surface bug. These guards pin the approved IA so a
 * later regroup cannot silently drift.
 */
describe("settings sections IA (SET-2, A64)", () => {
  it("has exactly the four approved groups, frequency-ordered with System last", () => {
    expect(SETTINGS_GROUPS).toEqual(["Content", "Workflow", "Personal", "System"]);
  });

  it("lands a bare /settings on a section that resolves", () => {
    const landing = findSection(DEFAULT_SECTION);
    expect(landing).toBeDefined();
    // Ken's call: land on Projects.
    expect(DEFAULT_SECTION).toBe("projects");
    // …and Projects is the first section in the first group, so the
    // landing panel is also the first thing the nav lists.
    expect(SETTINGS_SECTIONS[0]?.id).toBe("projects");
    expect(sectionsInGroup("Content")[0]?.id).toBe("projects");
  });

  it("maps every section to exactly one of the four groups (drift guard)", () => {
    const allowed = new Set<SettingsGroup>(SETTINGS_GROUPS);
    for (const section of SETTINGS_SECTIONS) {
      expect(allowed.has(section.group)).toBe(true);
    }
    // Every declared group has real members — no empty catch-all (A63).
    for (const group of SETTINGS_GROUPS) {
      expect(sectionsInGroup(group).length).toBeGreaterThan(0);
    }
    // The grouped links reconstruct the full section set with no loss and
    // no duplication — i.e. the union of the four groups IS every section.
    const grouped = SETTINGS_GROUPS.flatMap(g => sectionsInGroup(g));
    expect(grouped).toHaveLength(SETTINGS_SECTIONS.length);
    expect(new Set(grouped.map(s => s.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it("orders the Content group Projects-first, per the approved IA", () => {
    expect(sectionsInGroup("Content").map(s => s.id)).toEqual([
      "projects",
      "saved-views",
      "labels",
      "milestones",
      "sprints",
    ]);
  });

  it("puts Diagnostics in System and last of all sections", () => {
    const diagnostics = findSection("diagnostics");
    expect(diagnostics?.group).toBe("System");
    // Diagnostics is the last section overall (A64: System last, and
    // Diagnostics last within System).
    expect(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]?.id).toBe("diagnostics");
    expect(sectionsInGroup("System").map(s => s.id)).toEqual([
      "users",
      "sync",
      "backup",
      "diagnostics",
    ]);
  });
});

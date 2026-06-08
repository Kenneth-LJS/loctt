import type { UserSettings } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { ALL_COLUMNS, resolveColumns } from "./columns.ts";

const settings = (list_columns: unknown): UserSettings =>
  ({ list_columns }) as unknown as UserSettings;

describe("resolveColumns", () => {
  it("returns all columns in default order when no setting is present", () => {
    expect(resolveColumns(undefined).map(c => c.id)).toEqual(ALL_COLUMNS.map(c => c.id));
  });

  it("respects a user's column order + visibility", () => {
    const cols = resolveColumns(settings(["title", "status", "key"]));
    expect(cols.map(c => c.id)).toEqual(["title", "status", "key"]);
  });

  it("drops unknown column ids from a stale setting", () => {
    const cols = resolveColumns(settings(["title", "removed_column", "status"]));
    expect(cols.map(c => c.id)).toEqual(["title", "status"]);
  });

  it("falls back to defaults when the setting resolves to nothing", () => {
    expect(resolveColumns(settings(["totally", "unknown"])).map(c => c.id)).toEqual(
      ALL_COLUMNS.map(c => c.id),
    );
  });

  it("ignores a non-array list_columns", () => {
    expect(resolveColumns(settings("title,status")).map(c => c.id)).toEqual(
      ALL_COLUMNS.map(c => c.id),
    );
  });
});

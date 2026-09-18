/**
 * Registry-level invariants. These are unit-level checks that run
 * fast (no MCP server spawn) and catch the obvious refactor
 * regressions: a duplicate tool name, a missing handler, a
 * description blanked out by an autofix, an inputSchema that
 * isn't a plain record of zod schemas.
 *
 * The wire-format end-to-end contract (snapshot of every tool
 * name) lives in tests/e2e/11-mcp-schema-contract.test.ts.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { listRegisteredTools, lookupTool, stripHandler } from "./registry.js";

describe("MCP tool registry", () => {
  const tools = listRegisteredTools();

  it("exposes at least the legacy tool count", () => {
    // The pre-registry getTools() array carried 53 tools. If a
    // future refactor accidentally drops a group, this fails
    // before the e2e snapshot does.
    expect(tools.length).toBeGreaterThanOrEqual(53);
  });

  it("has unique tool names", () => {
    const names = tools.map(t => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every tool has a non-empty description", () => {
    for (const t of tools) {
      expect(t.description.trim().length, t.name).toBeGreaterThan(0);
    }
  });

  it("every tool has a handler", () => {
    for (const t of tools) {
      expect(typeof t.handler, t.name).toBe("function");
    }
  });

  it("every inputSchema is a record of zod schemas", () => {
    for (const t of tools) {
      for (const [field, schema] of Object.entries(t.inputSchema)) {
        expect(schema, `${t.name}.${field}`).toBeInstanceOf(z.ZodType);
      }
    }
  });

  it("exactly two tools are exempt from the schema guard", () => {
    // Deliberately an allowlist, not a rule: an exemption lets a tool
    // run against a tracker whose layout this build may not
    // understand, so each one must be justified here.
    //
    //   init           — runs before a tracker exists at all
    //   migrate_schema — IS the remedy for a mismatch; gating it
    //                    behind one makes an outdated tracker
    //                    unfixable from this surface
    //
    // Anything else appearing in this list is a bug.
    const exempt = tools.filter(t => t.exemptFromSchemaGuard === true);
    expect(exempt.map(t => t.name).sort()).toEqual(["init", "migrate_schema"]);
  });

  it("lookupTool returns the same instance listed", () => {
    for (const t of tools) {
      expect(lookupTool(t.name)).toBe(t);
    }
    expect(lookupTool("nonexistent_tool")).toBeUndefined();
  });

  it("stripHandler produces the wire-format shape", () => {
    const sample = tools[0]!;
    const wire = stripHandler(sample);
    expect(wire).toEqual({
      name: sample.name,
      description: sample.description,
      inputSchema: sample.inputSchema,
    });
    expect("handler" in wire).toBe(false);
  });
});

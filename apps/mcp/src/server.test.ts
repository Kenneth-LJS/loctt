import { describe, expect, it, vi } from "vitest";

import { MCP_INSTRUCTIONS } from "./server.js";

/**
 * First-run / new-user UX: a cold agent that never reads the MCP
 * reference doc still needs the load-bearing rules. The server hands
 * them over as `instructions` on connect. These lock in both the
 * content and that the server is actually constructed with it.
 *
 * Moved here from the CLI with the server itself (A352): `loctt mcp`
 * and `loctt-mcp` both run `startMcpServer`, so this covers both.
 */
describe("MCP server instructions", () => {
  it("MCP_INSTRUCTIONS carries the load-bearing agent guidance", () => {
    // Use the structured tools, not raw file edits.
    expect(MCP_INSTRUCTIONS).toMatch(/structured tools|task\.md frontmatter/i);
    // Discover valid enum values before writing.
    expect(MCP_INSTRUCTIONS).toContain("get_workflow_config");
    // Deletes are irreversible.
    expect(MCP_INSTRUCTIONS.toLowerCase()).toMatch(/irreversible|confirm: true/);
  });

  it("constructs the McpServer with the instructions string", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];

    vi.doMock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
      McpServer: class {
        constructor(_info: Record<string, unknown>, options?: Record<string, unknown>) {
          seen.push(options);
        }
        registerTool(): void { /* no-op */ }
        connect(): Promise<void> { return Promise.resolve(); }
      },
    }));
    vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
      StdioServerTransport: class {},
    }));

    // Re-import so the mocked dynamic imports are used.
    const mod = await import("./server.js");
    await mod.startMcpServer("/tmp/does-not-matter");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.["instructions"]).toBe(MCP_INSTRUCTIONS);

    vi.doUnmock("@modelcontextprotocol/sdk/server/mcp.js");
    vi.doUnmock("@modelcontextprotocol/sdk/server/stdio.js");
  });
});

import { describe, it, expect } from "vitest";
import { createMcpServer } from "./index.js";

describe("MCP entry point", () => {
  it("exports createMcpServer", () => {
    expect(typeof createMcpServer).toBe("function");
  });

  it("returns a placeholder server object", () => {
    const server = createMcpServer();
    expect(server).toEqual({ started: false });
  });
});

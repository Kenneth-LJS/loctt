import { describe, it, expect } from "vitest";
import { createService } from "./index.js";

describe("Service entry point", () => {
  it("exports createService", () => {
    expect(typeof createService).toBe("function");
  });

  it("returns a placeholder service object", () => {
    const service = createService();
    expect(service).toEqual({ started: false });
  });
});

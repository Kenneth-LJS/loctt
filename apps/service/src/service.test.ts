import { describe, it, expect } from "vitest";
import { createService } from "./index.js";

describe("Service entry point", () => {
  it("exports createService", () => {
    expect(typeof createService).toBe("function");
  });

  it("creates a service with start/stop methods", () => {
    const service = createService({ root: "/tmp/test-loctt" });
    expect(service).toBeDefined();
    expect(typeof service.start).toBe("function");
    expect(typeof service.stop).toBe("function");
  });
});

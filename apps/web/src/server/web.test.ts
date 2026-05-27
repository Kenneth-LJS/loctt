import { describe, expect,it } from "vitest";

import { createWebApp, LocttClient } from "./index.js";

describe("web app", () => {
  it("exports createWebApp", () => {
    expect(typeof createWebApp).toBe("function");
  });

  it("creates a web app with start/stop methods", () => {
    const app = createWebApp({ root: "/tmp/test-loctt" });
    expect(app).toBeDefined();
    expect(typeof app.start).toBe("function");
    expect(typeof app.stop).toBe("function");
  });

  it("exports LocttClient", () => {
    expect(typeof LocttClient).toBe("function");
  });

  it("LocttClient defaults to same-origin (empty base)", () => {
    const client = new LocttClient();
    expect(client).toBeDefined();
  });
});

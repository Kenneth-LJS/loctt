import { describe, it, expect, vi } from "vitest";
import { main } from "./index.js";

describe("CLI entry point", () => {
  it("exports a main function", () => {
    expect(typeof main).toBe("function");
  });

  it("writes to stdout and sets exit code", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const originalExitCode = process.exitCode;

    main();

    expect(writeSpy).toHaveBeenCalledWith("loctt: not yet implemented\n");
    expect(process.exitCode).toBe(1);

    writeSpy.mockRestore();
    process.exitCode = originalExitCode;
  });
});

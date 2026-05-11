import { vi } from "vitest";

import { main as cliMain } from "../../../apps/cli/src/index.js";
import type { Op, ScenarioAdapter } from "../scenarios/types.js";

/**
 * Drives the CLI by calling its exported `main()` in-process. Each op
 * sets up `process.cwd` and `process.argv`, runs main(), then restores.
 *
 * `withTmpLoctt` already snapshots/restores cwd/argv around the whole
 * scenario, so we don't have to worry about leaking those out of the
 * adapter.
 */
export const cliInProcessAdapter: ScenarioAdapter = {
  name: "cli-in-process",

  async run(ops, root) {
    const cwdBefore = process.cwd();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.chdir(root);
    try {
      for (const op of ops) {
        const args = opToCliArgs(op);
        process.argv = ["node", "loctt", ...args];
        process.exitCode = undefined;
        await cliMain();
        if (process.exitCode !== undefined && process.exitCode !== 0) {
          // Surface stderr so failures are debuggable.
          const captured = errSpy.mock.calls
            .flatMap(call => call.map(c => (typeof c === "string" ? c : "")))
            .join("\n");
          throw new Error(
            `cli-in-process: op ${JSON.stringify(op)} exited with code ${String(process.exitCode)}\nstderr: ${captured}`,
          );
        }
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      process.chdir(cwdBefore);
      process.exitCode = undefined;
    }
  },
};

export function opToCliArgs(op: Op): string[] {
  switch (op.kind) {
    case "create": {
      const args = ["create", op.title];
      if (op.status !== undefined) args.push("--status", op.status);
      if (op.priority !== undefined) args.push("--priority", op.priority);
      if (op.task_type !== undefined) args.push("--type", op.task_type);
      // body via create isn't a CLI flag — would need a follow-up `body --set`.
      return args;
    }
    case "set_field":
      return ["set", op.ref, op.field, op.value];
    case "unset_field":
      return ["unset", op.ref, op.field];
    case "replace_body":
      return ["body", op.ref, "--set", op.body];
    case "append_body":
      return ["body", op.ref, "--append", op.text];
    case "archive":
      return ["archive", op.ref];
    case "unarchive":
      return ["unarchive", op.ref];
    case "delete":
      return ["delete", op.ref, "--hard", "--yes"];
    case "link":
      return ["link", op.from, op.type, op.to];
    case "unlink":
      return ["unlink", op.from, op.type, op.to];
  }
}

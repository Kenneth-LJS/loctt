import { describe, expect, it } from "vitest";

import { cliInProcessAdapter } from "./adapters/cli-in-process.js";
import { cliSpawnAdapter } from "./adapters/cli-spawn-scenario.js";
import { mcpStdioAdapter } from "./adapters/mcp-stdio-scenario.js";
import { withTmpLoctt } from "./fixtures/tmp-loctt.js";
import { basicLifecycle } from "./scenarios/basic-lifecycle.js";
import { captureSnapshot, renderSnapshot } from "./scenarios/snapshot.js";
import type { Op, ScenarioAdapter } from "./scenarios/types.js";

const ALL_ADAPTERS: readonly ScenarioAdapter[] = [
  cliInProcessAdapter,
  cliSpawnAdapter,
  mcpStdioAdapter,
];

interface Scenario {
  readonly name: string;
  readonly ops: readonly Op[];
}

const SCENARIOS: readonly Scenario[] = [
  { name: "basic lifecycle", ops: basicLifecycle },
];

async function runScenarioAndSnapshot(adapter: ScenarioAdapter, ops: readonly Op[]): Promise<string> {
  let rendered = "";
  await withTmpLoctt(async ({ root }) => {
    await adapter.run(ops, root);
    const snap = await captureSnapshot(root);
    rendered = renderSnapshot(snap);
  });
  return rendered;
}

describe.each(SCENARIOS)("parity: $name", scenario => {
  it("produces identical .loctt/ across all adapters", async () => {
    const results: Array<{ adapter: string; rendered: string }> = [];
    for (const adapter of ALL_ADAPTERS) {
      const rendered = await runScenarioAndSnapshot(adapter, scenario.ops);
      results.push({ adapter: adapter.name, rendered });
    }

    // Compare all to the first; any divergence means a parity bug.
    const baseline = results[0]!;
    for (let i = 1; i < results.length; i++) {
      const other = results[i]!;
      // Use toEqual for a clear diff in failure output. Strings compare
      // line-by-line in vitest, which is exactly what we want.
      expect(
        other.rendered,
        `${other.adapter} diverged from ${baseline.adapter}`,
      ).toBe(baseline.rendered);
    }
  });
});

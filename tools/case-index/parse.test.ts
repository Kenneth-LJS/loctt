import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildIndex } from "./parse.ts";

/**
 * The parser's contract is that a malformed heading fails the build rather
 * than being skipped. Each test below names the drift it catches — a case
 * the index silently dropped is a case nothing will ever test.
 */

let root: string;

async function writeFlow(tree: "ui" | "surface", name: string, body: string): Promise<void> {
  const dir = path.join(root, `docs/dev/${tree}-test-cases`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "loctt-case-index-"));
  // buildIndex reads both trees; keep the unused one present but empty.
  await mkdir(path.join(root, "docs/dev/ui-test-cases"), { recursive: true });
  await mkdir(path.join(root, "docs/dev/surface-test-cases"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildIndex", () => {
  it("parses a UI case's tags, title, and source location", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["## A. Happy path", "", "### LST-1 · M1 · blocker · P2 P8", "**A claim.** Context here.", ""].join(
        "\n",
      ),
    );

    const index = await buildIndex(root);

    expect(index.cases).toHaveLength(1);
    expect(index.cases[0]).toEqual({
      id: "LST-1",
      tree: "ui",
      file: "docs/dev/ui-test-cases/flow-list.md",
      line: 3,
      title: "A claim.",
      milestone: "M1",
      severity: "blocker",
      principles: ["P2", "P8"],
      surfaces: ["UI"],
      resolved: false,
    });
  });

  it("parses a surface case's surface list and omits a milestone", async () => {
    await writeFlow(
      "surface",
      "flow-tasks.md",
      ["### TSK-C1 · major · P4 P10 · CLI MCP", "**Another claim.**", ""].join("\n"),
    );

    const index = await buildIndex(root);

    expect(index.cases[0]?.surfaces).toEqual(["CLI", "MCP"]);
    expect(index.cases[0]?.milestone).toBeUndefined();
  });

  it("reads a claim that wraps across lines", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["### LST-1 · M1 · minor · P2", "**A claim that runs on", "past one line.** Trailing prose.", ""].join(
        "\n",
      ),
    );

    const index = await buildIndex(root);

    expect(index.cases[0]?.title).toBe("A claim that runs on past one line.");
  });

  it("records the resolved suffix without dropping the case", async () => {
    await writeFlow(
      "surface",
      "flow-onboarding.md",
      ["### ONB-C1 · blocker · P4 P10 · CLI MCP — **resolved**", "**A closed gap.**", ""].join("\n"),
    );

    const index = await buildIndex(root);

    expect(index.cases).toHaveLength(1);
    expect(index.cases[0]?.resolved).toBe(true);
    expect(index.cases[0]?.surfaces).toEqual(["CLI", "MCP"]);
  });

  it("ignores section headings, which carry no case ID", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["### B.1 — Data shape and scale", "", "### A.2 Adding links", ""].join("\n"),
    );

    const index = await buildIndex(root);

    expect(index.cases).toHaveLength(0);
  });

  it("rejects a case whose ID is used twice", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["### LST-1 · M1 · minor · P2", "**First.**", ""].join("\n"),
    );
    await writeFlow(
      "ui",
      "flow-board.md",
      ["### LST-1 · M1 · minor · P2", "**Second.**", ""].join("\n"),
    );

    await expect(buildIndex(root)).rejects.toThrow(/Duplicate case IDs[\s\S]*LST-1/);
  });

  it("rejects a UI case with no milestone tag", async () => {
    await writeFlow("ui", "flow-list.md", ["### LST-1 · blocker · P2", "**A claim.**", ""].join("\n"));

    await expect(buildIndex(root)).rejects.toThrow(/no milestone tag/);
  });

  it("rejects a surface case tagged with a milestone", async () => {
    await writeFlow(
      "surface",
      "flow-tasks.md",
      ["### TSK-C1 · M1 · blocker · P2 · CLI", "**A claim.**", ""].join("\n"),
    );

    await expect(buildIndex(root)).rejects.toThrow(/carries a milestone tag/);
  });

  it("rejects a case with no severity", async () => {
    await writeFlow("ui", "flow-list.md", ["### LST-1 · M1 · P2", "**A claim.**", ""].join("\n"));

    await expect(buildIndex(root)).rejects.toThrow(/no severity tag/);
  });

  it("rejects a case with an unrecognized tag rather than skipping it", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["### LST-1 · M1 · blocker · P2 · someday", "**A claim.**", ""].join("\n"),
    );

    await expect(buildIndex(root)).rejects.toThrow(/unrecognized tag "someday"/);
  });

  it("rejects a case with no bolded claim, which would index an empty title", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["### LST-1 · M1 · blocker · P2", "Just prose, no claim.", ""].join("\n"),
    );

    await expect(buildIndex(root)).rejects.toThrow(/no bolded claim/);
  });

  it("reports the file and line of a malformed heading", async () => {
    await writeFlow(
      "ui",
      "flow-list.md",
      ["", "", "### LST-9 · M1 · nope · P2", "**A claim.**", ""].join("\n"),
    );

    await expect(buildIndex(root)).rejects.toThrow(
      /docs\/dev\/ui-test-cases\/flow-list\.md:3/,
    );
  });
});

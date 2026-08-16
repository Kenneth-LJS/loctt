import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C7
 * @verifies PRU-C5
 *
 * `delete_user`'s reference guard existed in core and never fired,
 * because `setField` stored the user's **name** in `assignee` while
 * `deleteUser` filtered tasks by **id**. The filter matched nothing, so
 * a user with two task references was hard-deleted on `confirm: true`
 * alone, reporting `remappedAssigneeCount: 0` — and the tasks were left
 * pointing at a user that no longer existed.
 *
 * The same root cause silently defeated the archived-reference guard,
 * which also compares `assignee` against archived user **ids**.
 */

/** Creates a user and points one task's assignee and another's reporter at them. */
async function withReferencedUser(
  root: string,
  name = "Alice",
): Promise<void> {
  await runCli(["user", "create", name], { cwd: root });
  await runCli(["create", "task one"], { cwd: root });
  await runCli(["create", "task two"], { cwd: root });
  await runCli(["set", "T-1", "assignee", name], { cwd: root });
  await runCli(["set", "T-2", "reporter", name], { cwd: root });
}

describe("MCP delete_user guards (stdio)", () => {
  it("stores the user id, not the name, on assignee and reporter", async () => {
    await withTmpLoctt(async ({ root }) => {
      await withReferencedUser(root);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: "T-1" });
        const task = JSON.parse(result.content[0]?.text ?? "{}") as { assignee?: string };
        // A ULID, not "Alice". Storing the name is what made every
        // id-based guard a no-op.
        expect(task.assignee).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
        expect(task.assignee).not.toBe("Alice");
      } finally {
        await client.close();
      }
    });
  });

  it("refuses without confirm and removes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await withReferencedUser(root);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_user", { ref: "Alice" });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toMatch(/confirm/i);

        // Still there.
        const users = await readdir(path.join(root, ".loctt/users"));
        expect(users.length).toBeGreaterThan(1);
      } finally {
        await client.close();
      }
    });
  });

  it("refuses a referenced user and states the reference count", async () => {
    await withTmpLoctt(async ({ root }) => {
      await withReferencedUser(root);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_user", { ref: "Alice", confirm: true });
        // The failure being fixed: this used to succeed, delete the
        // user, and report zero remapped references.
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toMatch(/2 task reference/);
        // Named, not a raw ULID (P-4): the caller addressed them by name.
        expect(text).toContain("Alice");
        expect(text).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);

        // And nothing was removed.
        const check = await client.callTool("get_task", { ref: "T-1" });
        const task = JSON.parse(check.content[0]?.text ?? "{}") as { assignee?: string };
        expect(task.assignee).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  it("rejects remap_to and unassign together", async () => {
    await withTmpLoctt(async ({ root }) => {
      await withReferencedUser(root);
      await runCli(["user", "create", "Bob"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_user", {
          ref: "Alice",
          confirm: true,
          remap_to: "Bob",
          unassign: true,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toMatch(/mutually exclusive/);
      } finally {
        await client.close();
      }
    });
  });

  it("clears references and removes the user folder with unassign", async () => {
    await withTmpLoctt(async ({ root }) => {
      await withReferencedUser(root);
      const before = await readdir(path.join(root, ".loctt/users"));

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_user", {
          ref: "Alice",
          confirm: true,
          unassign: true,
        });
        expect(result.isError).toBeFalsy();

        // Both fields become absent, not empty strings.
        for (const ref of ["T-1", "T-2"]) {
          const got = await client.callTool("get_task", { ref });
          const task = JSON.parse(got.content[0]?.text ?? "{}") as {
            assignee?: string;
            reporter?: string;
          };
          expect(task.assignee).toBeUndefined();
          expect(task.reporter).toBeUndefined();
        }

        // And the folder is gone from disk.
        const after = await readdir(path.join(root, ".loctt/users"));
        expect(after.length).toBe(before.length - 1);
      } finally {
        await client.close();
      }
    });
  });

  it("addresses a project by name and reports ambiguity with both ids", async () => {
    await withTmpLoctt(async ({ root }) => {
      // PRU-C5: names are not unique, so name-addressing must fail
      // loudly rather than picking one.
      await runCli(["project", "create", "Backend", "--prefix", "B1"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok = await client.callTool("edit_project", {
          project: "Backend",
          name: "Backend Services",
        });
        expect(ok.isError).toBeFalsy();

        // Now make the name ambiguous.
        await runCli(["project", "create", "Shared", "--prefix", "S1"], { cwd: root });
        await runCli(["project", "create", "Shared", "--prefix", "S2"], { cwd: root });

        const clash = await client.callTool("edit_project", {
          project: "Shared",
          name: "Renamed",
        });
        expect(clash.isError).toBe(true);
        const text = clash.content[0]?.text ?? "";
        expect(text).toMatch(/ambiguous/i);
        // Both ids, so the agent can retry unambiguously — a message
        // that only says "ambiguous" leaves it with no next move.
        expect(text.match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? []).toHaveLength(2);
      } finally {
        await client.close();
      }
    });
  });

  it("resolves a project name on duplicate_task (P-3)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["create", "original"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok = await client.callTool("duplicate_task", {
          ref: "T-1",
          project: "Backend",
        });
        // The CLI twin was fixed earlier; this one still forwarded the
        // raw name, so the allocator failed on it.
        expect(ok.isError).toBeFalsy();
        expect(ok.content[0]?.text ?? "").not.toMatch(/key allocation state/);

        const bogus = await client.callTool("duplicate_task", {
          ref: "T-1",
          project: "NoSuchProject",
        });
        expect(bogus.isError).toBe(true);
        const text = bogus.content[0]?.text ?? "";
        expect(text).toMatch(/unknown project/i);
        // An allocator internal is not an answer an agent can act on,
        // and it was identical for a real project and a bogus one.
        expect(text).not.toMatch(/key allocation state/);
      } finally {
        await client.close();
      }
    });
  });
});

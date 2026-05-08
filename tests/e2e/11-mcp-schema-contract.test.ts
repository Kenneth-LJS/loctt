import { describe, expect, it } from "vitest";

import { startMcpClient } from "../integration/adapters/mcp-stdio.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: MCP schema contract", () => {
  it("tool list matches the recorded snapshot (names + has-description)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const tools = await client.listTools();
        // Capture name + a boolean for whether the description is non-empty.
        // Avoids snapshotting full descriptions (too noisy) while still
        // catching accidental description deletions.
        const summary = tools
          .map(t => ({ name: t.name, hasDescription: (t.description ?? "").trim().length > 0 }))
          .sort((a, b) => a.name.localeCompare(b.name));

        expect(summary).toMatchInlineSnapshot(`
          [
            {
              "hasDescription": true,
              "name": "append_task_body",
            },
            {
              "hasDescription": true,
              "name": "archive_task",
            },
            {
              "hasDescription": true,
              "name": "attach_file",
            },
            {
              "hasDescription": true,
              "name": "config_get",
            },
            {
              "hasDescription": true,
              "name": "config_list",
            },
            {
              "hasDescription": true,
              "name": "config_set",
            },
            {
              "hasDescription": true,
              "name": "config_unset",
            },
            {
              "hasDescription": true,
              "name": "create_task",
            },
            {
              "hasDescription": true,
              "name": "delete_task",
            },
            {
              "hasDescription": true,
              "name": "detach_file",
            },
            {
              "hasDescription": true,
              "name": "doctor",
            },
            {
              "hasDescription": true,
              "name": "get_config",
            },
            {
              "hasDescription": true,
              "name": "get_task",
            },
            {
              "hasDescription": true,
              "name": "git_disable",
            },
            {
              "hasDescription": true,
              "name": "git_enable",
            },
            {
              "hasDescription": true,
              "name": "git_publish",
            },
            {
              "hasDescription": true,
              "name": "git_status",
            },
            {
              "hasDescription": true,
              "name": "git_sync",
            },
            {
              "hasDescription": true,
              "name": "info",
            },
            {
              "hasDescription": true,
              "name": "init",
            },
            {
              "hasDescription": true,
              "name": "link_tasks",
            },
            {
              "hasDescription": true,
              "name": "list_tasks",
            },
            {
              "hasDescription": true,
              "name": "list_views",
            },
            {
              "hasDescription": true,
              "name": "replace_task_body",
            },
            {
              "hasDescription": true,
              "name": "task_history",
            },
            {
              "hasDescription": true,
              "name": "unarchive_task",
            },
            {
              "hasDescription": true,
              "name": "unlink_tasks",
            },
            {
              "hasDescription": true,
              "name": "unset_field",
            },
            {
              "hasDescription": true,
              "name": "update_task",
            },
          ]
        `);
      } finally {
        await client.close();
      }
    });
  });
});

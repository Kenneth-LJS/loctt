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
              "name": "get_calendar",
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
              "name": "label_archive",
            },
            {
              "hasDescription": true,
              "name": "label_create",
            },
            {
              "hasDescription": true,
              "name": "label_delete",
            },
            {
              "hasDescription": true,
              "name": "label_edit",
            },
            {
              "hasDescription": true,
              "name": "label_list",
            },
            {
              "hasDescription": true,
              "name": "label_unarchive",
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
              "name": "milestone_archive",
            },
            {
              "hasDescription": true,
              "name": "milestone_create",
            },
            {
              "hasDescription": true,
              "name": "milestone_delete",
            },
            {
              "hasDescription": true,
              "name": "milestone_edit",
            },
            {
              "hasDescription": true,
              "name": "milestone_list",
            },
            {
              "hasDescription": true,
              "name": "milestone_unarchive",
            },
            {
              "hasDescription": true,
              "name": "project_archive",
            },
            {
              "hasDescription": true,
              "name": "project_create",
            },
            {
              "hasDescription": true,
              "name": "project_delete",
            },
            {
              "hasDescription": true,
              "name": "project_edit",
            },
            {
              "hasDescription": true,
              "name": "project_list",
            },
            {
              "hasDescription": true,
              "name": "project_set_default",
            },
            {
              "hasDescription": true,
              "name": "project_unarchive",
            },
            {
              "hasDescription": true,
              "name": "reorder_relationship",
            },
            {
              "hasDescription": true,
              "name": "replace_task_body",
            },
            {
              "hasDescription": true,
              "name": "sprint_archive",
            },
            {
              "hasDescription": true,
              "name": "sprint_create",
            },
            {
              "hasDescription": true,
              "name": "sprint_delete",
            },
            {
              "hasDescription": true,
              "name": "sprint_edit",
            },
            {
              "hasDescription": true,
              "name": "sprint_list",
            },
            {
              "hasDescription": true,
              "name": "sprint_unarchive",
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
            {
              "hasDescription": true,
              "name": "user_archive",
            },
            {
              "hasDescription": true,
              "name": "user_create",
            },
            {
              "hasDescription": true,
              "name": "user_current",
            },
            {
              "hasDescription": true,
              "name": "user_delete",
            },
            {
              "hasDescription": true,
              "name": "user_edit",
            },
            {
              "hasDescription": true,
              "name": "user_list",
            },
            {
              "hasDescription": true,
              "name": "user_switch",
            },
            {
              "hasDescription": true,
              "name": "user_unarchive",
            },
          ]
        `);
      } finally {
        await client.close();
      }
    });
  });
});

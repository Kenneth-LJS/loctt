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
              "name": "archive_label",
            },
            {
              "hasDescription": true,
              "name": "archive_milestone",
            },
            {
              "hasDescription": true,
              "name": "archive_project",
            },
            {
              "hasDescription": true,
              "name": "archive_sprint",
            },
            {
              "hasDescription": true,
              "name": "archive_task",
            },
            {
              "hasDescription": true,
              "name": "archive_user",
            },
            {
              "hasDescription": true,
              "name": "attach_file",
            },
            {
              "hasDescription": true,
              "name": "bulk_update_tasks",
            },
            {
              "hasDescription": true,
              "name": "create_label",
            },
            {
              "hasDescription": true,
              "name": "create_milestone",
            },
            {
              "hasDescription": true,
              "name": "create_project",
            },
            {
              "hasDescription": true,
              "name": "create_sprint",
            },
            {
              "hasDescription": true,
              "name": "create_task",
            },
            {
              "hasDescription": true,
              "name": "create_user",
            },
            {
              "hasDescription": true,
              "name": "delete_comment",
            },
            {
              "hasDescription": true,
              "name": "delete_label",
            },
            {
              "hasDescription": true,
              "name": "delete_milestone",
            },
            {
              "hasDescription": true,
              "name": "delete_project",
            },
            {
              "hasDescription": true,
              "name": "delete_sprint",
            },
            {
              "hasDescription": true,
              "name": "delete_task",
            },
            {
              "hasDescription": true,
              "name": "delete_user",
            },
            {
              "hasDescription": true,
              "name": "detach_file",
            },
            {
              "hasDescription": true,
              "name": "disable_git",
            },
            {
              "hasDescription": true,
              "name": "doctor",
            },
            {
              "hasDescription": true,
              "name": "duplicate_task",
            },
            {
              "hasDescription": true,
              "name": "edit_comment",
            },
            {
              "hasDescription": true,
              "name": "edit_label",
            },
            {
              "hasDescription": true,
              "name": "edit_milestone",
            },
            {
              "hasDescription": true,
              "name": "edit_project",
            },
            {
              "hasDescription": true,
              "name": "edit_sprint",
            },
            {
              "hasDescription": true,
              "name": "edit_user",
            },
            {
              "hasDescription": true,
              "name": "enable_git",
            },
            {
              "hasDescription": true,
              "name": "get_calendar",
            },
            {
              "hasDescription": true,
              "name": "get_config_value",
            },
            {
              "hasDescription": true,
              "name": "get_current_user",
            },
            {
              "hasDescription": true,
              "name": "get_git_status",
            },
            {
              "hasDescription": true,
              "name": "get_sprint_burndown",
            },
            {
              "hasDescription": true,
              "name": "get_task",
            },
            {
              "hasDescription": true,
              "name": "get_task_history",
            },
            {
              "hasDescription": true,
              "name": "get_user_settings",
            },
            {
              "hasDescription": true,
              "name": "get_workflow_config",
            },
            {
              "hasDescription": true,
              "name": "get_workflow_key_usage",
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
              "name": "list_comments",
            },
            {
              "hasDescription": true,
              "name": "list_config_values",
            },
            {
              "hasDescription": true,
              "name": "list_labels",
            },
            {
              "hasDescription": true,
              "name": "list_milestones",
            },
            {
              "hasDescription": true,
              "name": "list_projects",
            },
            {
              "hasDescription": true,
              "name": "list_sprints",
            },
            {
              "hasDescription": true,
              "name": "list_tasks",
            },
            {
              "hasDescription": true,
              "name": "list_users",
            },
            {
              "hasDescription": true,
              "name": "list_views",
            },
            {
              "hasDescription": true,
              "name": "migrate_schema",
            },
            {
              "hasDescription": true,
              "name": "move_board_card",
            },
            {
              "hasDescription": true,
              "name": "move_task",
            },
            {
              "hasDescription": true,
              "name": "post_comment",
            },
            {
              "hasDescription": true,
              "name": "publish_to_git",
            },
            {
              "hasDescription": true,
              "name": "reorder_board",
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
              "name": "set_config_value",
            },
            {
              "hasDescription": true,
              "name": "set_default_project",
            },
            {
              "hasDescription": true,
              "name": "set_project_prefix",
            },
            {
              "hasDescription": true,
              "name": "sweep_sidebar_pins",
            },
            {
              "hasDescription": true,
              "name": "switch_user",
            },
            {
              "hasDescription": true,
              "name": "sync_from_git",
            },
            {
              "hasDescription": true,
              "name": "unarchive_label",
            },
            {
              "hasDescription": true,
              "name": "unarchive_milestone",
            },
            {
              "hasDescription": true,
              "name": "unarchive_project",
            },
            {
              "hasDescription": true,
              "name": "unarchive_sprint",
            },
            {
              "hasDescription": true,
              "name": "unarchive_task",
            },
            {
              "hasDescription": true,
              "name": "unarchive_user",
            },
            {
              "hasDescription": true,
              "name": "unlink_tasks",
            },
            {
              "hasDescription": true,
              "name": "unset_config_value",
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

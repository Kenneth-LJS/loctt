/**
 * Project lifecycle tools. Reads and writes projects.yaml plus the
 * workspace-default pointer. Hard-delete carries a `remap_to`
 * escape hatch for projects that own tasks.
 *
 * Domain ProjectError lands at the dispatcher's outer catch via
 * isKnownDomainError, so per-handler try/catches are omitted —
 * matches the task-crud pattern.
 */

import {
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  loadProjectsConfig,
  setDefaultProject,
  unarchiveProject,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_projects",
    description: "List projects defined in projects.yaml. Returns each project's key, label, prefix, and which (if any) is the workspace default.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadProjectsConfig(locttDir);
      return text(JSON.stringify({
        projects: cfg.projects,
        default: cfg.default ?? null,
      }, null, 2));
    },
  },
  {
    name: "create_project",
    description: "Create a new project. Project keys are immutable; prefixes must be unique across the tracker. Setting `make_default` true also sets the workspace default.",
    inputSchema: {
      key: z.string().describe("Slug identifier (lowercase letters, digits, hyphen, underscore)"),
      label: z.string().describe("Human-readable label"),
      prefix: z.string().describe("Task-key prefix, e.g. BACKEND-"),
      make_default: z.boolean().optional().describe("If true, also set this project as the workspace default"),
    },
    handler: async ({ locttDir }, args) => {
      await createProject(locttDir, {
        key: args["key"] as string,
        label: args["label"] as string,
        prefix: args["prefix"] as string,
      });
      if (args["make_default"] === true) {
        await setDefaultProject(locttDir, args["key"] as string);
      }
      return text(`Created project ${String(args["key"])}`);
    },
  },
  {
    name: "edit_project",
    description: "Edit an existing project. Only `label` is mutable — `key` and `prefix` are immutable after creation.",
    inputSchema: {
      key: z.string(),
      label: z.string().describe("New label"),
    },
    handler: async ({ locttDir }, args) => {
      await editProject(locttDir, args["key"] as string, {
        label: args["label"] as string,
      });
      return text(`Updated project ${String(args["key"])}`);
    },
  },
  {
    name: "delete_project",
    description:
      "Permanently remove a project from projects.yaml. For projects with tasks, " +
      "`remap_to` is required to migrate them to another project. Cannot delete the only " +
      "project. The counter is preserved in retired_keys so a later create with the same " +
      "key resumes numbering. Use `archive_project` for the reversible (soft) variant. " +
      "Always requires `confirm: true`.",
    inputSchema: {
      key: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target project key for tasks in the deleted project"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_project");
      if (blocked) return blocked;
      const remapTo = args["remap_to"] as string | undefined;
      const result = await deleteProject(locttDir, args["key"] as string, {
        hard: true,
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      return text(JSON.stringify({
        key: args["key"],
        remappedTaskCount: result.remappedTaskCount,
      }, null, 2));
    },
  },
  {
    name: "archive_project",
    description: "Mark a project as archived. Archived projects are hidden from default lists and pickers. Reversible via `unarchive_project`.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await archiveProject(locttDir, args["key"] as string);
      return text(`Archived project ${String(args["key"])}`);
    },
  },
  {
    name: "unarchive_project",
    description: "Clear the archived flag on a project.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await unarchiveProject(locttDir, args["key"] as string);
      return text(`Unarchived project ${String(args["key"])}`);
    },
  },
  {
    name: "set_default_project",
    description: "Set or clear the workspace default project. Pass `key` to set, or omit it to clear the default.",
    inputSchema: {
      key: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const key = (args["key"] as string | undefined) ?? null;
      await setDefaultProject(locttDir, key);
      return text(key === null ? `Cleared workspace default project` : `Set workspace default to ${key}`);
    },
  },
];

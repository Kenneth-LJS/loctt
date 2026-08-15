/**
 * Project lifecycle tools. Reads and writes projects.yaml plus the
 * workspace-default pointer. Hard-delete carries a `remap_to`
 * escape hatch for projects that own tasks.
 *
 * The `project` parameter on edit/delete/archive/etc. accepts either
 * an internal project ULID or a project name (with disambiguation
 * error when names are non-unique).
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
  resolveProjectIdFromInput,
  setDefaultProject,
  setProjectPrefix,
  unarchiveProject,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_projects",
    description: "List projects defined in projects.yaml. Each project carries an internal id (ULID), a display name, and an immutable task-key prefix. The workspace default is identified by id.",
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
    description: "Create a new project. Names are not unique — duplicates are disambiguated by the auto-generated id. Prefixes must be unique across the tracker. Setting `make_default: true` also sets the workspace default. Returns the generated id.",
    inputSchema: {
      name: z.string().describe("Human-readable display name"),
      prefix: z.string().describe("Task-key prefix, e.g. BACKEND-"),
      make_default: z.boolean().optional().describe("If true, also set this project as the workspace default"),
    },
    handler: async ({ locttDir }, args) => {
      const def = await createProject(locttDir, {
        name: args["name"] as string,
        prefix: args["prefix"] as string,
      });
      if (args["make_default"] === true) {
        await setDefaultProject(locttDir, def.id);
      }
      return text(JSON.stringify({ id: def.id, name: def.name, prefix: def.prefix }, null, 2));
    },
  },
  {
    name: "edit_project",
    description: "Edit an existing project's name. `id` is immutable. The prefix has its own tool (`set_project_prefix`) because changing it rewrites every task in the project. The `project` parameter accepts either an id or a name.",
    inputSchema: {
      project: z.string().describe("Project id or name"),
      name: z.string().describe("New name"),
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string);
      await editProject(locttDir, id, { name: args["name"] as string });
      return text(`Updated project ${id}`);
    },
  },
  {
    name: "set_project_prefix",
    description:
      "Change a project's key prefix, renaming every task in it — T-3 becomes WEB-3. " +
      "Numbers are preserved, so nothing is renumbered, and each task's previous key is " +
      "appended to key_history so old references keep resolving. Prefixes must be unique " +
      "across projects; one already in use is rejected before anything is written. " +
      "Setting a project's own current prefix is a no-op. Requires `confirm: true` " +
      "because it rewrites every task in the project.",
    inputSchema: {
      project: z.string().describe("Project id or name"),
      prefix: z.string().describe("New prefix, e.g. WEB-"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "set_project_prefix");
      if (blocked) return blocked;
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string);
      const result = await setProjectPrefix(locttDir, id, args["prefix"] as string);
      return text(JSON.stringify({
        id,
        from: result.from,
        to: result.to,
        renamed: result.renamed,
      }, null, 2));
    },
  },
  {
    name: "delete_project",
    description:
      "Permanently remove a project from projects.yaml. For projects with tasks, " +
      "`remap_to` is required to migrate them to another project. Cannot delete the only " +
      "project. The counter is preserved in retired_keys. Use `archive_project` for the " +
      "reversible (soft) variant. Always requires `confirm: true`.",
    inputSchema: {
      project: z.string().describe("Project id or name to delete"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target project (id or name) for tasks in the deleted project"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_project");
      if (blocked) return blocked;
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string);
      const remapTo = args["remap_to"] as string | undefined;
      const remapToId = remapTo !== undefined ? resolveProjectIdFromInput(cfg, remapTo) : undefined;
      const result = await deleteProject(locttDir, id, {
        hard: true,
        ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
      });
      return text(JSON.stringify({
        id,
        remappedTaskCount: result.remappedTaskCount,
      }, null, 2));
    },
  },
  {
    name: "archive_project",
    description: "Mark a project as archived. Archived projects are hidden from default lists and pickers. Reversible via `unarchive_project`. Accepts an id or a name.",
    inputSchema: { project: z.string().describe("Project id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string, { includeArchived: true });
      await archiveProject(locttDir, id);
      return text(`Archived project ${id}`);
    },
  },
  {
    name: "unarchive_project",
    description: "Clear the archived flag on a project.",
    inputSchema: { project: z.string().describe("Project id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string, { includeArchived: true });
      await unarchiveProject(locttDir, id);
      return text(`Unarchived project ${id}`);
    },
  },
  {
    name: "set_default_project",
    description: "Set or clear the workspace default project. Pass `project` (id or name) to set, or omit it to clear.",
    inputSchema: {
      project: z.string().optional().describe("Project id or name; omit to clear"),
    },
    handler: async ({ locttDir }, args) => {
      const project = args["project"] as string | undefined;
      if (project === undefined) {
        await setDefaultProject(locttDir, null);
        return text(`Cleared workspace default project`);
      }
      await setDefaultProject(locttDir, project);
      return text(`Set workspace default to ${project}`);
    },
  },
];

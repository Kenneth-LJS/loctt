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
  applyArchivedScope,
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  filterProjects,
  loadProjectsConfig,
  resolveProjectIdFromInput,
  setDefaultProject,
  setProjectPrefix,
  unarchiveProject,
} from "@loctt/core";
import { z } from "zod";

import { configListInputSchema, getArchivedScope, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_projects",
    description:
      "List projects defined in projects.yaml. Each project carries an internal id (ULID), a display name, and an immutable task-key prefix. The workspace default is identified by id. "
      + "By default archived projects are hidden (K107); pass `archived: archived` for only archived or `archived: all` for both. "
      + "K90: pass `q` for a case-insensitive search over name/slug/prefix, and `limit`/`offset` to page (default 100, cap 1000).",
    inputSchema: { ...configListInputSchema },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadProjectsConfig(locttDir);
      // K90/K107 order (matching the web `handleListProjects`): archived
      // scope, then name/slug/prefix filter, then page. Default `active`
      // hides archived projects — before K107 this list showed them always.
      // `default` stays the workspace fact, computed over the full config,
      // not the paged window.
      const scoped = applyArchivedScope(cfg.projects, getArchivedScope(args));
      const projects = pageConfigList(filterProjects(scoped, getQ(args)), args);
      return text(JSON.stringify({
        projects,
        default: cfg.default ?? null,
        // DEG-C3: a hand-broken project entry is preserved in `cfg.broken`
        // by the tolerant loader rather than dropped — carry it so an agent
        // is not told "these are the projects" while one is silently
        // missing. Present only when non-empty; parity with the web list.
        ...(cfg.broken !== undefined && cfg.broken.length > 0 ? { broken: cfg.broken } : {}),
      }, null, 2));
    },
  },
  {
    name: "create_project",
    description: "Create a new project. Names are not unique. Duplicates are disambiguated by the auto-generated id. Prefixes must be unique across the tracker, as are slugs. A slug is the project's stable URL-safe handle; it is generated from the name unless given, and does not change when the project is renamed. Setting `make_default: true` also sets the workspace default. Returns the generated id and slug.",
    inputSchema: {
      name: z.string().describe("Human-readable display name"),
      prefix: z.string().describe("Task-key prefix, e.g. BACKEND-"),
      slug: z.string().optional().describe("URL-safe handle, e.g. `web`. Generated from the name when omitted. Lowercase letters, digits, hyphen, underscore; must start with a letter."),
      make_default: z.boolean().optional().describe("If true, also set this project as the workspace default"),
    },
    handler: async ({ locttDir }, args) => {
      const slug = args["slug"];
      const def = await createProject(locttDir, {
        name: args["name"] as string,
        prefix: args["prefix"] as string,
        ...(typeof slug === "string" ? { slug } : {}),
      });
      if (args["make_default"] === true) {
        await setDefaultProject(locttDir, def.id);
      }
      return text(JSON.stringify({
        id: def.id,
        name: def.name,
        ...(def.slug !== undefined ? { slug: def.slug } : {}),
        prefix: def.prefix,
      }, null, 2));
    },
  },
  {
    name: "edit_project",
    description: "Edit an existing project's name. `id` is immutable. The prefix has its own tool (`set_project_prefix`) because changing it rewrites every task in the project. The `project` parameter accepts a slug, an id, or a name.",
    inputSchema: {
      project: z.string().describe("Project slug, id, or name"),
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
      "Change a project's key prefix, renaming every task in it: T-3 becomes WEB-3. " +
      "Numbers are preserved, so nothing is renumbered, and each task's previous key is " +
      "appended to key_history so old references keep resolving. Prefixes must be unique " +
      "across projects; one already in use is rejected before anything is written. " +
      "Setting a project's own current prefix is a no-op. Requires `confirm: true` " +
      "because it rewrites every task in the project.",
    inputSchema: {
      project: z.string().describe("Project slug, id, or name"),
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
      "Permanently remove a project from projects.yaml. For projects with tasks, pass " +
      "EITHER `remap_to` (migrate them to another project) OR `clear_project_field: true` " +
      "(clear their project field, leaving them with no project). Pass exactly one, not both and not neither. " +
      "Cannot delete the only project. The counter is preserved in retired_keys. Use " +
      "`archive_project` for the reversible (soft) variant. Always requires `confirm: true`.",
    inputSchema: {
      project: z.string().describe("Project id or name to delete"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target project (id or name) for tasks in the deleted project"),
      clear_project_field: z.boolean().optional().describe(
        "Clear the project field on affected tasks instead of remapping them (PRU-17). Mutually exclusive with remap_to.",
      ),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_project");
      if (blocked) return blocked;
      const cfg = await loadProjectsConfig(locttDir);
      const id = resolveProjectIdFromInput(cfg, args["project"] as string);
      const remapTo = args["remap_to"] as string | undefined;
      const clearProjectField = args["clear_project_field"] === true;
      const remapToId = remapTo !== undefined ? resolveProjectIdFromInput(cfg, remapTo) : undefined;
      const result = await deleteProject(locttDir, id, {
        hard: true,
        ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
        ...(clearProjectField ? { clearProjectField: true } : {}),
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
    inputSchema: { project: z.string().describe("Project slug, id, or name") },
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
    inputSchema: { project: z.string().describe("Project slug, id, or name") },
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

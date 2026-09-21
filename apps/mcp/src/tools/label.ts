/**
 * Label catalog tools. Labels live in labels.yaml and are referenced
 * from each task's `labels` array by id. Deleting a label sweeps it
 * from every task (or remaps to another id).
 */

import type { EntityColor } from "@loctt/contracts";
import {
  applyArchivedScope,
  archiveLabel,
  createLabel,
  deleteLabel,
  editLabel,
  filterByName,
  loadLabelsConfig,
  resolveLabelIdFromInput,
  unarchiveLabel,
} from "@loctt/core";
import { z } from "zod";

import { COLOR_INPUT_DOC, colorInputSchema, nullableColorInputSchema } from "../runtime/color.js";
import { configListInputSchema, getArchivedScope, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_labels",
    description:
      "List labels defined in labels.yaml. Each label has an internal id (ULID), a display name, and optional color. "
      + "By default archived labels are hidden (K107); pass `archived: archived` for only archived or `archived: all` for both. "
      + "K90: pass `q` for a case-insensitive name substring search, and `limit`/`offset` to page (default 100, cap 1000).",
    inputSchema: { ...configListInputSchema },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadLabelsConfig(locttDir);
      // K90/K107 order (matching the web `handleListLabels`): archived
      // scope, then name filter, then page. Default `active` hides archived
      // labels — before K107 this list showed archived labels always.
      const scoped = applyArchivedScope(cfg.labels, getArchivedScope(args));
      const labels = pageConfigList(filterByName(scoped, getQ(args)), args);
      return text(JSON.stringify({ ...cfg, labels }, null, 2));
    },
  },
  {
    name: "create_label",
    description:
      "Register a new label. Returns the generated id. Names are not unique; disambiguated by id. "
      + "COLOUR (`color`): " + COLOR_INPUT_DOC,
    inputSchema: {
      name: z.string(),
      color: colorInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      // K103: an `EntityColor`, not a string — the zod schema above has
      // already validated it as one of the three shapes.
      const color = args["color"] as EntityColor | undefined;
      const def = await createLabel(locttDir, {
        name: args["name"] as string,
        ...(color !== undefined ? { color } : {}),
      });
      return text(JSON.stringify({ id: def.id, name: def.name }, null, 2));
    },
  },
  {
    name: "edit_label",
    description:
      "Edit a label's display name or color. The id is immutable. `label` parameter accepts id or name. "
      + "COLOUR (`color`): " + COLOR_INPUT_DOC,
    inputSchema: {
      label: z.string().describe("Label id or name"),
      name: z.string().optional().describe("New name"),
      color: nullableColorInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadLabelsConfig(locttDir);
      const id = resolveLabelIdFromInput(cfg, args["label"] as string, { includeArchived: true });
      const colorArg = args["color"] as EntityColor | null | undefined;
      await editLabel(locttDir, id, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...("color" in args ? { color: colorArg ?? null } : {}),
      });
      return text(`Updated label ${id}`);
    },
  },
  {
    name: "delete_label",
    description:
      "Permanently remove a label; the id is dropped from every task's labels array (or " +
      "remapped via `remap_to`). Use `archive_label` for the reversible (soft) variant. " +
      "Always requires `confirm: true`.",
    inputSchema: {
      label: z.string().describe("Label id or name"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target label (id or name) for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_label");
      if (blocked) return blocked;
      const cfg = await loadLabelsConfig(locttDir);
      const id = resolveLabelIdFromInput(cfg, args["label"] as string, { includeArchived: true });
      const remapTo = args["remap_to"] as string | undefined;
      const remapToId = remapTo !== undefined ? resolveLabelIdFromInput(cfg, remapTo) : undefined;
      const result = await deleteLabel(locttDir, id, {
        hard: true,
        ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
      });
      return text(JSON.stringify({ id, ...result }, null, 2));
    },
  },
  {
    name: "archive_label",
    description: "Mark a label as archived. Reversible via `unarchive_label`.",
    inputSchema: { label: z.string().describe("Label id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadLabelsConfig(locttDir);
      const id = resolveLabelIdFromInput(cfg, args["label"] as string, { includeArchived: true });
      await archiveLabel(locttDir, id);
      return text(`Archived label ${id}`);
    },
  },
  {
    name: "unarchive_label",
    description: "Clear the archived flag on a label.",
    inputSchema: { label: z.string().describe("Label id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadLabelsConfig(locttDir);
      const id = resolveLabelIdFromInput(cfg, args["label"] as string, { includeArchived: true });
      await unarchiveLabel(locttDir, id);
      return text(`Unarchived label ${id}`);
    },
  },
];

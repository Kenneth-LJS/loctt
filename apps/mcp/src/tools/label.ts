/**
 * Label catalog tools. Labels live in labels.yaml and are
 * referenced from each task's `labels` array; deleting a label
 * sweeps it from every task (or remaps to another key).
 */

import {
  archiveLabel,
  createLabel,
  deleteLabel,
  editLabel,
  loadLabelsConfig,
  unarchiveLabel,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_labels",
    description: "List labels defined in labels.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadLabelsConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
  {
    name: "create_label",
    description: "Register a new label. Keys are immutable; pass --label and optional --color.",
    inputSchema: {
      key: z.string(),
      label: z.string(),
      color: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const color = args["color"] as string | undefined;
      await createLabel(locttDir, {
        key: args["key"] as string,
        label: args["label"] as string,
        ...(color !== undefined ? { color } : {}),
      });
      return text(`Created label ${String(args["key"])}`);
    },
  },
  {
    name: "edit_label",
    description: "Edit a label's display name or color. The key is immutable.",
    inputSchema: {
      key: z.string(),
      label: z.string().optional(),
      color: z.string().nullable().optional().describe("Pass null to clear"),
    },
    handler: async ({ locttDir }, args) => {
      const colorArg = args["color"] as string | null | undefined;
      await editLabel(locttDir, args["key"] as string, {
        ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
        ...("color" in args ? { color: colorArg ?? null } : {}),
      });
      return text(`Updated label ${String(args["key"])}`);
    },
  },
  {
    name: "delete_label",
    description:
      "Permanently remove a label from labels.yaml; the key is dropped from every task's " +
      "labels array (or remapped via `remap_to`). Use `archive_label` for the reversible " +
      "(soft) variant. Always requires `confirm: true`.",
    inputSchema: {
      key: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target label key for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_label");
      if (blocked) return blocked;
      const remapTo = args["remap_to"] as string | undefined;
      const result = await deleteLabel(locttDir, args["key"] as string, {
        hard: true,
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      return text(JSON.stringify({
        key: args["key"],
        ...result,
      }, null, 2));
    },
  },
  {
    name: "archive_label",
    description: "Mark a label as archived. Reversible via `unarchive_label`.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await archiveLabel(locttDir, args["key"] as string);
      return text(`Archived label ${String(args["key"])}`);
    },
  },
  {
    name: "unarchive_label",
    description: "Clear the archived flag on a label.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await unarchiveLabel(locttDir, args["key"] as string);
      return text(`Unarchived label ${String(args["key"])}`);
    },
  },
];

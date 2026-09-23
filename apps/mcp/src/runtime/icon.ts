import { IconStringSchema } from "@loctt/contracts";

/**
 * The zod schema for an icon argument on a view tool.
 *
 * `IconStringSchema` rather than a bare string, so the MCP surface
 * enforces the SAME one-grapheme rule as the CLI, the web dialog and the
 * loader (Ken, 2026-09-23: an icon may not be two emoji, nor an emoji
 * glued to a letter). An agent is the caller most likely to try
 * `"🎈🎈"`, and rejecting it here is the difference between a clear
 * error and a config file the UI cannot render sensibly.
 */
export const iconInputSchema = IconStringSchema;

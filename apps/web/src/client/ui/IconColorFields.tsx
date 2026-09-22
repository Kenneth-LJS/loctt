import type { EntityColor } from "@loctt/contracts";

import { cn } from "./cn.ts";
import { ColorHexAlias, ColorPicker } from "./ColorPicker.tsx";
import { isLucideIcon } from "./iconCatalog.ts";
import { IconEmojiPicker } from "./IconEmojiPicker.tsx";

/**
 * K104 — the paired icon + colour fields, and the one rule that couples
 * them.
 *
 * ## The rule (A279): DISABLE WITH REASON, PRESERVE INERT
 *
 * K104 says an emoji carries its own colour, so a colour cannot apply to
 * one. When the chosen icon is an emoji (anything the Lucide catalog
 * does not know), the colour control is DISABLED and says why inline.
 *
 * What it does NOT do is clear the stored colour. A279 is explicit, on
 * P-11: clearing discards a deliberate choice the user made, and
 * icon → emoji → icon must restore the SAME colour rather than force
 * them to pick it again. So the colour value is carried untouched
 * through the emoji state — inert, not erased — and becomes live again
 * the moment a Lucide icon is chosen.
 *
 * This is a UI-state rule only. The stored `color` field is written
 * exactly as it was either way; nothing here rewrites disk.
 *
 * ## Why one component rather than the rule repeated in four dialogs
 *
 * `EntryEditDialog`, `RelationshipEditDialog`, `CustomFieldEditDialog`
 * and any future host all pair the same two fields. A rule copied into
 * four call sites is a rule that will be right in three of them after
 * the next change — which is the drift CLAUDE.md's "two surfaces answer
 * the same question the same way" principle exists to stop.
 */

/** The inline reason shown when the colour control is inert. */
export const EMOJI_COLOR_REASON = "Emoji carries its own colour.";

export function IconColorFields({
  icon,
  onIconChange,
  color,
  onColorChange,
  iconTestId,
  iconListTestId,
  iconSearchTestId,
  iconClearTestId,
  colorTestId,
  colorAliasTestId,
  noun,
  layout = "stacked",
}: {
  readonly icon: string | undefined;
  readonly onIconChange: (next: string | undefined) => void;
  readonly color: EntityColor | undefined;
  readonly onColorChange: (next: EntityColor | undefined) => void;
  readonly iconTestId: string;
  readonly iconListTestId: string;
  readonly iconSearchTestId: string;
  readonly iconClearTestId: string;
  readonly colorTestId: string;
  /** The original `…-color` testid, kept addressable by the hex alias. */
  readonly colorAliasTestId: string;
  /** What the fields belong to, for the aria labels ("status", "label"). */
  readonly noun: string;
  /** `inline` packs both into a row, for the custom-field value rows. */
  readonly layout?: "stacked" | "inline";
}) {
  // The couple rule, asked of the CATALOG rather than of the string's
  // shape. `undefined` (no icon) leaves the colour live: a colourless
  // entity with a tint is a perfectly ordinary thing, and disabling the
  // control just because no icon is set yet would strand it.
  const colorInert = icon !== undefined && !isLucideIcon(icon);

  const inline = layout === "inline";

  return (
    <>
      <div className={cn("block", inline && "contents")}>
        {!inline && <span className="mb-1 block text-text-secondary">Icon</span>}
        <IconEmojiPicker
          value={icon}
          onChange={onIconChange}
          testId={iconTestId}
          listTestId={iconListTestId}
          searchTestId={iconSearchTestId}
          clearTestId={iconClearTestId}
          ariaLabel={`Icon for the ${noun}`}
        />
      </div>

      <div className={cn("block", inline && "contents")}>
        {!inline && <span className="mb-1 block text-text-secondary">Colour</span>}
        <div className={cn(!inline && "block")}>
          <ColorPicker
            value={color}
            onChange={onColorChange}
            testId={colorTestId}
            ariaLabel={`Colour for the ${noun}`}
            disabled={colorInert}
            {...(colorInert ? { disabledReason: EMOJI_COLOR_REASON } : {})}
          />
          {/* The hex alias keeps the original `…-color` testid
              addressable so the existing tests and the e2e suite still
              drive real behaviour. It is inert alongside the picker —
              otherwise the "disabled" state would have a live back door
              that writes the very value the rule says cannot apply. */}
          <ColorHexAlias
            value={color}
            onChange={onColorChange}
            testId={colorAliasTestId}
            ariaLabel={`Colour hex for the ${noun}`}
            disabled={colorInert}
          />
        </div>
      </div>
    </>
  );
}

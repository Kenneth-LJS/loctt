import type { TimelineGrouping } from "@loctt/contracts";

import { Combobox, ComboboxButton, type ComboboxButtonSize, type ComboboxOption } from "../ui/Combobox.tsx";
import type { GroupEntry } from "./catalog.ts";
import { groupingLabel } from "./catalog.ts";

/**
 * The group-by control — a thin wrapper over the shared `Combobox`
 * single-select, so grouping scales the way the K97 filter work does:
 * one trigger, a search box that appears on its own once the list is
 * long enough (A211 / `COMBOBOX_SEARCH_THRESHOLD`), and no per-surface
 * "which groupings are offered" config — eligibility is derived by
 * `buildGroupingCatalog`.
 *
 * `none` is not an ordinary option: it is the `clear` row pinned at the
 * top of the list ("None (flat)"), the same shape the filter pickers use
 * for "no value". Selecting it emits `"none"`.
 *
 * Custom-field entries carry a `"Custom field"` hint, so a search for
 * "custom" surfaces them and they read as a distinct group in the list.
 *
 * Surface-neutral: the timeline toolbar and the Settings panel both
 * mount this. When the board/list adopt grouping they mount it too.
 */
export function GroupByPicker(props: {
  readonly catalog: readonly GroupEntry[];
  readonly value: TimelineGrouping;
  readonly onChange: (id: TimelineGrouping) => void;
  readonly size?: ComboboxButtonSize | undefined;
  readonly testIdBase: string;
  readonly "aria-label": string;
}) {
  const { catalog, value, onChange, size = "sm", testIdBase } = props;

  // Everything except `none`, which becomes the clear row. A custom
  // field gets a hint so "custom" is typeable and the group reads.
  const options: ComboboxOption[] = catalog
    .filter(e => e.id !== "none")
    .map(e => ({
      key: e.id,
      label: e.label,
      ...(e.group === "custom" ? { hint: "Custom field" } : {}),
    }));

  // The selected value stays selectable even when it is not in the
  // catalog (a dangling `field.<key>`) — the picker should still name
  // what is set rather than showing empty. `none` selection => empty
  // `value` so the clear row reads as active.
  const selectedInList = value !== "none" && !options.some(o => o.key === value);
  const effectiveOptions: ComboboxOption[] = selectedInList
    ? [...options, { key: value, label: groupingLabel(value, catalog), hint: "no longer available" }]
    : options;

  return (
    <Combobox
      label="Group by"
      options={effectiveOptions}
      value={value === "none" ? undefined : value}
      onSelect={v => { onChange(v as TimelineGrouping); }}
      clear={{
        label: "None (flat)",
        onClear: () => { onChange("none"); },
        testId: `${testIdBase}-opt-none`,
      }}
      listTestId={`${testIdBase}-options`}
      optionTestId={o => `${testIdBase}-opt-${o.key}`}
      searchTestId={`${testIdBase}-search`}
      // The timeline chart's sticky header is `z-20`; the picker sits in
      // the toolbar above the chart in DOM order but must also win the
      // stacking tie, or the header intercepts clicks on the open list.
      panelClassName="z-30"
      trigger={p => (
        <ComboboxButton
          {...p}
          size={size}
          testId={testIdBase}
          dataValue={value}
          aria-label={props["aria-label"]}
          className="max-w-[14rem] capitalize"
        >
          {groupingLabel(value, catalog)}
        </ComboboxButton>
      )}
    />
  );
}

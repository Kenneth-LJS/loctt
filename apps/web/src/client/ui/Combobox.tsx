/**
 * K106 stage 2: `Combobox` became `ui/Dropdown` — ONE primitive spanning
 * the plain single-select, the searchable single-select, and both
 * multi-select shapes (listbox `option` rows, and the filter facets'
 * `menuitemcheckbox` rows that `list/FilterDropdown` used to own).
 *
 * The name changed because the component is no longer a combobox in every
 * mode: a `role="menu"` facet is not one. This file stays only as the
 * alias layer for call sites that have not been renamed yet; the
 * implementation, and all documentation of it, live in `Dropdown.tsx`.
 */
export type {
  DropdownButtonSize as ComboboxButtonSize,
  DropdownFooterContext as ComboboxFooterContext,
  DropdownMultiProps as ComboboxMultiProps,
  DropdownOption as ComboboxOption,
  DropdownProps as ComboboxProps,
  DropdownSearch as ComboboxSearch,
  DropdownSingleProps as ComboboxSingleProps,
  DropdownTriggerProps as ComboboxTriggerProps,
  SelectDropdownOption as SelectComboboxOption,
  SelectDropdownProps as SelectComboboxProps,
} from "./Dropdown.tsx";
export {
  Dropdown as Combobox,
  DROPDOWN_SEARCH_THRESHOLD as COMBOBOX_SEARCH_THRESHOLD,
  DropdownButton as ComboboxButton,
  filterOptions,
  SelectDropdown as SelectCombobox,
} from "./Dropdown.tsx";

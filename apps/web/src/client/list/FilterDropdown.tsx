/**
 * K106 stage 2: `FilterDropdown` became `list/FilterFacet` over the
 * merged `ui/Dropdown` primitive (`mode="menu"`), so the app no longer
 * carries two dropdown implementations.
 *
 * This file stays ONLY as the alias for `settings/ViewFormDialog.tsx` and
 * `settings/viewFilterFields.ts`, which a concurrent ticket (K104) is
 * editing — renaming their imports would have collided. Once K104 lands,
 * point those two at `FilterFacet.tsx` and delete this file.
 */
export type { FilterOption } from "./FilterFacet.tsx";
export { FilterFacet as FilterDropdown } from "./FilterFacet.tsx";

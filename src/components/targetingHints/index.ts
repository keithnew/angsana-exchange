/**
 * Angsana Exchange — Targeting Hints Picker v0.1: barrel
 *
 * Single re-export point for callers. Adopting surfaces (Wishlists,
 * Propositions/ICP, Conflicts, Exclusions, Relationships, Campaigns)
 * import from this barrel; the file paths inside the module may move
 * without breaking call sites.
 */

export { TargetingHintsPicker } from './TargetingHintsPicker';
export type {
  TargetingHintsPickerProps,
  PickerDimension,
  PickerCluster,
  PickerValue,
} from './TargetingHintsPicker';

export type {
  CallMode,
  PolarityMode,
  Selection,
  SelectionIntent,
  ResolvedSelection,
  ResolvedSelectionByDimension,
} from './types';

export {
  resolveSelections,
  type CatalogueDimension,
  type CatalogueCluster,
  type CatalogueValue,
} from './resolveSelections';

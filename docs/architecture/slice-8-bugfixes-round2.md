# Slice 8 — Bug Fixes and Polish (Round 2)

Spec saved from `/Users/keith.new/Downloads/slice-8-bug-fixes-round-2.md`.

## Implementation Status

All fixes implemented and deployed.

### Fix 1: Sub-header border spans full width ✅
- Using `-mx-6` on sticky sub-header containers extends border edge-to-edge
- Applied on both CampaignDetailClient and CampaignForm

### Fix 2+3: Sub-header jitter/shift when scrolling ✅
- Restored `-mt-6` on sticky sub-headers for flush positioning against parent padding
- Pure CSS `position: sticky; top: 0` — no JavaScript scroll listeners
- No CSS transitions on sub-header position properties
- `z-index: 30` and `bg-white` prevent content showing through

### Fix 4: Edit form layout matches detail view ✅
- CampaignForm restructured to: Campaign Details → Propositions → Targeting → Messaging
- Each section is its own Card matching the detail page card order

### Fix 5: Save/Cancel at top and bottom ✅
- ActionButtons component rendered above first card AND below last card
- Both trigger same form submission

### Fix 6: Campaign pills right-aligned on Prospecting Profile ✅
- ICP summary text has `flex-1` + `truncate` to fill available space
- Campaign pill has `shrink-0` + `ml-auto` to pin right
- Chevron has `shrink-0`, only gets `ml-auto` when no campaign pill present

### Fix 7: Documents card showing linked documents ✅
- Firestore composite indexes deployed (`campaignRefs` array-contains + `status` + `uploadedAt`)
- CampaignDocumentsCard now logs errors instead of silently swallowing them
- Browse route already supports both `campaignRefs` (array) and `campaignRef` (string) queries

### Fix 8: Proposition picker rendering on edit form ✅
- Loading state with skeleton UI while propositions fetch
- Propositions grouped by category in dropdown
- Selected propositions show as expandable pills with ICP detail
